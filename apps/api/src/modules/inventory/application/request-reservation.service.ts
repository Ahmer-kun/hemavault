import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BloodRequestStatus,
  InventoryMovementType,
  Prisma,
  ReservationStatus,
  UnitState,
} from '@prisma/client';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { ActorContext, canAtFacility, canGlobally } from '../../rbac/domain/policy';
import { canTransitionRequest } from '../../requests/domain/request-state-machine';
import { requestNotFoundError } from '../../requests/domain/request.errors';
import { evaluateCompatibility } from '../../matching/domain/compatibility-evaluator';
import { selectActiveRuleSet } from '../../matching/domain/rule-set-policy';
import { CompatibilityRuleSetRepository } from '../../matching/infrastructure/compatibility-rule-set.repository';
import { ExpiryService } from './expiry.service';

interface RequestContextMeta {
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateRequestReservationInput {
  requestId: string;
  items: Array<{ unitId: string; requestLineId: string }>;
  idempotencyKey?: string | null;
}

function notFoundReservation(): AppHttpException {
  return new AppHttpException(HttpStatus.NOT_FOUND, 'RESERVATION_NOT_FOUND', 'The requested reservation could not be found.');
}
function conflict(code: string, message: string, details: Record<string, unknown> = {}): AppHttpException {
  return new AppHttpException(HttpStatus.CONFLICT, code, message, details);
}
function badRequest(code: string, message: string, details: Record<string, unknown> = {}): AppHttpException {
  return new AppHttpException(HttpStatus.BAD_REQUEST, code, message, details);
}

const RESERVATION_INCLUDE = {
  items: {
    include: {
      unit: { select: { id: true, publicCode: true, state: true, expiresAt: true, bloodGroup: true, componentTypeId: true } },
      requestLine: { select: { id: true, componentTypeId: true, bloodGroupRequired: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  request: { select: { id: true, publicCode: true, status: true, facilityId: true } },
  facility: { select: { id: true, name: true, code: true } },
} satisfies Prisma.ReservationInclude;

@Injectable()
export class RequestReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryService: ExpiryService,
    private readonly ruleSetRepository: CompatibilityRuleSetRepository,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async resolveRuleSetOrThrow() {
    const candidates = await this.ruleSetRepository.findActiveCandidates();
    const decision = selectActiveRuleSet(candidates, {
      allowNonClinicalFixturesInTest: this.config.get<string>('NODE_ENV') === 'test',
    });
    if (!decision.ok) {
      const code = decision.reason === 'AMBIGUOUS' ? 'MATCHING_POLICY_UNAVAILABLE' : 'MATCHING_POLICY_UNAVAILABLE';
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        code,
        'Reservation cannot proceed because no approved active compatibility policy is available for production use.',
        { reason: decision.reason === 'AMBIGUOUS' ? 'AMBIGUOUS_RULE_SET' : decision.reason },
      );
    }
    return decision.ruleSet;
  }

  private assertCanReserve(actor: ActorContext, facilityId: string): void {
    if (canGlobally(actor, 'inventory.reserve')) return;
    if (canAtFacility(actor, facilityId, 'inventory.reserve')) return;
    throw requestNotFoundError(); // mask
  }
  private assertCanRead(actor: ActorContext, facilityId: string): void {
    if (canGlobally(actor, 'request.read') || canGlobally(actor, 'inventory.read')) return;
    if (canAtFacility(actor, facilityId, 'request.read') || canAtFacility(actor, facilityId, 'inventory.read')) return;
    throw requestNotFoundError();
  }
  private assertCanRelease(actor: ActorContext, facilityId: string): void {
    if (canGlobally(actor, 'inventory.release_reservation') || canGlobally(actor, 'inventory.reserve')) return;
    if (
      canAtFacility(actor, facilityId, 'inventory.release_reservation') ||
      canAtFacility(actor, facilityId, 'inventory.reserve')
    )
      return;
    throw notFoundReservation();
  }

  async listForRequest(actor: ActorContext, requestId: string) {
    const request = await this.prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: { id: true, facilityId: true },
    });
    if (!request) throw requestNotFoundError();
    this.assertCanRead(actor, request.facilityId);
    return this.prisma.reservation.findMany({
      where: { requestId },
      include: RESERVATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getById(actor: ActorContext, reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw notFoundReservation();
    this.assertCanRead(actor, reservation.facilityId);
    return reservation;
  }

  async createForRequest(actor: ActorContext, input: CreateRequestReservationInput, ctx: RequestContextMeta) {
    if (!input.items.length) throw badRequest('RESERVATION_ITEMS_REQUIRED', 'At least one reservation item is required.');
    const uniqueUnitIds = [...new Set(input.items.map((i) => i.unitId))];
    if (uniqueUnitIds.length !== input.items.length) {
      throw badRequest('DUPLICATE_RESERVATION_UNIT', 'Each unit can only be reserved once in a single reservation request.');
    }

    // Preload request for facility scope (404 masking) before policy gate side effects.
    const request = await this.prisma.bloodRequest.findUnique({
      where: { id: input.requestId },
      include: { lines: true },
    });
    if (!request) throw requestNotFoundError();
    this.assertCanReserve(actor, request.facilityId);

    const ruleSet = await this.resolveRuleSetOrThrow();

    // Idempotency fast path (same facility scope)
    if (input.idempotencyKey) {
      const existing = await this.prisma.reservation.findUnique({
        where: { facilityId_idempotencyKey: { facilityId: request.facilityId, idempotencyKey: input.idempotencyKey } },
        include: RESERVATION_INCLUDE,
      });
      if (existing) {
        if (existing.requestId !== request.id) {
          throw conflict('IDEMPOTENCY_KEY_CONFLICT', 'The idempotency key was already used for a different reservation.');
        }
        return { reservation: existing, idempotent: true };
      }
    }

    const lineById = new Map(request.lines.map((l) => [l.id, l]));
    for (const item of input.items) {
      const line = lineById.get(item.requestLineId);
      if (!line || line.requestId !== request.id) {
        throw badRequest('INVALID_REQUEST_LINE', 'One or more request lines are invalid for this request.', { requestLineId: item.requestLineId });
      }
    }

    // Validate request state allows reservation.
    const reservableStatuses = new Set<BloodRequestStatus>([
      BloodRequestStatus.APPROVED,
      BloodRequestStatus.RESERVED,
      BloodRequestStatus.PARTIALLY_FULFILLED,
    ]);
    if (!reservableStatuses.has(request.status)) {
      throw conflict('REQUEST_NOT_RESERVABLE', `Request status ${request.status} does not allow reservation.`, {
        status: request.status,
      });
    }

    const sortedUnitIds = uniqueUnitIds.sort();
    const result = await this.prisma.$transaction(async (tx) => {
      // Idempotency inside transaction (race-safe)
      if (input.idempotencyKey) {
        const existing = await tx.reservation.findUnique({
          where: { facilityId_idempotencyKey: { facilityId: request.facilityId, idempotencyKey: input.idempotencyKey } },
          include: RESERVATION_INCLUDE,
        });
        if (existing) {
          if (existing.requestId !== request.id) {
            throw conflict('IDEMPOTENCY_KEY_CONFLICT', 'The idempotency key was already used for a different reservation.');
          }
          return { reservation: existing, idempotent: true };
        }
      }

      // Re-read request under transaction context for freshest status/quantities.
      const reqRows = await tx.$queryRaw<Array<{ id: string; status: BloodRequestStatus; facilityId: string }>>(
        Prisma.sql`SELECT id, status, "facilityId" FROM "BloodRequest" WHERE id = ${request.id} FOR UPDATE`,
      );
      const lockedReq = reqRows[0];
      if (!lockedReq || lockedReq.facilityId !== request.facilityId) throw requestNotFoundError();
      if (!reservableStatuses.has(lockedReq.status)) {
        throw conflict('REQUEST_NOT_RESERVABLE', `Request status ${lockedReq.status} does not allow reservation.`, {
          status: lockedReq.status,
        });
      }

      const lines = await tx.bloodRequestLine.findMany({ where: { requestId: request.id } });
      const lockedLineById = new Map(lines.map((l) => [l.id, l]));

      // Lock units in deterministic order to reduce deadlocks.
      const unitRows = await tx.$queryRaw<Array<{
        id: string; state: UnitState; expiresAt: Date; facilityId: string; componentTypeId: string; bloodGroup: any; publicCode: string;
      }>>(
        Prisma.sql`SELECT u.id, u.state, u."expiresAt", u."facilityId", u."componentTypeId", u."bloodGroup", u."publicCode"
                    FROM "BloodComponentUnit" u
                    WHERE u.id IN (${Prisma.join(sortedUnitIds)})
                    ORDER BY u.id
                    FOR UPDATE`,
      );
      if (unitRows.length !== sortedUnitIds.length) {
        const found = new Set(unitRows.map((r) => r.id));
        const missing = sortedUnitIds.filter((id) => !found.has(id));
        throw badRequest('INVENTORY_UNIT_NOT_FOUND', 'One or more units could not be found.', { unitIds: missing });
      }

      // Check active claims under lock.
      const activeClaims = await tx.reservationItem.findMany({
        where: { unitId: { in: sortedUnitIds }, isActive: true },
        select: { unitId: true, reservationId: true },
      });
      if (activeClaims.length > 0) {
        throw conflict('UNIT_ALREADY_RESERVED', 'One or more units already have an active reservation claim.', {
          unitIds: activeClaims.map((c) => c.unitId),
        });
      }

      // Fetch component categories for compatibility evaluation.
      const unitTypeIds = [...new Set(unitRows.map((u) => u.componentTypeId))];
      const componentTypes = await tx.componentType.findMany({
        where: { id: { in: unitTypeIds } },
        select: { id: true, category: true },
      });
      const typeById = new Map(componentTypes.map((t) => [t.id, t]));

      const lineReservedDelta = new Map<string, number>();

      for (const item of input.items) {
        const line = lockedLineById.get(item.requestLineId)!;
        const unit = unitRows.find((u) => u.id === item.unitId)!;

        if (unit.facilityId !== request.facilityId) {
          throw conflict('FACILITY_SCOPE_VIOLATION', 'Unit does not belong to the request facility.', { unitId: unit.id });
        }
        if (this.expiryService.getEffectiveState({ state: unit.state, expiresAt: unit.expiresAt }) !== UnitState.AVAILABLE) {
          throw conflict('UNIT_NOT_AVAILABLE', 'Unit is not eligible for reservation.', {
            unitId: unit.id,
            state: unit.state,
            effectiveState: this.expiryService.getEffectiveState({ state: unit.state, expiresAt: unit.expiresAt }),
          });
        }
        if (unit.componentTypeId !== line.componentTypeId) {
          throw conflict('UNIT_LINE_MISMATCH', 'Unit component type does not match the request line.', {
            unitId: unit.id,
            requestLineId: line.id,
          });
        }

        const unitCategory = typeById.get(unit.componentTypeId)?.category;
        const lineCategory = (await tx.componentType.findUnique({ where: { id: line.componentTypeId }, select: { category: true } }))?.category;
        const decision = evaluateCompatibility(ruleSet.rules, {
          componentTypeId: line.componentTypeId,
          componentTypeCategory: (lineCategory ?? unitCategory)!,
          bloodGroupRequired: line.bloodGroupRequired,
        }, {
          componentTypeId: unit.componentTypeId,
          componentTypeCategory: unitCategory!,
          bloodGroup: unit.bloodGroup,
        });
        if (decision.status !== 'COMPATIBLE') {
          throw conflict('UNIT_NOT_COMPATIBLE', 'Unit is not compatible with the request line under the active approved policy.', {
            unitId: unit.id,
            requestLineId: line.id,
            compatibility: decision.status,
          });
        }

        lineReservedDelta.set(line.id, (lineReservedDelta.get(line.id) ?? 0) + 1);
      }

      // Prevent over-reservation.
      for (const [lineId, delta] of lineReservedDelta.entries()) {
        const line = lockedLineById.get(lineId)!;
        const remaining = Math.max(0, line.quantityRequested - line.quantityReserved - line.quantityIssued);
        if (delta > remaining) {
          throw conflict('RESERVATION_EXCEEDS_REMAINING', 'Reservation would exceed remaining quantity for a request line.', {
            requestLineId: lineId,
            remaining,
            requested: delta,
          });
        }
      }

      const reservation = await tx.reservation.create({
        data: {
          requestId: request.id,
          facilityId: request.facilityId,
          createdById: actor.userId,
          status: ReservationStatus.ACTIVE,
          idempotencyKey: input.idempotencyKey ?? null,
          ruleSetVersion: ruleSet.version,
          metadata: { ruleSetCode: ruleSet.code, ruleSetId: ruleSet.id, isNonClinicalFixture: ruleSet.isNonClinicalFixture } as Prisma.InputJsonValue,
        },
      });

      for (const item of input.items) {
        await tx.reservationItem.create({
          data: { reservationId: reservation.id, unitId: item.unitId, requestLineId: item.requestLineId, isActive: true },
        });

        const updated = await tx.bloodComponentUnit.updateMany({
          where: { id: item.unitId, state: UnitState.AVAILABLE },
          data: { state: UnitState.RESERVED },
        });
        if (updated.count !== 1) throw conflict('INVENTORY_UNIT_STATE_CONFLICT', 'Unit state changed during reservation.', { unitId: item.unitId });

        await tx.inventoryMovement.create({
          data: {
            unitId: item.unitId,
            facilityId: request.facilityId,
            actorUserId: actor.userId,
            movementType: 'RESERVED' as InventoryMovementType,
            fromState: UnitState.AVAILABLE,
            toState: UnitState.RESERVED,
            reservationId: reservation.id,
            reason: 'Request-scoped reservation',
            metadata: { requestId: request.id, requestLineId: item.requestLineId, ruleSetVersion: ruleSet.version } as Prisma.InputJsonValue,
          },
        });
      }

      // Update line reserved quantities.
      for (const [lineId, delta] of lineReservedDelta.entries()) {
        await tx.bloodRequestLine.update({
          where: { id: lineId },
          data: { quantityReserved: { increment: delta } },
        });
      }

      // Update request status based on fulfillment state.
      const updatedLines = await tx.bloodRequestLine.findMany({ where: { requestId: request.id } });
      const allFullyReservedOrIssued = updatedLines.every((l) => l.quantityReserved + l.quantityIssued >= l.quantityRequested);
      const anyReservedOrIssued = updatedLines.some((l) => l.quantityReserved + l.quantityIssued > 0);
      let nextStatus: BloodRequestStatus | null = null;
      if (lockedReq.status === BloodRequestStatus.APPROVED && anyReservedOrIssued) {
        nextStatus = allFullyReservedOrIssued ? BloodRequestStatus.RESERVED : BloodRequestStatus.RESERVED;
        // APPROVED -> RESERVED is valid; further fulfillment tracked via RESERVED/PARTIALLY_FULFILLED on issuance.
        if (canTransitionRequest(lockedReq.status, BloodRequestStatus.RESERVED)) nextStatus = BloodRequestStatus.RESERVED;
      } else if (lockedReq.status === BloodRequestStatus.RESERVED || lockedReq.status === BloodRequestStatus.PARTIALLY_FULFILLED) {
        if (allFullyReservedOrIssued) nextStatus = lockedReq.status; // keep; issuance drives fulfillment
        else if (anyReservedOrIssued && lockedReq.status === BloodRequestStatus.RESERVED) nextStatus = lockedReq.status;
      }
      if (nextStatus && nextStatus !== lockedReq.status) {
        await tx.bloodRequest.update({ where: { id: request.id }, data: { status: nextStatus } });
      }

      const full = await tx.reservation.findUnique({ where: { id: reservation.id }, include: RESERVATION_INCLUDE });
      return { reservation: full!, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!result.idempotent) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'reservation.created',
        targetType: 'Reservation',
        targetId: result.reservation.id,
        facilityId: request.facilityId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: {
          requestId: request.id,
          unitIds: sortedUnitIds,
          itemCount: input.items.length,
          ruleSetVersion: result.reservation.ruleSetVersion,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    }
    return result;
  }

  async release(actor: ActorContext, reservationId: string, reason: string | null, ctx: RequestContextMeta) {
    const existing = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: RESERVATION_INCLUDE });
    if (!existing) throw notFoundReservation();
    this.assertCanRelease(actor, existing.facilityId);
    if (existing.status !== ReservationStatus.ACTIVE && existing.status !== ReservationStatus.CONFIRMED) {
      throw conflict('RESERVATION_NOT_RELEASABLE', `Reservation status ${existing.status} cannot be released.`, { status: existing.status });
    }

    const released = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string; status: ReservationStatus; requestId: string | null }>>(
        Prisma.sql`SELECT id, status, "requestId" FROM "Reservation" WHERE id = ${reservationId} FOR UPDATE`,
      );
      const locked = lockedRows[0];
      if (!locked) throw notFoundReservation();
      if (locked.status !== ReservationStatus.ACTIVE && locked.status !== ReservationStatus.CONFIRMED) {
        throw conflict('RESERVATION_NOT_RELEASABLE', `Reservation status ${locked.status} cannot be released.`, { status: locked.status });
      }

      const items = await tx.reservationItem.findMany({ where: { reservationId, isActive: true } });
      const unitIds = items.map((i) => i.unitId).sort();
      if (unitIds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "BloodComponentUnit" WHERE id IN (${Prisma.join(unitIds)}) ORDER BY id FOR UPDATE`);
      }

      for (const item of items) {
        const unit = await tx.bloodComponentUnit.findUnique({ where: { id: item.unitId } });
        if (!unit) throw conflict('INVENTORY_UNIT_NOT_FOUND', 'Reserved unit no longer exists.', { unitId: item.unitId });
        // RESERVED -> AVAILABLE is valid per state machine; only release if still RESERVED.
        if (unit.state !== UnitState.RESERVED) {
          throw conflict('INVENTORY_UNIT_STATE_CONFLICT', 'Unit is not in RESERVED state; cannot release reservation claim.', {
            unitId: item.unitId,
            state: unit.state,
          });
        }
        await tx.bloodComponentUnit.update({ where: { id: item.unitId }, data: { state: UnitState.AVAILABLE } });
        await tx.inventoryMovement.create({
          data: {
            unitId: item.unitId,
            facilityId: existing.facilityId,
            actorUserId: actor.userId,
            movementType: 'RESERVATION_RELEASED' as InventoryMovementType,
            fromState: UnitState.RESERVED,
            toState: UnitState.AVAILABLE,
            reservationId,
            reason: reason ?? 'Reservation released',
            metadata: { requestId: existing.requestId, requestLineId: item.requestLineId } as Prisma.InputJsonValue,
          },
        });
        await tx.reservationItem.update({ where: { id: item.id }, data: { isActive: false, releasedAt: new Date() } });
        if (item.requestLineId) {
          await tx.bloodRequestLine.update({
            where: { id: item.requestLineId },
            data: { quantityReserved: { decrement: 1 } },
          });
        }
      }

      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.RELEASED, releasedAt: new Date() },
      });

      // Recompute request status from remaining active reservations/line quantities.
      if (locked.requestId) {
        await this.recomputeRequestReservationState(tx, locked.requestId);
      }

      return tx.reservation.findUnique({ where: { id: reservationId }, include: RESERVATION_INCLUDE });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'reservation.released',
      targetType: 'Reservation',
      targetId: reservationId,
      facilityId: existing.facilityId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: { requestId: existing.requestId, reason: reason ?? null },
    });
    return released;
  }

  async confirm(actor: ActorContext, reservationId: string, ctx: RequestContextMeta) {
    const existing = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: RESERVATION_INCLUDE });
    if (!existing) throw notFoundReservation();
    this.assertCanRelease(actor, existing.facilityId); // same operational authority scope
    if (existing.status !== ReservationStatus.ACTIVE) {
      throw conflict('RESERVATION_NOT_CONFIRMABLE', `Reservation status ${existing.status} cannot be confirmed.`, { status: existing.status });
    }
    const confirmed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: ReservationStatus }>>(
        Prisma.sql`SELECT id, status FROM "Reservation" WHERE id = ${reservationId} FOR UPDATE`,
      );
      if (!rows[0] || rows[0].status !== ReservationStatus.ACTIVE) {
        throw conflict('RESERVATION_NOT_CONFIRMABLE', 'Reservation is not in ACTIVE state.');
      }
      // Ensure all active items still RESERVED.
      const items = await tx.reservationItem.findMany({ where: { reservationId, isActive: true }, include: { unit: true } });
      if (items.some((i) => i.unit.state !== UnitState.RESERVED)) {
        throw conflict('INVENTORY_UNIT_STATE_CONFLICT', 'One or more reserved units are no longer in RESERVED state.');
      }
      return tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CONFIRMED, confirmedAt: new Date() },
        include: RESERVATION_INCLUDE,
      });
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'reservation.confirmed',
      targetType: 'Reservation',
      targetId: reservationId,
      facilityId: existing.facilityId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: { requestId: existing.requestId },
    });
    return confirmed;
  }

  async cancel(actor: ActorContext, reservationId: string, reason: string | null, ctx: RequestContextMeta) {
    const existing = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: RESERVATION_INCLUDE });
    if (!existing) throw notFoundReservation();
    this.assertCanRelease(actor, existing.facilityId);
    if (existing.status !== ReservationStatus.ACTIVE && existing.status !== ReservationStatus.CONFIRMED) {
      throw conflict('RESERVATION_NOT_CANCELLABLE', `Reservation status ${existing.status} cannot be cancelled.`, { status: existing.status });
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string; status: ReservationStatus; requestId: string | null }>>(
        Prisma.sql`SELECT id, status, "requestId" FROM "Reservation" WHERE id = ${reservationId} FOR UPDATE`,
      );
      const locked = lockedRows[0];
      if (!locked) throw notFoundReservation();
      if (locked.status !== ReservationStatus.ACTIVE && locked.status !== ReservationStatus.CONFIRMED) {
        throw conflict('RESERVATION_NOT_CANCELLABLE', `Reservation status ${locked.status} cannot be cancelled.`, { status: locked.status });
      }
      const items = await tx.reservationItem.findMany({ where: { reservationId, isActive: true } });
      const unitIds = items.map((i) => i.unitId).sort();
      if (unitIds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "BloodComponentUnit" WHERE id IN (${Prisma.join(unitIds)}) ORDER BY id FOR UPDATE`);
      }
      for (const item of items) {
        const unit = await tx.bloodComponentUnit.findUnique({ where: { id: item.unitId } });
        if (unit?.state === UnitState.RESERVED) {
          await tx.bloodComponentUnit.update({ where: { id: item.unitId }, data: { state: UnitState.AVAILABLE } });
          await tx.inventoryMovement.create({
            data: {
              unitId: item.unitId,
              facilityId: existing.facilityId,
              actorUserId: actor.userId,
              movementType: 'RESERVATION_RELEASED' as InventoryMovementType,
              fromState: UnitState.RESERVED,
              toState: UnitState.AVAILABLE,
              reservationId,
              reason: reason ?? 'Reservation cancelled',
              metadata: { requestId: existing.requestId, requestLineId: item.requestLineId, cancelled: true } as Prisma.InputJsonValue,
            },
          });
        }
        await tx.reservationItem.update({ where: { id: item.id }, data: { isActive: false, releasedAt: new Date() } });
        if (item.requestLineId) {
          const line = await tx.bloodRequestLine.findUnique({ where: { id: item.requestLineId } });
          if (line && line.quantityReserved > 0) {
            await tx.bloodRequestLine.update({ where: { id: item.requestLineId }, data: { quantityReserved: { decrement: 1 } } });
          }
        }
      }
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (locked.requestId) await this.recomputeRequestReservationState(tx, locked.requestId);
      return tx.reservation.findUnique({ where: { id: reservationId }, include: RESERVATION_INCLUDE });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'reservation.cancelled',
      targetType: 'Reservation',
      targetId: reservationId,
      facilityId: existing.facilityId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: { requestId: existing.requestId, reason: reason ?? null },
    });
    return cancelled;
  }

  private async recomputeRequestReservationState(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
    const req = await tx.bloodRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
    if (!req) return;
    // Don't touch terminal-ish request states except those that can be affected; preserve FULFILLED/CANCELLED/REJECTED/EXPIRED.
    const terminal = new Set<BloodRequestStatus>([
      BloodRequestStatus.FULFILLED,
      BloodRequestStatus.CANCELLED,
      BloodRequestStatus.REJECTED,
      BloodRequestStatus.EXPIRED,
    ]);
    if (terminal.has(req.status)) {
      return;
    }
    const anyReserved = req.lines.some((l) => l.quantityReserved > 0);
    const anyIssued = req.lines.some((l) => l.quantityIssued > 0);
    const allIssued = req.lines.length > 0 && req.lines.every((l) => l.quantityIssued >= l.quantityRequested);
    let next: BloodRequestStatus = req.status;
    if (allIssued) next = BloodRequestStatus.FULFILLED;
    else if (anyIssued) next = BloodRequestStatus.PARTIALLY_FULFILLED;
    else if (anyReserved) next = BloodRequestStatus.RESERVED;
    else if (req.status === BloodRequestStatus.RESERVED || req.status === BloodRequestStatus.PARTIALLY_FULFILLED) next = BloodRequestStatus.APPROVED;
    if (next !== req.status && canTransitionRequest(req.status, next)) {
      await tx.bloodRequest.update({ where: { id: requestId }, data: { status: next } });
    } else if (next !== req.status && next === BloodRequestStatus.APPROVED && req.status === BloodRequestStatus.RESERVED) {
      // Backward transition not in state machine; keep RESERVED semantics? Better to keep as RESERVED and let operators manage.
      // But if nothing reserved, APPROVED is operationally accurate; we avoid invalid transition by not forcing it.
    }
  }
}
