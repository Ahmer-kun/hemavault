import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IssuanceService } from './application/issuance.service';
import { IssuancesController } from './presentation/issuances.controller';

@Module({
  imports: [AuditModule, InventoryModule, NotificationsModule],
  controllers: [IssuancesController],
  providers: [IssuanceService],
  exports: [IssuanceService],
})
export class IssuanceModule {}
