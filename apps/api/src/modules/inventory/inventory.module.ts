import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { InventoryMovementService } from './application/inventory-movement.service';
import { UnitService } from './application/unit.service';
import { ComponentTypeService } from './application/component-type.service';
import { StorageLocationService } from './application/storage-location.service';
import { ReconciliationService } from './application/reconciliation.service';
import { ExpiryService } from './application/expiry.service';
import { ReservationService } from './application/reservation.service';
import { DonationIntegrationService } from './application/donation-integration.service';
import { InventoryController } from './presentation/inventory.controller';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController],
  providers: [
    InventoryMovementService,
    UnitService,
    ComponentTypeService,
    StorageLocationService,
    ReconciliationService,
    ExpiryService,
    ReservationService,
    DonationIntegrationService,
  ],
  exports: [InventoryMovementService, UnitService, ExpiryService, ReservationService, DonationIntegrationService],
})
export class InventoryModule {}

