import type { Notification } from '@prisma/client';

export interface NotificationView {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string;
  facilityId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationStreamEvent {
  notification: NotificationView;
  userId: string;
  occurredAt: Date;
}

export interface NotificationPageResult {
  items: NotificationView[];
  total: number;
  limit: number;
  offset: number;
  unreadCount: number;
}

export function toNotificationView(notification: Notification): NotificationView {
  return {
    id: notification.id,
    type: notification.type,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    facilityId: notification.facilityId,
    resourceType: notification.resourceType,
    resourceId: notification.resourceId,
    metadata: notification.metadata ?? null,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

export function encodeNotificationEventId(notification: { id: string; createdAt: Date }): string {
  return `${notification.createdAt.getTime()}-${notification.id}`;
}

export function decodeNotificationEventId(eventId: string | undefined): Date | null {
  if (!eventId) return null;
  const timestamp = Number(eventId.split('-')[0]);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}
