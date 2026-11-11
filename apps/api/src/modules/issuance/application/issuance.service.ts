import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import {
  BloodRequestStatus,
  InventoryMovementType,
  IssuanceStatus,
  NotificationType,
  Prisma,
  RequestUrgency,
  ReservationStatus,
  UnitState,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { AuditService } from '../../../common/audit/audit.service';
import { generatePublicCode } from '../../../common/identifiers/public-code';
import { ActorContext, canAtFacility, canGlobally } from '../../rbac/domain/policy';
import { ExpiryService } from '../../inventory/application/expiry.service';
import { InventoryMovementService } from '../../inventory/application/inventory-movement.service';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  canCancelIssuance,
  canConfirmIssuance,
  computeRequestFulfillmentStatus,
  isRequestIssuable,
} from '../domain/issuance-workflow';

export interface IssuanceContext {
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateIssuanceInput {
  items: Array<{ reservationItemId: string }>;
  idempotencyKey?: string | null;
}

const ISSUANCE_PUBLIC_CODE_PREFIX = 'ISS';

const ISSUANCE_INCLUDE = {
  request: {
    select: {
      id: true,
      publicCode: true,
      status: true,
      urgency: true,
      facilityId: true,
      requestedByUserId: true,
    },
  },
  reservation: { select: { id: true, status: true, ruleSetVersion: true } },
  facility: { select: { id: true, name: true, code: true } },
  items: {
    include: {
      unit: {
        select: {
          id: true,
          publicCode: true,
          state: true,
          bloodGroup: true,
          componentTypeId: true,
          expiresAt: true,
          facilityId: true,
        },
      },
      reservationItem: { select: { id: true, isActive: true, requestLineId: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.IssuanceInclude;

function conflict(code: string, message: string, details: Record<string, unknown> = {}): AppHttpException {
  return new AppHttpException(HttpStatus.CONFLICT, code, message, details);
}

function badRequest(code: string, message: string, details: Record<string, unknown> = {}): AppHttpException {
  return new AppHttpException(HttpStatus.BAD_REQUEST, code, message, details);
}

function notFound(code: string, message: string): AppHttpException {
  return new AppHttpException(HttpStatus.NOT_FOUND, code, message);
}

function requestNotFound(): AppHttpException {
  return notFound('REQUEST_NOT_FOUND', 'The requested resource could not be found.');
}

function issuanceNotFound(): AppHttpException {
  return notFound('ISSUANCE_NOT_FOUND', 'The requested resource could not be found.');
}

interface LockedRequestRow {
  id: string;
  status: BloodRequestStatus;
  facilityId: string;
  urgency: RequestUrgency;
}

interface ReservationItemForIssuance {
  id: string;
  unitId: string;
  requestLineId: string | null;
  isActive: boolean;
  reservation: {
    id: string;
    requestId: string | null;
    facilityId: string;
    status: ReservationStatus;
    ruleSetVersion: string | null;
  };
  unit: {
    id: string;
    state: UnitState;
    expiresAt: Date;
    facilityId: string;
    componentTypeId: string;
  };
  requestLine: {
    id: string;
    requestId: string;
    componentTypeId: string;
    quantityRequested: number;
    quantityReserved: number;
    quantityIssued: number;
  } | null;
}

const RESERVATION_ITEM_INCLUDE = {
  reservation: {
    select: { id: true, requestId: true, facilityId: true, status: true, ruleSetVersion: true },
  },
  unit: {
    select: { id: true, state: true, expiresAt: true, facilityId: true, componentTypeId: true },
  },
  requestLine: {
    select: {
      id: true,
      requestId: true,
      componentTypeId: true,
      quantityRequested: true,
      quantityReserved: true,
      quantityIssued: true,
    },
  },
} satisfies Prisma.ReservationItemInclude;

@Injectable()
export class IssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryService: ExpiryService,
    private readonly movementService: InventoryMovementService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  private canIssue(actor: ActorContext, facilityId: string): boolean {
    if (canGlobally(actor, 'inventory.issue') || canGlobally(actor, 'request.fulfill')) return true;
    return (
      canAtFacility(actor, facilityId, 'inventory.issue') ||
      canAtFacility(actor, facilityId, 'request.fulfill')
    );
  }

  private canRead(actor: ActorContext, facilityId: string): boolean {
    if (canGlobally(actor, 'request.read') || canGlobally(actor, 'inventory.read')) return true;
    return (
      canAtFacility(actor, facilityId, 'request.read') ||
      canAtFacility(actor, facilityId, 'inventory.read')
    );
  }

  private assertCanIssue(actor: ActorContext, facilityId: string): void {
    if (!this.canIssue(actor, facilityId)) throw requestNotFound();
  }

  private assertCanRead(actor: ActorContext, facilityId: string): void {
    if (!this.canRead(actor, facilityId)) throw requestNotFound();
  }

  async listForRequest(actor: ActorContext, requestId: string) {
    const request = await this.prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: { id: true, facilityId: true },
    });
    if (!request) throw requestNotFound();
    this.assertCanRead(actor, request.facilityId);
    return this.prisma.issuance.findMany({
      where: { requestId },
      include: ISSUANCE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getById(actor: ActorContext, issuanceId: string) {
    const issuance = await this.prisma.issuance.findUnique({
      where: { id: issuanceId },
      include: ISSUANCE_INCLUDE,
    });
    if (!issuance) throw issuanceNotFound();
    this.assertCanRead(actor, issuance.facilityId);
    return issuance;
  }

  private async findIdempotent(facilityId: string, idempotencyKey: string, requestId: string) {
    const existing = await this.prisma.issuance.findUnique({
      where: { facilityId_idempotencyKey: { facilityId, idempotencyKey } },
      include: ISSUANCE_INCLUDE,
    });
    if (!existing) return null;
    if (existing.requestId !== requestId) {
      throw conflict(
        'IDEMPOTENCY_KEY_CONFLICT',
        'The idempotency key was already used for a different issuance command.',
      );
    }
    return existing;
  }

  async create(
    actor: ActorContext,
    requestId: string,
    input: CreateIssuanceInput,
    ctx: IssuanceContext,
  ): Promise<{ issuance: unknown; idempotent: boolean }> {
    if (!input.items.length) {
      throw badRequest('ISSUANCE_ITEMS_REQUIRED', 'At least one reservation item is required.');
    }
    const reservationItemIds = input.items.map((item) => item.reservationItemId);
    if (new Set(reservationItemIds).size !== reservationItemIds.length) {
      throw badRequest(
        'DUPLICATE_ISSUANCE_ITEM',
        'Each reservation item can only appear once in an issuance command.',
      );
    }

    const request = await this.prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: { id: true, facilityId: true, status: true },
    });
    if (!request) throw requestNotFound();
    this.assertCanIssue(actor, request.facilityId);
    if (!isRequestIssuable(request.status)) {
      throw conflict(
        'REQUEST_NOT_ISSUABLE',
        `Request status ${request.status} does not allow issuance.`,
        { status: request.status },
      );
    }

    if (input.idempotencyKey) {
      const existing = await this.findIdempotent(
        request.facilityId,
        input.idempotencyKey,
        request.id,
      );
      if (existing) return { issuance: existing, idempotent: true };
    }

    const sortedIds = [...reservationItemIds].sort();
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(
        async (tx) => {
          if (input.idempotencyKey) {
            const existing = await tx.issuance.findUnique({
              where: {
                facilityId_idempotencyKey: {
                  facilityId: request.facilityId,
                  idempotencyKey: input.idempotencyKey,
                },
              },
              select: { id: true, requestId: true },
            });
            if (existing) {
              if (existing.requestId !== request.id) {
                throw conflict(
                  'IDEMPOTENCY_KEY_CONFLICT',
                  'The idempotency key was already used for a different issuance command.',
                );
              }
              return existing.id;
            }
          }

          const lockedRequest = await this.lockRequest(tx, request.id);
          if (!lockedRequest || lockedRequest.facilityId !== request.facilityId) {
            throw requestNotFound();
          }
          if (!isRequestIssuable(lockedRequest.status)) {
            throw conflict(
              'REQUEST_NOT_ISSUABLE',
              `Request status ${lockedRequest.status} does not allow issuance.`,
              { status: lockedRequest.status },
            );
          }

          // Deterministic lock order: reservation items -> reservations -> units.
          await this.lockReservationItems(tx, sortedIds);
          const items = await tx.reservationItem.findMany({
            where: { id: { in: sortedIds } },
            include: RESERVATION_ITEM_INCLUDE,
            orderBy: { id: 'asc' },
          });
          this.assertAllReservationItemsPresent(sortedIds, items);

          const reservationIds = [...new Set(items.map((item) => item.reservation.id))].sort();
          if (reservationIds.length !== 1) {
            throw badRequest(
              'ITEMS_SPAN_MULTIPLE_RESERVATIONS',
              'All issuance items must belong to the same reservation.',
            );
          }
          const reservationId = reservationIds[0]!;
          await this.lockReservations(tx, reservationIds);
          await this.lockUnits(
            tx,
            [...new Set(items.map((item) => item.unitId))].sort(),
          );

          // Re-read after locking so validation sees the committed state.
          const lockedItems = await tx.reservationItem.findMany({
            where: { id: { in: sortedIds } },
            include: RESERVATION_ITEM_INCLUDE,
            orderBy: { id: 'asc' },
          });
          this.assertAllReservationItemsPresent(sortedIds, lockedItems);

          const perLine = new Map<string, number>();
          for (const item of lockedItems) {
            this.validateReservationItemForCreate(item, lockedRequest);
            const lineId = item.requestLine!.id;
            perLine.set(lineId, (perLine.get(lineId) ?? 0) + 1);
          }

          for (const [lineId, delta] of perLine.entries()) {
            const line = lockedItems.find((item) => item.requestLine?.id === lineId)!.requestLine!;
            const remaining = Math.max(0, line.quantityRequested - line.quantityIssued);
            if (delta > remaining) {
              throw conflict(
                'EXCEEDS_REMAINING',
                'Issuance quantity exceeds the remaining requested quantity for a request line.',
                { requestLineId: lineId, remaining, requested: delta },
              );
            }
          }

          const duplicate = await tx.issuanceItem.findFirst({
            where: {
              reservationItemId: { in: sortedIds },
              issuance: { status: { in: [IssuanceStatus.CREATED, IssuanceStatus.CONFIRMED] } },
            },
            select: { reservationItemId: true },
          });
          if (duplicate) {
            throw conflict(
              'DOUBLE_ISSUANCE',
              'One or more reservation items already have an active issuance.',
              { reservationItemId: duplicate.reservationItemId },
            );
          }

          const reservation = lockedItems[0]!.reservation;
          const issuance = await tx.issuance.create({
            data: {
              publicCode: generatePublicCode(ISSUANCE_PUBLIC_CODE_PREFIX),
              requestId: request.id,
              reservationId,
              facilityId: request.facilityId,
              issuedByUserId: actor.userId,
              status: IssuanceStatus.CREATED,
              ruleSetVersion: reservation.ruleSetVersion,
              idempotencyKey: input.idempotencyKey ?? null,
              metadata: {
                itemCount: sortedIds.length,
                reservationItemIds: sortedIds,
                requestUrgency: lockedRequest.urgency,
              } as Prisma.InputJsonValue,
            },
            select: { id: true },
          });

          for (const item of lockedItems) {
            await tx.issuanceItem.create({
              data: {
                issuanceId: issuance.id,
                unitId: item.unitId,
                reservationItemId: item.id,
              },
            });
          }
          return issuance.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findIdempotent(
          request.facilityId,
          input.idempotencyKey,
          request.id,
        );
        if (existing) return { issuance: existing, idempotent: true };
      }
      throw error;
    }

    const issuance = await this.prisma.issuance.findUnique({
      where: { id: createdId },
      include: ISSUANCE_INCLUDE,
    });
    if (!issuance) throw issuanceNotFound();

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'issuance.created',
      targetType: 'Issuance',
      targetId: issuance.id,
      facilityId: issuance.facilityId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: {
        domainRequestId: request.id,
        reservationId: issuance.reservationId,
        unitIds: issuance.items.map((item) => item.unitId),
        requestStatus: request.status,
        ruleSetVersion: issuance.ruleSetVersion,
      },
    });

    await this.notifications?.notifySafely({
      actorUserId: actor.userId,
      type: NotificationType.ISSUANCE_CREATED,
      title: `Issuance ${issuance.publicCode} created`,
      body: `${issuance.items.length} unit(s) prepared for issuance and awaiting confirmation.`,
      facilityId: issuance.facilityId,
      resourceType: 'Issuance',
      resourceId: issuance.id,
      dedupeKey: `issuance:${issuance.id}:created`,
      metadata: {
        domainRequestId: request.id,
        unitCount: issuance.items.length,
      },
      facilityRecipients: [
        { facilityId: issuance.facilityId, permissions: ['request.fulfill'] },
      ],
      excludeUserIds: [actor.userId],
      auditContext: ctx,
    });

    return { issuance, idempotent: false };
  }

  async confirm(
    actor: ActorContext,
    issuanceId: string,
    ctx: IssuanceContext,
  ): Promise<{ issuance: unknown; idempotent: boolean }> {
    const existing = await this.prisma.issuance.findUnique({
      where: { id: issuanceId },
      select: { id: true, facilityId: true, status: true },
    });
    if (!existing) throw issuanceNotFound();
    this.assertCanIssue(actor, existing.facilityId);
    if (existing.status === IssuanceStatus.CONFIRMED) {
      const issuance = await this.prisma.issuance.findUnique({
        where: { id: issuanceId },
        include: ISSUANCE_INCLUDE,
      });
      return { issuance, idempotent: true };
    }
    if (!canConfirmIssuance(existing.status)) {
      throw conflict(
        'ISSUANCE_NOT_CONFIRMABLE',
        `Issuance status ${existing.status} cannot be confirmed.`,
        { status: existing.status },
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const lockedIssuance = await tx.$queryRaw<Array<{ id: string; status: IssuanceStatus }>>(
          Prisma.sql`SELECT id, status FROM "Issuance" WHERE id = ${issuanceId} FOR UPDATE`,
        );
        const locked = lockedIssuance[0];
        if (!locked) throw issuanceNotFound();
        if (locked.status === IssuanceStatus.CONFIRMED) {
          return { issuanceId, idempotent: true, unitIds: [] as string[], requestId: null as string | null, requestStatus: null as BloodRequestStatus | null };
        }
        if (!canConfirmIssuance(locked.status)) {
          throw conflict(
            'ISSUANCE_NOT_CONFIRMABLE',
            `Issuance status ${locked.status} cannot be confirmed.`,
            { status: locked.status },
          );
        }

        const issuanceItems = await tx.issuanceItem.findMany({
          where: { issuanceId },
          select: { id: true, unitId: true, reservationItemId: true },
          orderBy: { id: 'asc' },
        });
        if (!issuanceItems.length) {
          throw conflict('ISSUANCE_HAS_NO_ITEMS', 'Issuance has no items to confirm.');
        }
        const issuanceRow = await tx.issuance.findUniqueOrThrow({
          where: { id: issuanceId },
          select: { id: true, requestId: true, reservationId: true, facilityId: true },
        });
        if (!issuanceRow.requestId || !issuanceRow.reservationId) {
          throw conflict('ISSUANCE_NOT_LINKED', 'Issuance is not linked to a request reservation.');
        }

        const lockedRequest = await this.lockRequest(tx, issuanceRow.requestId);
        if (!lockedRequest || lockedRequest.facilityId !== issuanceRow.facilityId) {
          throw requestNotFound();
        }
        if (!isRequestIssuable(lockedRequest.status)) {
          throw conflict(
            'REQUEST_NOT_ISSUABLE',
            `Request status ${lockedRequest.status} does not allow issuance.`,
            { status: lockedRequest.status },
          );
        }

        const reservationItemIds = issuanceItems
          .map((item) => item.reservationItemId)
          .filter((id): id is string => Boolean(id))
          .sort();
        if (reservationItemIds.length !== issuanceItems.length) {
          throw conflict('ISSUANCE_NOT_LINKED', 'Issuance item is missing its reservation link.');
        }
        await this.lockReservationItems(tx, reservationItemIds);
        await this.lockUnits(tx, [...new Set(issuanceItems.map((item) => item.unitId))].sort());

        const reservationItems = await tx.reservationItem.findMany({
          where: { id: { in: reservationItemIds } },
          include: RESERVATION_ITEM_INCLUDE,
          orderBy: { id: 'asc' },
        });
        this.assertAllReservationItemsPresent(reservationItemIds, reservationItems);

        const now = new Date();
        const confirmedUnitIds: string[] = [];
        const perLine = new Map<string, number>();

        for (const item of issuanceItems) {
          const reservationItem = reservationItems.find(
            (candidate) => candidate.id === item.reservationItemId,
          );
          if (!reservationItem) {
            throw conflict('RESERVATION_ITEM_NOT_FOUND', 'Reservation item no longer exists.');
          }
          this.validateReservationItemForConfirm(reservationItem, lockedRequest);

          const otherIssuance = await tx.issuanceItem.findFirst({
            where: {
              reservationItemId: reservationItem.id,
              issuanceId: { not: issuanceId },
              issuance: { status: IssuanceStatus.CONFIRMED },
            },
            select: { id: true },
          });
          if (otherIssuance) {
            throw conflict(
              'DOUBLE_ISSUANCE',
              'This reservation item has already been issued by another confirmed issuance.',
              { reservationItemId: reservationItem.id },
            );
          }

          await this.movementService.recordMovement(
            {
              unitId: reservationItem.unitId,
              movementType: InventoryMovementType.ISSUED,
              toState: UnitState.ISSUED,
              actorUserId: actor.userId,
              facilityId: issuanceRow.facilityId,
              reservationId: issuanceRow.reservationId,
              issuanceId,
              reason: 'Issuance confirmed by authorized staff',
              metadata: {
                requestId: issuanceRow.requestId,
                reservationItemId: reservationItem.id,
                requestLineId: reservationItem.requestLineId,
              } as Prisma.InputJsonValue,
              unitUpdate: { issuedAt: now },
            },
            tx,
          );

          await tx.issuanceItem.update({
            where: { id: item.id },
            data: { issuedAt: now },
          });
          await tx.reservationItem.update({
            where: { id: reservationItem.id },
            data: { isActive: false },
          });

          const lineId = reservationItem.requestLine!.id;
          perLine.set(lineId, (perLine.get(lineId) ?? 0) + 1);
          confirmedUnitIds.push(reservationItem.unitId);
        }

        for (const [lineId, delta] of perLine.entries()) {
          // Guard counters in SQL so reserved quantity can never go negative.
          const updated = await tx.bloodRequestLine.updateMany({
            where: {
              id: lineId,
              quantityReserved: { gte: delta },
            },
            data: {
              quantityReserved: { decrement: delta },
              quantityIssued: { increment: delta },
            },
          });
          if (updated.count !== 1) {
            throw conflict(
              'FULFILLMENT_COUNTER_CONFLICT',
              'Request line counters are inconsistent with the reservation being issued.',
              { requestLineId: lineId },
            );
          }
        }

        const lines = await tx.bloodRequestLine.findMany({
          where: { requestId: issuanceRow.requestId },
          select: { quantityRequested: true, quantityReserved: true, quantityIssued: true },
        });
        const nextStatus = computeRequestFulfillmentStatus(lines, lockedRequest.status);
        if (nextStatus !== lockedRequest.status) {
          await tx.bloodRequest.update({
            where: { id: issuanceRow.requestId },
            data: {
              status: nextStatus,
              ...(nextStatus === BloodRequestStatus.FULFILLED ? { fulfilledAt: now } : {}),
            },
          });
        }

        const remainingActive = await tx.reservationItem.count({
          where: { reservationId: issuanceRow.reservationId, isActive: true },
        });
        if (remainingActive === 0) {
          await tx.reservation.updateMany({
            where: {
              id: issuanceRow.reservationId,
              status: { in: [ReservationStatus.ACTIVE, ReservationStatus.CONFIRMED] },
            },
            data: { status: ReservationStatus.CONVERTED_TO_ISSUANCE, convertedAt: now },
          });
        }

        await tx.issuance.update({
          where: { id: issuanceId },
          data: { status: IssuanceStatus.CONFIRMED, confirmedAt: now, issuedAt: now },
        });

        return {
          issuanceId,
          idempotent: false,
          unitIds: confirmedUnitIds,
          requestId: issuanceRow.requestId,
          requestStatus: nextStatus,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const issuance = await this.prisma.issuance.findUnique({
      where: { id: issuanceId },
      include: ISSUANCE_INCLUDE,
    });
    if (!issuance) throw issuanceNotFound();

    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'issuance.confirmed',
        targetType: 'Issuance',
        targetId: issuanceId,
        facilityId: issuance.facilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: {
          domainRequestId: result.requestId,
          unitIds: result.unitIds,
          requestStatus: result.requestStatus,
          ruleSetVersion: issuance.ruleSetVersion,
        },
      });

      await this.notifications?.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.ISSUANCE_CONFIRMED,
        title: `Issuance ${issuance.publicCode} confirmed`,
        body: `${result.unitIds.length} unit(s) issued and recorded as used.`,
        facilityId: issuance.facilityId,
        resourceType: 'Issuance',
        resourceId: issuance.id,
        dedupeKey: `issuance:${issuance.id}:confirmed`,
        metadata: {
          domainRequestId: result.requestId,
          unitCount: result.unitIds.length,
        },
        facilityRecipients: [
          { facilityId: issuance.facilityId, permissions: ['request.fulfill', 'request.read'] },
        ],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });

      if (result.requestStatus === BloodRequestStatus.FULFILLED && issuance.request) {
        await this.notifications?.notifySafely({
          actorUserId: actor.userId,
          type: NotificationType.REQUEST_FULFILLED,
          title: `Request ${issuance.request.publicCode} fulfilled`,
          body: `All requested units have been issued at ${issuance.facility.name}.`,
          facilityId: issuance.facilityId,
          resourceType: 'BloodRequest',
          resourceId: issuance.request.id,
          dedupeKey: `request:${issuance.request.id}:fulfilled`,
          metadata: { issuanceId: issuance.id, unitCount: result.unitIds.length },
          explicitUserIds: [issuance.request.requestedByUserId],
          excludeUserIds: [actor.userId],
          auditContext: ctx,
        });
      }
    }

    return { issuance, idempotent: result.idempotent };
  }

  async cancel(
    actor: ActorContext,
    issuanceId: string,
    reason: string | null,
    ctx: IssuanceContext,
  ): Promise<{ issuance: unknown; idempotent: boolean }> {
    const existing = await this.prisma.issuance.findUnique({
      where: { id: issuanceId },
      select: { id: true, facilityId: true, status: true },
    });
    if (!existing) throw issuanceNotFound();
    this.assertCanIssue(actor, existing.facilityId);
    if (existing.status === IssuanceStatus.CANCELLED) {
      const issuance = await this.prisma.issuance.findUnique({
        where: { id: issuanceId },
        include: ISSUANCE_INCLUDE,
      });
      return { issuance, idempotent: true };
    }
    if (!canCancelIssuance(existing.status)) {
      throw conflict(
        'ISSUANCE_NOT_CANCELLABLE',
        'Confirmed issuances cannot be reversed: issued units cannot return to available inventory.',
        { status: existing.status },
      );
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: IssuanceStatus }>>(
        Prisma.sql`SELECT id, status FROM "Issuance" WHERE id = ${issuanceId} FOR UPDATE`,
      );
      const locked = rows[0];
      if (!locked) throw issuanceNotFound();
      if (locked.status === IssuanceStatus.CANCELLED) return { idempotent: true };
      if (!canCancelIssuance(locked.status)) {
        throw conflict(
          'ISSUANCE_NOT_CANCELLABLE',
          'Confirmed issuances cannot be reversed: issued units cannot return to available inventory.',
          { status: locked.status },
        );
      }
      await tx.issuance.update({
        where: { id: issuanceId },
        data: {
          status: IssuanceStatus.CANCELLED,
          cancelledAt: new Date(),
          notes: reason,
        },
      });
      return { idempotent: false };
    });

    const issuance = await this.prisma.issuance.findUnique({
      where: { id: issuanceId },
      include: ISSUANCE_INCLUDE,
    });
    if (!issuance) throw issuanceNotFound();

    if (!cancelled.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'issuance.cancelled',
        targetType: 'Issuance',
        targetId: issuanceId,
        facilityId: issuance.facilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { domainRequestId: issuance.requestId, reason },
      });
    }

    return { issuance, idempotent: cancelled.idempotent };
  }

  private async lockRequest(
    tx: Prisma.TransactionClient,
    requestId: string,
  ): Promise<LockedRequestRow | undefined> {
    const rows = await tx.$queryRaw<LockedRequestRow[]>(
      Prisma.sql`SELECT id, status, "facilityId", urgency FROM "BloodRequest" WHERE id = ${requestId} FOR UPDATE`,
    );
    return rows[0];
  }

  private async lockReservationItems(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "ReservationItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
  }

  private async lockReservations(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Reservation" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
  }

  private async lockUnits(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "BloodComponentUnit" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
  }

  private assertAllReservationItemsPresent(
    expected: string[],
    found: Array<{ id: string }>,
  ): void {
    if (found.length === expected.length) return;
    const foundIds = new Set(found.map((item) => item.id));
    const missing = expected.filter((id) => !foundIds.has(id));
    throw conflict('RESERVATION_ITEM_NOT_FOUND', 'One or more reservation items no longer exist.', {
      reservationItemIds: missing,
    });
  }

  private validateReservationItemForCreate(
    item: ReservationItemForIssuance,
    request: LockedRequestRow,
  ): void {
    this.assertReservationItemBase(item, request);
    if (
      item.reservation.status !== ReservationStatus.ACTIVE &&
      item.reservation.status !== ReservationStatus.CONFIRMED
    ) {
      throw conflict(
        'RESERVATION_NOT_ISSUABLE',
        `Reservation status ${item.reservation.status} does not allow issuance.`,
        { reservationId: item.reservation.id, status: item.reservation.status },
      );
    }
    if (item.requestLine!.quantityIssued + 1 > item.requestLine!.quantityRequested) {
      throw conflict(
        'EXCEEDS_REMAINING',
        'Issuance would exceed the requested quantity for a request line.',
        { requestLineId: item.requestLine!.id },
      );
    }
  }

  private validateReservationItemForConfirm(
    item: ReservationItemForIssuance,
    request: LockedRequestRow,
  ): void {
    this.assertReservationItemBase(item, request);
    if (item.requestLine!.quantityReserved < 1) {
      throw conflict(
        'FULFILLMENT_COUNTER_CONFLICT',
        'Request line has no reserved quantity to convert into an issuance.',
        { requestLineId: item.requestLine!.id },
      );
    }
    if (item.requestLine!.quantityIssued + 1 > item.requestLine!.quantityRequested) {
      throw conflict(
        'EXCEEDS_REMAINING',
        'Issuance would exceed the requested quantity for a request line.',
        { requestLineId: item.requestLine!.id },
      );
    }
  }

  private assertReservationItemBase(
    item: ReservationItemForIssuance,
    request: LockedRequestRow,
  ): void {
    if (item.reservation.requestId !== request.id) {
      throw conflict(
        'RESERVATION_NOT_FOR_REQUEST',
        'Reservation item does not belong to this request.',
        { reservationItemId: item.id },
      );
    }
    if (item.reservation.facilityId !== request.facilityId || item.unit.facilityId !== request.facilityId) {
      throw conflict(
        'FACILITY_SCOPE_VIOLATION',
        'Reservation item or unit is outside the request facility.',
        { reservationItemId: item.id },
      );
    }
    if (!item.isActive) {
      throw conflict('RESERVATION_ITEM_NOT_ACTIVE', 'Reservation item is not active.', {
        reservationItemId: item.id,
      });
    }
    if (!item.requestLine || item.requestLine.requestId !== request.id) {
      throw conflict(
        'LINE_BELONGS_TO_DIFFERENT_REQUEST',
        'Reservation item is not linked to a line of this request.',
        { reservationItemId: item.id },
      );
    }
    if (item.requestLine.componentTypeId !== item.unit.componentTypeId) {
      throw conflict(
        'UNIT_LINE_MISMATCH',
        'Unit component type does not match the request line.',
        { reservationItemId: item.id },
      );
    }
    const effectiveState = this.expiryService.getEffectiveState({
      state: item.unit.state,
      expiresAt: item.unit.expiresAt,
    });
    if (effectiveState !== UnitState.RESERVED) {
      throw conflict(
        'UNIT_NOT_ALLOCATABLE',
        'Unit is not in an eligible reserved state for issuance.',
        { reservationItemId: item.id, state: item.unit.state, effectiveState },
      );
    }
  }
}
