import { Injectable } from '@nestjs/common';
import { Prisma, UnitState } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { ExpiryService } from './expiry.service';

export interface ReserveUnitInput {
  unitId: string;
  reservationId?: string | null;
  facilityId: string;
  actorUserId?: string | null;
  idempotencyKey?: string | null;
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryService: ExpiryService,
  ) {}

  async reserveUnit(input: ReserveUnitInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.reservation.findUnique({
        where: { facilityId_idempotencyKey: { facilityId: input.facilityId, idempotencyKey: input.idempotencyKey } },
        include: { items: true },
      });
      if (existing) return { reservation: existing, idempotent: true };
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.reservation.findUnique({
          where: { facilityId_idempotencyKey: { facilityId: input.facilityId, idempotencyKey: input.idempotencyKey } },
          include: { items: true },
        });
        if (existing) return { reservation: existing, idempotent: true };
      }

      const rows = await tx.$queryRaw<Array<{ id: string; state: UnitState; expiresAt: Date; facilityId: string }>>(
        Prisma.sql`SELECT id, state, "expiresAt", "facilityId" FROM "BloodComponentUnit" WHERE id = ${input.unitId} FOR UPDATE`,
      );
      const unit = rows[0];
      if (!unit) throw new Error('INVENTORY_UNIT_NOT_FOUND');
      if (unit.facilityId !== input.facilityId) throw new Error('FACILITY_SCOPE_VIOLATION');
      if (this.expiryService.getEffectiveState(unit) !== UnitState.AVAILABLE) throw new Error('UNIT_NOT_AVAILABLE');

      const active = await tx.reservationItem.findFirst({ where: { unitId: input.unitId, isActive: true } });
      if (active) throw new Error('UNIT_ALREADY_RESERVED');

      let reservation = input.reservationId
        ? await tx.reservation.findUnique({ where: { id: input.reservationId } })
        : null;
      if (!reservation) {
        reservation = await tx.reservation.create({
          data: {
            facilityId: input.facilityId,
            status: 'ACTIVE',
            idempotencyKey: input.idempotencyKey ?? null,
            createdById: input.actorUserId ?? null,
          },
        });
      }

      await tx.reservationItem.create({
        data: { reservationId: reservation.id, unitId: input.unitId, isActive: true },
      });

      const updated = await tx.bloodComponentUnit.updateMany({
        where: { id: input.unitId, state: UnitState.AVAILABLE },
        data: { state: UnitState.RESERVED },
      });
      if (updated.count !== 1) throw new Error('INVENTORY_UNIT_STATE_CONFLICT');

      await tx.inventoryMovement.create({
        data: {
          unitId: input.unitId,
          facilityId: input.facilityId,
          actorUserId: input.actorUserId ?? null,
          movementType: 'RESERVED',
          fromState: UnitState.AVAILABLE,
          toState: UnitState.RESERVED,
          reservationId: reservation.id,
        },
      });

      const result = await tx.reservation.findUnique({ where: { id: reservation.id }, include: { items: true } });
      return { reservation: result, idempotent: false };
    });
  }
}
