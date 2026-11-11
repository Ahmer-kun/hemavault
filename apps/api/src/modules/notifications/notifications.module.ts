import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { NotificationService } from './application/notification.service';
import { NotificationEventsService } from './application/notification-events.service';
import { NotificationDeliveryService } from './application/notification-delivery.service';
import { NotificationsController } from './presentation/notifications.controller';

@Module({
  imports: [AuditModule],
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationEventsService, NotificationDeliveryService],
  exports: [NotificationService, NotificationEventsService],
})
export class NotificationsModule {}
