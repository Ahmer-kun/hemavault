import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { UnitState } from '@prisma/client';
import { InventoryMovementService } from './inventory-movement.service';

@Injectable()
export class UnitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: InventoryMovementService,
  ) {}

  list(facilityId?: string) {
    const where: any = {};
    if (facilityId) where.facilityId = facilityId;
    return this.prisma.bloodComponentUnit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { componentType: true, storageLocation: true, facility: true },
    });
  }

  findById(id: string) {
    return this.prisma.bloodComponentUnit.findUnique({
      where: { id },
      include: { componentType: true, storageLocation: true, facility: true, movements: { orderBy: { occurredAt: 'asc' } } },
    });
  }

  summary() {
    return this.prisma.bloodComponentUnit.groupBy({
      by: ['state'],
      _count: { state: true },
    });
  }

  expiring(days = 7) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.bloodComponentUnit.findMany({
      where: {
        state: UnitState.AVAILABLE,
        expiresAt: { gte: now, lte: cutoff },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async quarantine(unitId: string, actorUserId?: string) {
    return this.movementService.recordMovement({
      unitId,
      movementType: 'QUARANTINED',
      toState: UnitState.QUARANTINED,
      actorUserId,
    });
  }

  async discard(unitId: string, actorUserId?: string, reason?: string) {
    return this.movementService.recordMovement({
      unitId,
      movementType: 'DISCARDED',
      toState: UnitState.DISCARDED,
      actorUserId,
      reason,
    });
  }

  async move(unitId: string, toState: UnitState, movementType: any, actorUserId?: string, reason?: string) {
    return this.movementService.recordMovement({
      unitId,
      movementType,
      toState,
      actorUserId,
      reason,
    });
  }
}

