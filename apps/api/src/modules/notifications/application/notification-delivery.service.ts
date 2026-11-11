import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  buildDeliveryChannels,
  NotificationDeliveryChannel,
} from '../domain/notification-delivery';

/**
 * Idempotent delivery accounting. A notification/channel has exactly one row;
 * repeated invocation updates the same row and can never create duplicate
 * delivery side effects. External channels remain SKIPPED until a real,
 * verified provider is configured.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly channels: NotificationDeliveryChannel[] = buildDeliveryChannels();

  constructor(private readonly prisma: PrismaService) {}

  async initialize(notificationIds: string[]): Promise<void> {
    if (!notificationIds.length) return;
    const now = new Date();
    await this.prisma.notificationDelivery.createMany({
      data: notificationIds.flatMap((notificationId) =>
        this.channels.map((channel) => ({
          notificationId,
          channel: channel.channel,
          status:
            channel.channel === NotificationChannel.IN_APP
              ? NotificationDeliveryStatus.DELIVERED
              : NotificationDeliveryStatus.SKIPPED,
          attempts: channel.channel === NotificationChannel.IN_APP ? 1 : 0,
          lastAttemptAt: now,
          deliveredAt: channel.channel === NotificationChannel.IN_APP ? now : null,
          lastError:
            channel.channel === NotificationChannel.IN_APP ? null : 'PROVIDER_NOT_CONFIGURED',
        })),
      ),
      skipDuplicates: true,
    });
  }

  /**
   * Retry-safe re-delivery for channels that are not terminal. In-app rows are
   * already delivered; external rows are skipped because no provider exists.
   */
  async retry(notificationId: string): Promise<void> {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        notificationId,
        status: {
          in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED],
        },
      },
    });
    for (const delivery of deliveries) {
      const channel = this.channels.find((candidate) => candidate.channel === delivery.channel);
      if (!channel) continue;
      let status: NotificationDeliveryStatus = NotificationDeliveryStatus.FAILED;
      let error: string | null = 'CHANNEL_NOT_IMPLEMENTED';
      try {
        const result = await channel.deliver(notificationId);
        status =
          result.status === 'DELIVERED'
            ? NotificationDeliveryStatus.DELIVERED
            : result.status === 'SKIPPED'
              ? NotificationDeliveryStatus.SKIPPED
              : NotificationDeliveryStatus.FAILED;
        error = result.error ?? null;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'DELIVERY_FAILED';
      }
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          deliveredAt: status === NotificationDeliveryStatus.DELIVERED ? new Date() : null,
          lastError: error,
        },
      });
    }
  }
}
