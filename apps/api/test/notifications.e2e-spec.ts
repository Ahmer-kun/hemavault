import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FacilityStatus, FacilityType, NotificationType, OrganizationStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../src/modules/auth/infrastructure/email-provider';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/domain/auth.constants';
import { DevConsoleEmailProvider } from '../src/modules/auth/infrastructure/dev-email-provider';
import { NotificationDeliveryService } from '../src/modules/notifications/application/notification-delivery.service';
import { NotificationEventsService } from '../src/modules/notifications/application/notification-events.service';
import { NotificationService } from '../src/modules/notifications/application/notification.service';
import { NotificationsController } from '../src/modules/notifications/presentation/notifications.controller';

/**
 * Phase 6 notifications and real-time tests. The HTTP section exercises
 * authentication, authorization, CSRF, pagination, and user isolation through
 * the real Nest application. The service section exercises dedupe, preferences,
 * delivery accounting, replay, and in-process event filtering against the
 * isolated PostgreSQL database.
 */
const PASSWORD = 'correct-horse-battery-staple';
const EMAIL_DOMAIN = 'notif-e2e-blood-ops.invalid';
const stamp = Date.now().toString(36);
const makeEmail = (label: string): string => `${label}-${stamp}@${EMAIL_DOMAIN}`.toLowerCase();

function sessionCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const pair = setCookie?.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) throw new Error('session cookie not set');
  const separator = pair.indexOf(';');
  return separator >= 0 ? pair.slice(0, separator) : pair;
}
function csrfOf(res: request.Response): string {
  return res.body.data.csrfToken as string;
}
interface Credentials {
  cookie: string;
  csrf: string;
}
interface SeededUser {
  id: string;
  email: string;
}

describe('Notifications and real-time (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;
  let notificationService: NotificationService;
  let events: NotificationEventsService;
  let delivery: NotificationDeliveryService;

  const userIds: string[] = [];
  const creds = new Map<string, Credentials>();
  let userOne: SeededUser;
  let userTwo: SeededUser;
  let outsider: SeededUser;
  let authOne: Credentials;
  let authTwo: Credentials;
  let authOutsider: Credentials;
  let orgId = '';
  let facilityId = '';
  let membershipId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    provider = app.get<EmailProvider>(EMAIL_PROVIDER) as DevConsoleEmailProvider;
    notificationService = app.get(NotificationService);
    events = app.get(NotificationEventsService);
    delivery = app.get(NotificationDeliveryService);

    const role = await prisma.role.findUnique({ where: { code: 'PLATFORM_ADMIN' } });
    if (!role) throw new Error('PLATFORM_ADMIN role not seeded');

    async function verifiedUser(label: string): Promise<SeededUser> {
      const email = makeEmail(label);
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);
      const last = provider.outbox[provider.outbox.length - 1];
      if (!last?.tokenValue) throw new Error('no verification email captured');
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: last.tokenValue })
        .expect(200);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new Error('user not created');
      userIds.push(user.id);
      return { id: user.id, email };
    }

    async function login(email: string): Promise<Credentials> {
      const cached = creds.get(email);
      if (cached) return cached;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const credentials = { cookie: sessionCookie(res), csrf: csrfOf(res) };
      creds.set(email, credentials);
      return credentials;
    }

    userOne = await verifiedUser('user-one');
    userTwo = await verifiedUser('user-two');
    outsider = await verifiedUser('outsider');

    for (const user of [userOne, userTwo]) {
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id, assignedById: user.id },
      });
    }

    const organization = await prisma.organization.create({
      data: {
        code: `NTF${stamp}`.slice(0, 20).toUpperCase(),
        name: 'Notification Test Org',
        status: OrganizationStatus.ACTIVE,
      },
    });
    orgId = organization.id;
    const facility = await prisma.facility.create({
      data: {
        organizationId: organization.id,
        code: `NTFF${stamp}`.slice(0, 20).toUpperCase(),
        name: 'Notification Test Facility',
        type: FacilityType.BLOOD_BANK,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityId = facility.id;
    const managerRole = await prisma.role.findUnique({ where: { code: 'FACILITY_MANAGER' } });
    if (!managerRole) throw new Error('FACILITY_MANAGER role not seeded');
    const membership = await prisma.facilityMembership.create({
      data: { userId: userTwo.id, facilityId: facility.id, roleId: managerRole.id },
    });
    membershipId = membership.id;

    authOne = await login(userOne.email);
    authTwo = await login(userTwo.email);
    authOutsider = await login(outsider.email);
  }, 45000);

  afterAll(async () => {
    if (!prisma) return;
    const ids = userIds.filter(Boolean);
    try {
      await prisma.notificationDelivery.deleteMany({
        where: { notification: { userId: { in: ids } } },
      });
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [{ actorUserId: { in: ids } }, ...(facilityId ? [{ facilityId }] : [])],
        },
      });
      if (membershipId) await prisma.facilityMembership.deleteMany({ where: { id: membershipId } });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      if (facilityId) await prisma.facility.deleteMany({ where: { id: facilityId } });
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    } finally {
      await app.close();
    }
  }, 30000);

  let dedupeSeed = 0;
  async function seedNotification(
    userId: string,
    type: NotificationType = NotificationType.REQUEST_RESERVED,
    dedupeKey?: string,
  ) {
    dedupeSeed += 1;
    const created = await notificationService.notify({
      actorUserId: userOne.id,
      type,
      title: `Notification ${dedupeSeed}`,
      body: 'Operational notification for tests.',
      resourceType: 'BloodRequest',
      resourceId: null,
      dedupeKey: dedupeKey ?? `seed:${dedupeSeed}:${userId}`,
      explicitUserIds: [userId],
    });
    return created[0]!;
  }

  describe('service semantics', () => {
    it('persists deduplicated notifications and delivery accounting', async () => {
      const dedupeKey = `dedupe-${stamp}-${Math.random()}`;
      const first = await notificationService.notify({
        type: NotificationType.REQUEST_RESERVED,
        title: 'Dedupe check',
        body: 'Body',
        dedupeKey,
        explicitUserIds: [userOne.id, userTwo.id],
      });
      expect(first).toHaveLength(2);

      const replay = await notificationService.notify({
        type: NotificationType.REQUEST_RESERVED,
        title: 'Dedupe check',
        body: 'Body',
        dedupeKey,
        explicitUserIds: [userOne.id, userTwo.id],
      });
      expect(replay).toHaveLength(0);
      expect(await prisma.notification.count({ where: { dedupeKey } })).toBe(2);

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: first[0]!.id },
        orderBy: { channel: 'asc' },
      });
      expect(deliveries).toHaveLength(3);
      expect(deliveries.find((row) => row.channel === 'IN_APP')).toMatchObject({
        status: 'DELIVERED',
        attempts: 1,
      });
      expect(deliveries.find((row) => row.channel === 'EMAIL')).toMatchObject({
        status: 'SKIPPED',
        lastError: 'PROVIDER_NOT_CONFIGURED',
      });
      expect(deliveries.find((row) => row.channel === 'SMS')).toMatchObject({
        status: 'SKIPPED',
        lastError: 'PROVIDER_NOT_CONFIGURED',
      });
    });

    it('honours preferences for suppressible priorities but never suppresses critical alerts', async () => {
      await notificationService.updatePreferences(userOne.id, [
        { type: NotificationType.SYSTEM, channel: 'IN_APP', enabled: false },
      ]);
      const suppressedKey = `suppressed-${stamp}-${Math.random()}`;
      const suppressed = await notificationService.notify({
        type: NotificationType.SYSTEM,
        title: 'Suppressed',
        body: 'Should not be created',
        dedupeKey: suppressedKey,
        explicitUserIds: [userOne.id],
      });
      expect(suppressed).toHaveLength(0);
      expect(await prisma.notification.count({ where: { dedupeKey: suppressedKey } })).toBe(0);

      const criticalKey = `critical-${stamp}-${Math.random()}`;
      const critical = await notificationService.notify({
        type: NotificationType.EMERGENCY_REQUEST,
        title: 'Critical alert',
        body: 'Emergency',
        dedupeKey: criticalKey,
        explicitUserIds: [userOne.id],
      });
      expect(critical).toHaveLength(1);
      expect(critical[0]!.priority).toBe('CRITICAL');

      await notificationService.updatePreferences(userOne.id, [
        { type: NotificationType.SYSTEM, channel: 'IN_APP', enabled: true },
      ]);
    });

    it('retries only non-terminal deliveries without inventing external success', async () => {
      const notification = await seedNotification(userOne.id);
      await delivery.retry(notification.id);
      const rows = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });
      expect(rows.find((row) => row.channel === 'IN_APP')?.status).toBe('DELIVERED');
      const external = rows.filter((row) => row.channel !== 'IN_APP');
      expect(external.every((row) => row.status === 'SKIPPED')).toBe(true);
      expect(external.every((row) => row.lastError === 'PROVIDER_NOT_CONFIGURED')).toBe(true);
    });

    it('pages, filters, and marks notifications read per user', async () => {
      const created = [];
      for (let index = 0; index < 5; index += 1) {
        created.push(await seedNotification(userOne.id));
      }
      const page = await notificationService.listForUser(userOne.id, { limit: 2, offset: 0 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBeGreaterThanOrEqual(5);
      expect(page.unreadCount).toBeGreaterThanOrEqual(5);

      const unread = await notificationService.listForUser(userOne.id, {
        unreadOnly: true,
        limit: 100,
      });
      expect(unread.items.every((item) => item.readAt === null)).toBe(true);

      const target = created[0]!;
      const read = await notificationService.markRead(userOne.id, target.id);
      expect(read.readAt).toBeTruthy();
      const readAgain = await notificationService.markRead(userOne.id, target.id);
      expect(readAgain.readAt?.getTime()).toBe(read.readAt?.getTime());

      await expect(notificationService.markRead(userTwo.id, target.id)).rejects.toMatchObject({
        status: 404,
      });

      const all = await notificationService.markAllRead(userOne.id);
      expect(all.unreadCount).toBe(0);
      const after = await notificationService.listForUser(userOne.id, { unreadOnly: true });
      expect(after.items).toHaveLength(0);

      const typeFiltered = await notificationService.listForUser(userOne.id, {
        type: NotificationType.EMERGENCY_REQUEST,
        limit: 100,
      });
      expect(typeFiltered.items.every((item) => item.type === 'EMERGENCY_REQUEST')).toBe(true);
    });

    it('replays only the requesting user\u2019s events after the supplied event id', async () => {
      const marker = await seedNotification(userOne.id);
      const eventId = notificationService.eventIdFor(marker);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const later = await seedNotification(userOne.id);
      const otherUser = await seedNotification(userTwo.id);

      const replayed = await notificationService.replaySince(userOne.id, eventId);
      const ids = replayed.map((item) => item.id);
      expect(ids).toContain(later.id);
      expect(ids).not.toContain(marker.id);
      expect(ids).not.toContain(otherUser.id);
    });

    it('filters the in-process event bus by user', async () => {
      const received: string[] = [];
      const subscription = events.streamForUser(userOne.id).subscribe((event) => {
        received.push(event.notification.id);
      });
      const mine = await seedNotification(userOne.id);
      const theirs = await seedNotification(userTwo.id);
      subscription.unsubscribe();
      expect(received).toContain(mine.id);
      expect(received).not.toContain(theirs.id);
    });

    it('emits a ready event before live notifications on the SSE stream', async () => {
      const controller = new NotificationsController(notificationService, events);
      const ready = await firstValueFrom(
        controller.stream({
          userId: userOne.id,
          sessionId: 'notif-stream',
          globalPermissions: new Set(['notification.read']),
          facilityPermissions: new Map(),
        }),
      );
      expect(ready.type).toBe('ready');
      expect((ready.data as { userId: string }).userId).toBe(userOne.id);
    });
  });

  describe('HTTP authentication, authorization, and isolation', () => {
    it('requires authentication for notifications and transfer routes', async () => {
      await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
      await request(app.getHttpServer()).get('/api/v1/notifications/stream').expect(401);
      await request(app.getHttpServer()).post('/api/v1/transfers').expect(401);
      await request(app.getHttpServer()).get('/api/v1/transfers').expect(401);
    });

    it('denies users without notification/transfer permissions', async () => {
      const notifications = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Cookie', authOutsider.cookie);
      expect(notifications.status).toBe(403);
      expect(notifications.body.error.code).toBe('FORBIDDEN');

      const stream = await request(app.getHttpServer())
        .get('/api/v1/notifications/stream')
        .set('Cookie', authOutsider.cookie);
      expect(stream.status).toBe(403);

      const transfers = await request(app.getHttpServer())
        .get('/api/v1/transfers')
        .set('Cookie', authOutsider.cookie);
      expect(transfers.status).toBe(403);
    });

    it('enforces CSRF on notification and transfer mutations', async () => {
      const notification = await seedNotification(userOne.id);
      const noCsrfRead = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${notification.id}/read`)
        .set('Cookie', authOne.cookie);
      expect(noCsrfRead.status).toBe(403);
      expect(noCsrfRead.body.error.code).toBe('CSRF_VIOLATION');

      const noCsrfAll = await request(app.getHttpServer())
        .post('/api/v1/notifications/read-all')
        .set('Cookie', authOne.cookie);
      expect(noCsrfAll.status).toBe(403);

      const noCsrfPreferences = await request(app.getHttpServer())
        .post('/api/v1/notifications/preferences')
        .set('Cookie', authOne.cookie)
        .send({ preferences: [{ type: 'SYSTEM', channel: 'IN_APP', enabled: true }] });
      expect(noCsrfPreferences.status).toBe(403);

      const noCsrfTransfer = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Cookie', authTwo.cookie)
        .send({
          sourceFacilityId: '00000000-0000-4000-8000-000000000001',
          destinationFacilityId: '00000000-0000-4000-8000-000000000002',
          unitIds: ['00000000-0000-4000-8000-000000000003'],
        });
      expect(noCsrfTransfer.status).toBe(403);
      expect(noCsrfTransfer.body.error.code).toBe('CSRF_VIOLATION');
    });

    it('lists only the authenticated user\u2019s notifications with pagination', async () => {
      const one = await seedNotification(userOne.id);
      const two = await seedNotification(userTwo.id);

      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications?limit=1&offset=0')
        .set('Cookie', authOne.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.limit).toBe(1);
      expect(res.body.data.items[0].id).toBe(one.id);
      expect(res.body.data.items.some((item: { id: string }) => item.id === two.id)).toBe(false);

      const other = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Cookie', authTwo.cookie);
      expect(other.status).toBe(200);
      expect(other.body.data.items.some((item: { id: string }) => item.id === two.id)).toBe(true);
    });

    it('marks notifications read idempotently and masks other users\u2019 notifications', async () => {
      const mine = await seedNotification(userOne.id);
      const read = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${mine.id}/read`)
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf);
      expect(read.status).toBe(200);
      expect(read.body.data.readAt).toBeTruthy();

      const again = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${mine.id}/read`)
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf);
      expect(again.status).toBe(200);

      const crossUser = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${mine.id}/read`)
        .set('Cookie', authTwo.cookie)
        .set('x-csrf-token', authTwo.csrf);
      expect(crossUser.status).toBe(404);
      expect(crossUser.body.error.code).toBe('NOTIFICATION_NOT_FOUND');

      const all = await request(app.getHttpServer())
        .post('/api/v1/notifications/read-all')
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf);
      expect(all.status).toBe(200);
      expect(all.body.data.unreadCount).toBe(0);
    });

    it('round-trips notification preferences and validates payloads', async () => {
      const update = await request(app.getHttpServer())
        .post('/api/v1/notifications/preferences')
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf)
        .send({ preferences: [{ type: 'SYSTEM', channel: 'EMAIL', enabled: false }] });
      expect(update.status).toBe(200);
      const stored = update.body.data.preferences.find(
        (preference: { type: string; channel: string }) =>
          preference.type === 'SYSTEM' && preference.channel === 'EMAIL',
      );
      expect(stored?.enabled).toBe(false);

      const get = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set('Cookie', authOne.cookie);
      expect(get.status).toBe(200);

      const invalid = await request(app.getHttpServer())
        .post('/api/v1/notifications/preferences')
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf)
        .send({ preferences: [{ type: 'NOT_A_TYPE', channel: 'IN_APP', enabled: true }] });
      expect(invalid.status).toBe(400);
    });

    it('validates identifiers and bounds pagination', async () => {
      const malformed = await request(app.getHttpServer())
        .get('/api/v1/notifications/not-a-uuid')
        .set('Cookie', authOne.cookie);
      // Route is not defined for GET by id; it falls through to 404 from the framework.
      expect([400, 404]).toContain(malformed.status);

      const badRead = await request(app.getHttpServer())
        .post('/api/v1/notifications/not-a-uuid/read')
        .set('Cookie', authOne.cookie)
        .set('x-csrf-token', authOne.csrf);
      expect(badRead.status).toBe(400);

      const overLimit = await request(app.getHttpServer())
        .get('/api/v1/notifications?limit=101')
        .set('Cookie', authOne.cookie);
      expect(overLimit.status).toBe(400);

      const badTransferId = await request(app.getHttpServer())
        .get('/api/v1/transfers/not-a-uuid')
        .set('Cookie', authOne.cookie);
      expect(badTransferId.status).toBe(400);
    });

    it('accepts a valid transfer command shape but rejects unknown resources safely', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set('Cookie', authTwo.cookie)
        .set('x-csrf-token', authTwo.csrf)
        .send({
          sourceFacilityId: '00000000-0000-4000-8000-000000000001',
          destinationFacilityId: '00000000-0000-4000-8000-000000000002',
          unitIds: ['00000000-0000-4000-8000-000000000003'],
        });
      expect([400, 404]).toContain(res.status);
      expect(res.body.error.code).toBeTruthy();
      expect(res.body.error.requestId).toBeTruthy();
    });
  });
});
