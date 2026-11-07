import { Injectable } from '@nestjs/common';
import { UnitState } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { InventoryMovementService } from './inventory-movement.service';

/**
 * Expiration handling per ADR-017: effective-state classification is computed
 * lazily at read time, while a bounded in-process sweep performs the durable
 * state change. No external worker or Redis is introduced.
 */
@Injectable()
export class ExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: InventoryMovementService,
  ) {}

  getEffectiveState(unit: { state: UnitState; expiresAt: Date }): UnitState {
    if (unit.state !== UnitState.AVAILABLE && unit.state !== UnitState.RESERVED) {
      return unit.state;
    }
    return unit.expiresAt.getTime() <= Date.now() ? UnitState.EXPIRED : unit.state;
  }

  isAllocatable(unit: { state: UnitState; expiresAt: Date }): boolean {
    return this.getEffectiveState(unit) === UnitState.AVAILABLE;
  }

  async sweepExpired(limit = 100) {
    const now = new Date();
    const units = await this.prisma.bloodComponentUnit.findMany({
      where: {
        expiresAt: { lt: now },
        state: { in: [UnitState.AVAILABLE, UnitState.RESERVED] },
      },
      take: limit,
      orderBy: { expiresAt: 'asc' },
    });

    const results: Array<{ unitId: string; ok: boolean; error?: string }> = [];
    for (const unit of units) {
      try {
        await this.movementService.recordMovement({
          unitId: unit.id,
          movementType: 'EXPIRED',
          toState: UnitState.EXPIRED,
          unitUpdate: { expiresAt: unit.expiresAt },
        });
        results.push({ unitId: unit.id, ok: true });
      } catch (error) {
        results.push({ unitId: unit.id, ok: false, error: (error as Error).message });
      }
    }
    return results;
  }
}
