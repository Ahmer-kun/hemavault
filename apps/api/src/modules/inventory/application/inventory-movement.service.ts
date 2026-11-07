import { Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { assertValidTransition, UnitState } from '../domain/unit-state-machine';

export interface RecordMovementInput {
  unitId: string;
  movementType: InventoryMovementType | string;
  toState: UnitState;
  actorUserId?: string | null;
  facilityId?: string | null;
  fromFacilityId?: string | null;
  toFacilityId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reservationId?: string | null;
  transferId?: string | null;
  issuanceId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  unitUpdate?: Prisma.BloodComponentUnitUpdateInput;
}

const STATE_COMPATIBLE_MOVEMENT_TYPES: Partial<Record<UnitState, ReadonlySet<string>>> = {
  [UnitState.QUARANTINED]: new Set(['CREATED', 'QUARANTINED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.AVAILABLE]: new Set(['RELEASED_TO_AVAILABLE', 'STATE_CHANGE', 'RESERVATION_RELEASED', 'RECONCILED']),
  [UnitState.RESERVED]: new Set(['RESERVED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.EXPIRED]: new Set(['EXPIRED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.DISCARDED]: new Set(['DISCARDED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.RECALLED]: new Set(['RECALLED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.ISSUED]: new Set(['ISSUED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.TRANSFER_PENDING]: new Set(['STATE_CHANGE', 'RECONCILED']),
  [UnitState.IN_TRANSIT]: new Set(['DISPATCHED', 'STATE_CHANGE', 'RECONCILED']),
  [UnitState.RECEIVED]: new Set(['RECEIVED', 'STATE_CHANGE', 'RECONCILED']),
};

@Injectable()
export class InventoryMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async recordMovement(input: RecordMovementInput, tx?: Prisma.TransactionClient) {
    if (tx) {
      return this.recordMovementInTx(tx, input);
    }
    return this.prisma.$transaction((trx) => this.recordMovementInTx(trx, input));
  }

  private async recordMovementInTx(tx: Prisma.TransactionClient, input: RecordMovementInput) {
    const unit = await tx.bloodComponentUnit.findUnique({ where: { id: input.unitId } });
    if (!unit) {
      throw new Error('INVENTORY_UNIT_NOT_FOUND');
    }

    const fromState = unit.state as UnitState;
    const toState = input.toState;

    assertValidTransition(fromState, toState);
    this.assertMovementTypeCompatible(String(input.movementType), toState);

    // Stale-write guard: only update if state is still what we observed.
    const updateResult = await tx.bloodComponentUnit.updateMany({
      where: { id: unit.id, state: fromState },
      data: {
        state: toState,
        ...(input.unitUpdate ?? {}),
      },
    });
    if (updateResult.count !== 1) {
      throw new Error('INVENTORY_UNIT_STATE_CONFLICT');
    }

    const updatedUnit = await tx.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    if (!updatedUnit) {
      throw new Error('INVENTORY_UNIT_NOT_FOUND');
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        unitId: unit.id,
        facilityId: input.facilityId ?? unit.facilityId ?? null,
        actorUserId: input.actorUserId ?? null,
        movementType: input.movementType as InventoryMovementType,
        fromState,
        toState,
        fromFacilityId: input.fromFacilityId ?? null,
        toFacilityId: input.toFacilityId ?? null,
        fromLocationId: input.fromLocationId ?? null,
        toLocationId: input.toLocationId ?? null,
        reservationId: input.reservationId ?? null,
        transferId: input.transferId ?? null,
        issuanceId: input.issuanceId ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata ?? undefined,
      },
    });

    return { unit: updatedUnit, movement };
  }

  private assertMovementTypeCompatible(movementType: string, toState: UnitState): void {
    const allowed = STATE_COMPATIBLE_MOVEMENT_TYPES[toState];
    if (!allowed) return;
    if (!allowed.has(movementType)) {
      throw new Error('MOVEMENT_TYPE_STATE_MISMATCH');
    }
  }
}
