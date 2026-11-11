import { Injectable } from '@nestjs/common';
import {
  FacilityStatus,
  InventoryMovementType,
  NotificationType,
  Prisma,
  TransferStatus,
  UnitState,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { generatePublicCode } from '../../../common/identifiers/public-code';
import { ActorContext, canAtFacility, canGlobally } from '../../rbac/domain/policy';
import { ExpiryService } from '../../inventory/application/expiry.service';
import { InventoryMovementService } from '../../inventory/application/inventory-movement.service';
import { NotificationService } from '../../notifications/application/notification.service';
import { assertValidTransferTransition, canCancelTransfer } from '../domain/transfer-state-machine';
import {
  transferDuplicateItemError,
  transferFacilityNotFoundError,
  transferIdempotencyConflictError,
  transferItemIneligibleError,
  transferItemsRequiredError,
  transferNotApprovableError,
  transferNotCancellableError,
  transferNotDispatchableError,
  transferNotFoundError,
  transferNotPackableError,
  transferNotReceivableError,
  transferNotRejectableError,
  transferOrganizationMismatchError,
  transferReasonRequiredError,
  transferSameFacilityError,
  transferTooManyItemsError,
} from '../domain/transfer.errors';
import {
  TRANSFER_ACTIONS,
  TRANSFER_MAX_ITEMS,
  TRANSFER_PUBLIC_CODE_PREFIX,
} from '../domain/transfer.constants';

export interface TransferContext {
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateTransferInput {
  sourceFacilityId: string;
  destinationFacilityId: string;
  unitIds: string[];
  notes?: string | null;
  idempotencyKey?: string | null;
}

export interface ListTransfersInput {
  status?: TransferStatus;
  limit?: number;
  offset?: number;
}

export interface TransferPageResult {
  items: TransferWithDetails[];
  total: number;
  limit: number;
  offset: number;
}

const TRANSFER_INCLUDE = {
  sourceFacility: { select: { id: true, name: true, code: true, organizationId: true } },
  destinationFacility: { select: { id: true, name: true, code: true, organizationId: true } },
  requestedBy: { select: { id: true, email: true, name: true } },
  approvedBy: { select: { id: true, email: true, name: true } },
  dispatchedBy: { select: { id: true, email: true, name: true } },
  receivedBy: { select: { id: true, email: true, name: true } },
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
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.TransferInclude;

export type TransferWithDetails = Prisma.TransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

interface LockedTransferRow {
  id: string;
  status: TransferStatus;
  sourceFacilityId: string;
  destinationFacilityId: string;
  requestedByUserId: string | null;
}

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryService: ExpiryService,
    private readonly movementService: InventoryMovementService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  private assertCanSource(actor: ActorContext, facilityId: string, permission: string): void {
    if (!canAtFacility(actor, facilityId, permission)) throw transferNotFoundError();
  }

  private canRead(
    actor: ActorContext,
    transfer: { sourceFacilityId: string; destinationFacilityId: string },
  ): boolean {
    if (canGlobally(actor, 'transfer.read')) return true;
    return (
      canAtFacility(actor, transfer.sourceFacilityId, 'transfer.read') ||
      canAtFacility(actor, transfer.destinationFacilityId, 'transfer.read')
    );
  }

  private async loadView(id: string): Promise<TransferWithDetails> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw transferNotFoundError();
    return transfer;
  }

  async list(actor: ActorContext, input: ListTransfersInput): Promise<TransferPageResult> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const where: Prisma.TransferWhereInput = {};
    if (input.status) where.status = input.status;
    if (!canGlobally(actor, 'transfer.read')) {
      const facilityIds = Array.from(actor.facilityPermissions.entries())
        .filter(([, permissions]) => permissions.has('transfer.read'))
        .map(([facilityId]) => facilityId);
      if (!facilityIds.length) return { items: [], total: 0, limit, offset };
      where.OR = [
        { sourceFacilityId: { in: facilityIds } },
        { destinationFacilityId: { in: facilityIds } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transfer.findMany({
        where,
        include: TRANSFER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.transfer.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getById(actor: ActorContext, transferId: string): Promise<TransferWithDetails> {
    const transfer = await this.loadView(transferId);
    if (!this.canRead(actor, transfer)) throw transferNotFoundError();
    return transfer;
  }

  async create(
    actor: ActorContext,
    input: CreateTransferInput,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const unitIds = [...new Set(input.unitIds)];
    if (!unitIds.length) throw transferItemsRequiredError();
    if (unitIds.length > TRANSFER_MAX_ITEMS) {
      throw transferTooManyItemsError(TRANSFER_MAX_ITEMS);
    }
    if (unitIds.length !== input.unitIds.length) {
      throw transferDuplicateItemError();
    }
    if (input.sourceFacilityId === input.destinationFacilityId) throw transferSameFacilityError();

    this.assertCanSource(actor, input.sourceFacilityId, 'transfer.create');
    const facilities = await this.prisma.facility.findMany({
      where: { id: { in: [input.sourceFacilityId, input.destinationFacilityId] } },
      select: { id: true, name: true, code: true, organizationId: true, status: true },
    });
    const source = facilities.find((facility) => facility.id === input.sourceFacilityId);
    const destination = facilities.find((facility) => facility.id === input.destinationFacilityId);
    if (
      !source ||
      !destination ||
      source.status !== FacilityStatus.ACTIVE ||
      destination.status !== FacilityStatus.ACTIVE
    ) {
      throw transferFacilityNotFoundError();
    }
    if (source.organizationId !== destination.organizationId) {
      throw transferOrganizationMismatchError();
    }

    if (input.idempotencyKey) {
      const existing = await this.findByIdempotent(source.id, input.idempotencyKey);
      if (existing) {
        this.assertSameCreateCommand(existing, input, unitIds);
        return { transfer: existing, idempotent: true };
      }
    }

    const sortedIds = [...unitIds].sort();
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(
        async (tx) => {
          if (input.idempotencyKey) {
            const existing = await tx.transfer.findUnique({
              where: {
                sourceFacilityId_idempotencyKey: {
                  sourceFacilityId: source.id,
                  idempotencyKey: input.idempotencyKey,
                },
              },
              include: TRANSFER_INCLUDE,
            });
            if (existing) {
              this.assertSameCreateCommand(existing, input, unitIds);
              return existing.id;
            }
          }

          await this.lockUnits(tx, sortedIds);
          const units = await tx.bloodComponentUnit.findMany({
            where: { id: { in: sortedIds } },
            orderBy: { id: 'asc' },
          });
          if (units.length !== sortedIds.length) {
            const found = new Set(units.map((unit) => unit.id));
            const missing = sortedIds.filter((id) => !found.has(id));
            throw transferItemIneligibleError(missing[0] ?? 'unknown', 'UNIT_NOT_FOUND', {
              unitIds: missing,
            });
          }

          const reservationClaims = await tx.reservationItem.findMany({
            where: { unitId: { in: sortedIds }, isActive: true },
            select: { unitId: true },
          });
          const claimedByReservation = new Set(reservationClaims.map((claim) => claim.unitId));
          const transferClaims = await tx.transferItem.findMany({
            where: { unitId: { in: sortedIds }, isActive: true },
            select: { unitId: true },
          });
          const claimedByTransfer = new Set(transferClaims.map((claim) => claim.unitId));

          for (const unit of units) {
            if (unit.facilityId !== source.id) {
              throw transferItemIneligibleError(unit.id, 'UNIT_NOT_AT_SOURCE_FACILITY');
            }
            if (unit.state !== UnitState.AVAILABLE) {
              throw transferItemIneligibleError(unit.id, 'STATE_NOT_AVAILABLE', {
                state: unit.state,
              });
            }
            if (this.expiryService.getEffectiveState(unit) !== UnitState.AVAILABLE) {
              throw transferItemIneligibleError(unit.id, 'UNIT_EXPIRED');
            }
            if (claimedByReservation.has(unit.id)) {
              throw transferItemIneligibleError(unit.id, 'ACTIVE_RESERVATION_CLAIM');
            }
            if (claimedByTransfer.has(unit.id)) {
              throw transferItemIneligibleError(unit.id, 'ACTIVE_TRANSFER_CLAIM');
            }
          }

          const transfer = await tx.transfer.create({
            data: {
              publicCode: generatePublicCode(TRANSFER_PUBLIC_CODE_PREFIX),
              sourceFacilityId: source.id,
              destinationFacilityId: destination.id,
              requestedByUserId: actor.userId,
              status: TransferStatus.REQUESTED,
              idempotencyKey: input.idempotencyKey ?? null,
              notes: input.notes?.trim() || null,
              metadata: {
                unitIds: sortedIds,
                organizationId: source.organizationId,
              } as Prisma.InputJsonValue,
            },
            select: { id: true },
          });

          for (const unit of units) {
            await tx.transferItem.create({
              data: { transferId: transfer.id, unitId: unit.id, isActive: true },
            });
            await this.movementService.recordMovement(
              {
                unitId: unit.id,
                movementType: InventoryMovementType.STATE_CHANGE,
                toState: UnitState.TRANSFER_PENDING,
                actorUserId: actor.userId,
                facilityId: source.id,
                fromFacilityId: source.id,
                toFacilityId: destination.id,
                transferId: transfer.id,
                reason: 'Transfer requested; unit held at source facility',
                metadata: { destinationFacilityId: destination.id } as Prisma.InputJsonValue,
              },
              tx,
            );
          }
          return transfer.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByIdempotent(source.id, input.idempotencyKey);
        if (existing) {
          this.assertSameCreateCommand(existing, input, unitIds);
          return { transfer: existing, idempotent: true };
        }
      }
      throw error;
    }

    const transfer = await this.loadView(createdId);
    await this.audit.record({
      actorUserId: actor.userId,
      action: TRANSFER_ACTIONS.CREATE,
      targetType: 'Transfer',
      targetId: transfer.id,
      organizationId: source.organizationId,
      facilityId: source.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: {
        destinationFacilityId: destination.id,
        unitIds: sortedIds,
        status: transfer.status,
      },
    });
    await this.notifications.notifySafely({
      actorUserId: actor.userId,
      type: NotificationType.TRANSFER_REQUESTED,
      title: `Transfer ${transfer.publicCode} requested`,
      body: `${transfer.items.length} unit(s) requested from ${source.name} to ${destination.name}.`,
      facilityId: source.id,
      resourceType: 'Transfer',
      resourceId: transfer.id,
      dedupeKey: `transfer:${transfer.id}:requested`,
      metadata: {
        sourceFacilityId: source.id,
        destinationFacilityId: destination.id,
        unitCount: transfer.items.length,
      },
      facilityRecipients: [{ facilityId: source.id, permissions: ['transfer.approve'] }],
      excludeUserIds: [actor.userId],
      auditContext: ctx,
    });
    return { transfer, idempotent: false };
  }

  async approve(
    actor: ActorContext,
    transferId: string,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    this.assertCanSource(actor, existing.sourceFacilityId, 'transfer.approve');
    if (existing.status === TransferStatus.APPROVED) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (existing.status !== TransferStatus.REQUESTED) {
      throw transferNotApprovableError(existing.status);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTransfer(tx, transferId);
      if (!locked) throw transferNotFoundError();
      if (locked.status === TransferStatus.APPROVED) return { idempotent: true };
      if (locked.status !== TransferStatus.REQUESTED)
        throw transferNotApprovableError(locked.status);
      assertValidTransferTransition(locked.status, TransferStatus.APPROVED);
      await tx.transfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.APPROVED,
          approvedAt: new Date(),
          approvedByUserId: actor.userId,
        },
      });
      return { idempotent: false };
    });

    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.APPROVE,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.sourceFacility.organizationId,
        facilityId: transfer.sourceFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { status: transfer.status },
      });
      await this.notifications.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.TRANSFER_APPROVED,
        title: `Incoming transfer ${transfer.publicCode} approved`,
        body: `${transfer.items.length} unit(s) approved from ${transfer.sourceFacility.name}.`,
        facilityId: transfer.destinationFacilityId,
        resourceType: 'Transfer',
        resourceId: transfer.id,
        dedupeKey: `transfer:${transfer.id}:approved`,
        metadata: { unitCount: transfer.items.length },
        facilityRecipients: [
          {
            facilityId: transfer.destinationFacilityId,
            permissions: ['transfer.receive', 'transfer.read'],
          },
        ],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  async pack(
    actor: ActorContext,
    transferId: string,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    this.assertCanSource(actor, existing.sourceFacilityId, 'transfer.pack');
    if (existing.status === TransferStatus.PACKED) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (existing.status !== TransferStatus.APPROVED) {
      throw transferNotPackableError(existing.status);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTransfer(tx, transferId);
      if (!locked) throw transferNotFoundError();
      if (locked.status === TransferStatus.PACKED) return { idempotent: true };
      if (locked.status !== TransferStatus.APPROVED) throw transferNotPackableError(locked.status);
      assertValidTransferTransition(locked.status, TransferStatus.PACKED);
      await tx.transfer.update({
        where: { id: transferId },
        data: { status: TransferStatus.PACKED, packedAt: new Date() },
      });
      return { idempotent: false };
    });
    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.PACK,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.sourceFacility.organizationId,
        facilityId: transfer.sourceFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { status: transfer.status },
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  async dispatch(
    actor: ActorContext,
    transferId: string,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    this.assertCanSource(actor, existing.sourceFacilityId, 'transfer.dispatch');
    if (existing.status === TransferStatus.IN_TRANSIT) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (existing.status !== TransferStatus.PACKED) {
      throw transferNotDispatchableError(existing.status);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockTransfer(tx, transferId);
        if (!locked) throw transferNotFoundError();
        if (locked.status === TransferStatus.IN_TRANSIT) return { idempotent: true };
        if (locked.status !== TransferStatus.PACKED)
          throw transferNotDispatchableError(locked.status);

        const items = await tx.transferItem.findMany({
          where: { transferId, isActive: true },
          include: { unit: true },
          orderBy: { unitId: 'asc' },
        });
        if (!items.length) {
          throw transferNotDispatchableError('NO_ACTIVE_ITEMS');
        }
        await this.lockUnits(tx, items.map((item) => item.unitId).sort());
        const now = new Date();

        assertValidTransferTransition(locked.status, TransferStatus.DISPATCHED);
        await tx.transfer.update({
          where: { id: transferId },
          data: {
            status: TransferStatus.DISPATCHED,
            dispatchedAt: now,
            dispatchedByUserId: actor.userId,
          },
        });

        for (const item of items) {
          if (
            item.unit.state !== UnitState.TRANSFER_PENDING ||
            item.unit.facilityId !== locked.sourceFacilityId
          ) {
            throw transferItemIneligibleError(item.unitId, 'UNIT_NOT_TRANSFER_PENDING', {
              state: item.unit.state,
            });
          }
          // Expiry can elapse while a unit is held for transfer; never dispatch an
          // expired unit even though the claim was valid at request time.
          if (item.unit.expiresAt.getTime() <= now.getTime()) {
            throw transferItemIneligibleError(item.unitId, 'UNIT_EXPIRED');
          }
          await this.movementService.recordMovement(
            {
              unitId: item.unitId,
              movementType: InventoryMovementType.DISPATCHED,
              toState: UnitState.IN_TRANSIT,
              actorUserId: actor.userId,
              facilityId: locked.sourceFacilityId,
              fromFacilityId: locked.sourceFacilityId,
              toFacilityId: locked.destinationFacilityId,
              transferId,
              reason: 'Transfer dispatched to destination facility',
              metadata: { transferId } as Prisma.InputJsonValue,
            },
            tx,
          );
          await tx.transferItem.update({
            where: { id: item.id },
            data: { dispatchedAt: now },
          });
        }

        assertValidTransferTransition(TransferStatus.DISPATCHED, TransferStatus.IN_TRANSIT);
        await tx.transfer.update({
          where: { id: transferId },
          data: { status: TransferStatus.IN_TRANSIT, inTransitAt: now },
        });
        return { idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.DISPATCH,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.sourceFacility.organizationId,
        facilityId: transfer.sourceFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: {
          status: transfer.status,
          unitIds: transfer.items.map((item) => item.unitId),
        },
      });
      await this.notifications.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.TRANSFER_DISPATCHED,
        title: `Transfer ${transfer.publicCode} in transit`,
        body: `${transfer.items.length} unit(s) dispatched from ${transfer.sourceFacility.name}; receipt is required.`,
        facilityId: transfer.destinationFacilityId,
        resourceType: 'Transfer',
        resourceId: transfer.id,
        dedupeKey: `transfer:${transfer.id}:dispatched`,
        metadata: { unitCount: transfer.items.length },
        facilityRecipients: [
          {
            facilityId: transfer.destinationFacilityId,
            permissions: ['transfer.receive'],
          },
        ],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  async receive(
    actor: ActorContext,
    transferId: string,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    if (!canAtFacility(actor, existing.destinationFacilityId, 'transfer.receive')) {
      throw transferNotFoundError();
    }
    if (existing.status === TransferStatus.RECEIVED) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (existing.status !== TransferStatus.IN_TRANSIT) {
      throw transferNotReceivableError(existing.status);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockTransfer(tx, transferId);
        if (!locked) throw transferNotFoundError();
        if (locked.status === TransferStatus.RECEIVED) return { idempotent: true };
        if (locked.status !== TransferStatus.IN_TRANSIT)
          throw transferNotReceivableError(locked.status);

        const items = await tx.transferItem.findMany({
          where: { transferId, isActive: true },
          include: { unit: true },
          orderBy: { unitId: 'asc' },
        });
        if (!items.length) throw transferNotReceivableError('NO_ACTIVE_ITEMS');
        await this.lockUnits(tx, items.map((item) => item.unitId).sort());
        const now = new Date();

        for (const item of items) {
          if (
            item.unit.state !== UnitState.IN_TRANSIT ||
            item.unit.facilityId !== locked.sourceFacilityId
          ) {
            throw transferItemIneligibleError(item.unitId, 'UNIT_NOT_IN_TRANSIT', {
              state: item.unit.state,
            });
          }
          await tx.bloodComponentUnit.update({
            where: { id: item.unitId },
            data: { facility: { connect: { id: locked.destinationFacilityId } } },
          });
          await this.movementService.recordMovement(
            {
              unitId: item.unitId,
              movementType: InventoryMovementType.RECEIVED,
              toState: UnitState.RECEIVED,
              actorUserId: actor.userId,
              facilityId: locked.destinationFacilityId,
              fromFacilityId: locked.sourceFacilityId,
              toFacilityId: locked.destinationFacilityId,
              transferId,
              reason: 'Transfer received at destination facility',
              metadata: { transferId } as Prisma.InputJsonValue,
              unitUpdate: { receivedAt: now },
            },
            tx,
          );
          await tx.transferItem.update({
            where: { id: item.id },
            data: { receivedAt: now, isActive: false },
          });
        }

        assertValidTransferTransition(locked.status, TransferStatus.RECEIVED);
        await tx.transfer.update({
          where: { id: transferId },
          data: {
            status: TransferStatus.RECEIVED,
            receivedAt: now,
            receivedByUserId: actor.userId,
          },
        });
        return { idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.RECEIVE,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.destinationFacility.organizationId,
        facilityId: transfer.destinationFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: {
          status: transfer.status,
          unitIds: transfer.items.map((item) => item.unitId),
        },
      });
      await this.notifications.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.TRANSFER_RECEIVED,
        title: `Transfer ${transfer.publicCode} received`,
        body: `${transfer.items.length} unit(s) received at ${transfer.destinationFacility.name}.`,
        facilityId: transfer.sourceFacilityId,
        resourceType: 'Transfer',
        resourceId: transfer.id,
        dedupeKey: `transfer:${transfer.id}:received`,
        metadata: { unitCount: transfer.items.length },
        facilityRecipients: [
          { facilityId: transfer.sourceFacilityId, permissions: ['transfer.read'] },
        ],
        explicitUserIds: [transfer.requestedByUserId],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  async cancel(
    actor: ActorContext,
    transferId: string,
    reason: string | null,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    this.assertCanSource(actor, existing.sourceFacilityId, 'transfer.cancel');
    if (existing.status === TransferStatus.CANCELLED) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (!canCancelTransfer(existing.status)) {
      throw transferNotCancellableError(existing.status);
    }

    const result = await this.releaseAndClose(
      actor,
      transferId,
      TransferStatus.CANCELLED,
      {
        status: TransferStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: { connect: { id: actor.userId } },
        cancellationReason: reason?.trim() || null,
      },
      'Transfer cancelled; units returned to available inventory',
    );

    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.CANCEL,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.sourceFacility.organizationId,
        facilityId: transfer.sourceFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { status: transfer.status, reason: reason ?? null },
      });
      await this.notifications.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.TRANSFER_CANCELLED,
        title: `Transfer ${transfer.publicCode} cancelled`,
        body: `A transfer from ${transfer.sourceFacility.name} to ${transfer.destinationFacility.name} was cancelled.`,
        facilityId: transfer.destinationFacilityId,
        resourceType: 'Transfer',
        resourceId: transfer.id,
        dedupeKey: `transfer:${transfer.id}:cancelled`,
        facilityRecipients: [
          { facilityId: transfer.destinationFacilityId, permissions: ['transfer.read'] },
        ],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  async reject(
    actor: ActorContext,
    transferId: string,
    reason: string | null,
    ctx: TransferContext,
  ): Promise<{ transfer: TransferWithDetails; idempotent: boolean }> {
    const existing = await this.getLockedSummary(transferId);
    this.assertCanSource(actor, existing.sourceFacilityId, 'transfer.approve');
    const trimmed = reason?.trim();
    if (!trimmed) throw transferReasonRequiredError('rejection');
    if (existing.status === TransferStatus.REJECTED) {
      return { transfer: await this.loadView(transferId), idempotent: true };
    }
    if (existing.status !== TransferStatus.REQUESTED) {
      throw transferNotRejectableError(existing.status);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockTransfer(tx, transferId);
        if (!locked) throw transferNotFoundError();
        if (locked.status === TransferStatus.REJECTED) return { idempotent: true };
        if (locked.status !== TransferStatus.REQUESTED)
          throw transferNotRejectableError(locked.status);
        await this.releaseUnits(
          tx,
          locked,
          actor.userId,
          'Transfer rejected; units returned to available inventory',
        );
        assertValidTransferTransition(locked.status, TransferStatus.REJECTED);
        await tx.transfer.update({
          where: { id: transferId },
          data: {
            status: TransferStatus.REJECTED,
            rejectedAt: new Date(),
            rejectedByUserId: actor.userId,
            rejectionReason: trimmed,
          },
        });
        return { idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const transfer = await this.loadView(transferId);
    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: TRANSFER_ACTIONS.REJECT,
        targetType: 'Transfer',
        targetId: transferId,
        organizationId: transfer.sourceFacility.organizationId,
        facilityId: transfer.sourceFacilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { status: transfer.status, reason: trimmed },
      });
      await this.notifications.notifySafely({
        actorUserId: actor.userId,
        type: NotificationType.TRANSFER_REJECTED,
        title: `Transfer ${transfer.publicCode} rejected`,
        body: `A transfer from ${transfer.sourceFacility.name} to ${transfer.destinationFacility.name} was rejected.`,
        facilityId: transfer.sourceFacilityId,
        resourceType: 'Transfer',
        resourceId: transfer.id,
        dedupeKey: `transfer:${transfer.id}:rejected`,
        facilityRecipients: [
          { facilityId: transfer.sourceFacilityId, permissions: ['transfer.read'] },
        ],
        explicitUserIds: [transfer.requestedByUserId],
        excludeUserIds: [actor.userId],
        auditContext: ctx,
      });
    }
    return { transfer, idempotent: result.idempotent };
  }

  private async releaseAndClose(
    actor: ActorContext,
    transferId: string,
    expectedTarget: TransferStatus,
    data: Prisma.TransferUpdateInput,
    reason: string,
  ): Promise<{ idempotent: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockTransfer(tx, transferId);
        if (!locked) throw transferNotFoundError();
        if (locked.status === expectedTarget) return { idempotent: true };
        if (!canCancelTransfer(locked.status)) throw transferNotCancellableError(locked.status);
        await this.releaseUnits(tx, locked, actor.userId, reason);
        assertValidTransferTransition(locked.status, expectedTarget);
        await tx.transfer.update({ where: { id: transferId }, data });
        return { idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async releaseUnits(
    tx: Prisma.TransactionClient,
    transfer: LockedTransferRow,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const items = await tx.transferItem.findMany({
      where: { transferId: transfer.id, isActive: true },
      include: { unit: true },
      orderBy: { unitId: 'asc' },
    });
    await this.lockUnits(tx, items.map((item) => item.unitId).sort());
    for (const item of items) {
      if (item.unit.state !== UnitState.TRANSFER_PENDING) {
        throw transferItemIneligibleError(item.unitId, 'UNIT_NOT_TRANSFER_PENDING', {
          state: item.unit.state,
        });
      }
      await this.movementService.recordMovement(
        {
          unitId: item.unitId,
          movementType: InventoryMovementType.STATE_CHANGE,
          toState: UnitState.AVAILABLE,
          actorUserId,
          facilityId: transfer.sourceFacilityId,
          transferId: transfer.id,
          reason,
          metadata: {
            destinationFacilityId: transfer.destinationFacilityId,
          } as Prisma.InputJsonValue,
        },
        tx,
      );
      await tx.transferItem.update({
        where: { id: item.id },
        data: { isActive: false },
      });
    }
  }

  private async getLockedSummary(transferId: string): Promise<LockedTransferRow> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
      select: {
        id: true,
        status: true,
        sourceFacilityId: true,
        destinationFacilityId: true,
        requestedByUserId: true,
      },
    });
    if (!transfer) throw transferNotFoundError();
    return transfer;
  }

  private async findByIdempotent(
    sourceFacilityId: string,
    idempotencyKey: string,
  ): Promise<TransferWithDetails | null> {
    return this.prisma.transfer.findUnique({
      where: { sourceFacilityId_idempotencyKey: { sourceFacilityId, idempotencyKey } },
      include: TRANSFER_INCLUDE,
    });
  }

  private assertSameCreateCommand(
    existing: TransferWithDetails,
    input: CreateTransferInput,
    unitIds: string[],
  ): void {
    const metadata = (existing.metadata ?? {}) as { unitIds?: unknown };
    const existingUnits = Array.isArray(metadata.unitIds)
      ? metadata.unitIds.filter((id): id is string => typeof id === 'string').sort()
      : [];
    const requestedUnits = [...unitIds].sort();
    const sameUnits =
      existingUnits.length === requestedUnits.length &&
      existingUnits.every((id, index) => id === requestedUnits[index]);
    if (existing.destinationFacilityId !== input.destinationFacilityId || !sameUnits) {
      throw transferIdempotencyConflictError();
    }
  }

  private async lockTransfer(
    tx: Prisma.TransactionClient,
    transferId: string,
  ): Promise<LockedTransferRow | undefined> {
    const rows = await tx.$queryRaw<LockedTransferRow[]>(
      Prisma.sql`SELECT id, status, "sourceFacilityId", "destinationFacilityId", "requestedByUserId"
                 FROM "Transfer" WHERE id = ${transferId} FOR UPDATE`,
    );
    return rows[0];
  }

  private async lockUnits(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "BloodComponentUnit" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
  }
}
