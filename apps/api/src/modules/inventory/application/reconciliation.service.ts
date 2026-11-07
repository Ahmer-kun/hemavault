import { Injectable } from '@nestjs/common';
import { InventoryMovementService } from './inventory-movement.service';

@Injectable()
export class ReconciliationService {
  constructor(private readonly movementService: InventoryMovementService) {}

  async reconcile(unitId: string, toState: any, actorUserId?: string, reason?: string) {
    return this.movementService.recordMovement({
      unitId,
      movementType: 'RECONCILED',
      toState,
      actorUserId,
      reason,
    });
  }
}
