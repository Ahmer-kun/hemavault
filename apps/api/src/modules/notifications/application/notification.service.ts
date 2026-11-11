import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import {
  decodeNotificationEventId,
  NotificationPageResult,
  NotificationView,
  toNotificationView,
  encodeNotificationEventId,
} from '../domain/notification.types';
import { defaultPriorityFor, isPreferenceSuppressible } from '../domain/notification-policy';
import { NotificationEventsService } from './notification-events.service';
import { NotificationDeliveryService } from './notification-delivery.service';

export interface FacilityRecipientRequirement {
  facilityId: string;
  permissions: string[];
}

export interface NotifyAuditContext {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface NotifyInput {
  actorUserId?: string | null;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  body: string;
  facilityId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown> | null;
  explicitUserIds?: Array<string | null | undefined>;
  facilityRecipients?: FacilityRecipientRequirement[];
  excludeUserIds?: Array<string | null | undefined>;
  auditContext?: NotifyAuditContext | null;
}

export interface ListNotificationsInput {
  unreadOnly?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

export interface NotificationPreferenceInput {
  type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

function notFound(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'NOTIFICATION_NOT_FOUND',
    'The requested resource could not be found.',
  );
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: NotificationEventsService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async notify(input: NotifyInput): Promise<NotificationView[]> {
    const priority = input.priority ?? defaultPriorityFor(input.type);
    const recipients = await this.resolveRecipients(input);
    if (!recipients.length) return [];

    const suppressed = isPreferenceSuppressible(priority)
      ? new Set(
          (
            await this.prisma.notificationPreference.findMany({
              where: {
                userId: { in: recipients },
                type: input.type,
                channel: NotificationChannel.IN_APP,
                enabled: false,
              },
              select: { userId: true },
            })
          ).map((preference) => preference.userId),
        )
      : new Set<string>();

    const targets = recipients.filter((userId) => !suppressed.has(userId));
    if (!targets.length) return [];

    const created = await this.prisma.notification.createManyAndReturn({
      data: targets.map((userId) => ({
        userId,
        facilityId: input.facilityId ?? null,
        type: input.type,
        priority,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        dedupeKey: input.dedupeKey,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
      skipDuplicates: true,
    });

    if (!created.length) return [];

    await this.delivery.initialize(created.map((notification) => notification.id));

    const views = created.map(toNotificationView);
    for (const notification of created) {
      this.events.publish({
        notification: toNotificationView(notification),
        userId: notification.userId,
        occurredAt: notification.createdAt,
      });
    }

    await this.audit.record({
      actorUserId: input.actorUserId ?? null,
      action: 'notification.published',
      targetType: 'Notification',
      targetId: null,
      facilityId: input.facilityId ?? null,
      requestId: input.auditContext?.requestId ?? null,
      ipAddress: input.auditContext?.ipAddress ?? null,
      userAgent: input.auditContext?.userAgent ?? null,
      metadata: {
        type: input.type,
        priority,
        recipientCount: created.length,
        dedupeKey: input.dedupeKey,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
      },
    });

    return views;
  }

  /**
   * Fan-out must never roll back an already-committed operational transaction.
   * Failures are surfaced in structured logs and remain safely re-drivable
   * because dedupe keys make the operation idempotent.
   */
  async notifySafely(input: NotifyInput): Promise<NotificationView[]> {
    try {
      return await this.notify(input);
    } catch (error) {
      this.logger.error(
        `Notification fan-out failed type=${input.type} dedupe=${input.dedupeKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  private async resolveRecipients(input: NotifyInput): Promise<string[]> {
    const recipients = new Set<string>();
    const explicit = (input.explicitUserIds ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (explicit.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: explicit }, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      for (const user of users) recipients.add(user.id);
    }

    for (const requirement of input.facilityRecipients ?? []) {
      if (!requirement.permissions.length) continue;
      const members = await this.prisma.facilityMembership.findMany({
        where: {
          facilityId: requirement.facilityId,
          status: 'ACTIVE',
          user: { status: UserStatus.ACTIVE },
          role: {
            rolePermissions: {
              some: { permission: { code: { in: requirement.permissions } } },
            },
          },
        },
        select: { userId: true },
      });
      for (const member of members) recipients.add(member.userId);
    }

    for (const excluded of input.excludeUserIds ?? []) {
      if (excluded) recipients.delete(excluded);
    }
    return Array.from(recipients).sort();
  }

  async listForUser(
    userId: string,
    input: ListNotificationsInput = {},
  ): Promise<NotificationPageResult> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
      ...(input.type ? { type: input.type } : {}),
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: items.map(toNotificationView),
      total,
      limit,
      offset,
      unreadCount,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationView> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw notFound();
    return toNotificationView(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number; unreadCount: number }> {
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    return { updated: result.count, unreadCount: 0 };
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { channel: 'asc' }],
    });
  }

  async updatePreferences(userId: string, preferences: NotificationPreferenceInput[]) {
    for (const preference of preferences) {
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_type_channel: {
            userId,
            type: preference.type,
            channel: preference.channel,
          },
        },
        update: { enabled: preference.enabled },
        create: {
          userId,
          type: preference.type,
          channel: preference.channel,
          enabled: preference.enabled,
        },
      });
    }
    return this.getPreferences(userId);
  }

  async replaySince(userId: string, lastEventId?: string): Promise<NotificationView[]> {
    const since = decodeNotificationEventId(lastEventId);
    if (!since) return [];
    const notifications = await this.prisma.notification.findMany({
      where: { userId, createdAt: { gt: since } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return notifications.map(toNotificationView);
  }

  eventIdFor(notification: NotificationView): string {
    return encodeNotificationEventId(notification);
  }
}
