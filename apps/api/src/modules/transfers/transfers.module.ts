import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransferService } from './application/transfer.service';
import { TransfersController } from './presentation/transfers.controller';

@Module({
  imports: [AuditModule, InventoryModule, NotificationsModule],
  controllers: [TransfersController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransfersModule {}
