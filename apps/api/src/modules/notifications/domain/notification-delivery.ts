import { NotificationChannel } from '@prisma/client';

export interface DeliveryChannelResult {
  status: 'DELIVERED' | 'SKIPPED' | 'FAILED';
  error?: string | null;
}

/**
 * Delivery abstraction. Only in-app delivery is implemented in Phase 6.
 * External channels intentionally report SKIPPED until a real provider is
 * configured and verified; the system must never claim unverified delivery.
 */
export interface NotificationDeliveryChannel {
  readonly channel: NotificationChannel;
  deliver(notificationId: string): Promise<DeliveryChannelResult>;
}

export class InAppDeliveryChannel implements NotificationDeliveryChannel {
  readonly channel = NotificationChannel.IN_APP;

  async deliver(): Promise<DeliveryChannelResult> {
    // The durable Notification row is the in-app delivery. Real-time push is
    // best-effort and never a precondition for correctness.
    return { status: 'DELIVERED' };
  }
}

class UnconfiguredExternalChannel implements NotificationDeliveryChannel {
  constructor(readonly channel: NotificationChannel) {}

  async deliver(): Promise<DeliveryChannelResult> {
    return { status: 'SKIPPED', error: 'PROVIDER_NOT_CONFIGURED' };
  }
}

export function buildDeliveryChannels(): NotificationDeliveryChannel[] {
  return [
    new InAppDeliveryChannel(),
    new UnconfiguredExternalChannel(NotificationChannel.EMAIL),
    new UnconfiguredExternalChannel(NotificationChannel.SMS),
  ];
}
