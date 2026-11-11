import { NotificationPriority, NotificationType } from '@prisma/client';

export { NotificationPriority, NotificationType };

/**
 * Safety rule: emergency/critical operational alerts must not be silently
 * suppressed by user preferences. Lower-priority informational notifications
 * may be disabled per type/channel.
 */
export function isPreferenceSuppressible(priority: NotificationPriority): boolean {
  return priority !== NotificationPriority.CRITICAL;
}

const TYPE_PRIORITY: Record<NotificationType, NotificationPriority> = {
  [NotificationType.EMERGENCY_REQUEST]: NotificationPriority.CRITICAL,
  [NotificationType.REQUEST_SUBMITTED]: NotificationPriority.NORMAL,
  [NotificationType.REQUEST_APPROVED]: NotificationPriority.HIGH,
  [NotificationType.REQUEST_REJECTED]: NotificationPriority.HIGH,
  [NotificationType.REQUEST_RESERVED]: NotificationPriority.NORMAL,
  [NotificationType.REQUEST_FULFILLED]: NotificationPriority.HIGH,
  [NotificationType.ISSUANCE_CREATED]: NotificationPriority.NORMAL,
  [NotificationType.ISSUANCE_CONFIRMED]: NotificationPriority.HIGH,
  [NotificationType.TRANSFER_REQUESTED]: NotificationPriority.HIGH,
  [NotificationType.TRANSFER_APPROVED]: NotificationPriority.NORMAL,
  [NotificationType.TRANSFER_DISPATCHED]: NotificationPriority.HIGH,
  [NotificationType.TRANSFER_RECEIVED]: NotificationPriority.HIGH,
  [NotificationType.TRANSFER_REJECTED]: NotificationPriority.HIGH,
  [NotificationType.TRANSFER_CANCELLED]: NotificationPriority.NORMAL,
  [NotificationType.SYSTEM]: NotificationPriority.LOW,
};

export function defaultPriorityFor(type: NotificationType): NotificationPriority {
  return TYPE_PRIORITY[type] ?? NotificationPriority.NORMAL;
}

/** Allowlists notification type/channel values for DTO validation. */
export const NOTIFICATION_TYPES: readonly NotificationType[] = Object.values(NotificationType);
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
