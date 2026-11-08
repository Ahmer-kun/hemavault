import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../src/modules/auth/infrastructure/email-provider';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/domain/auth.constants';
import { DevConsoleEmailProvider } from '../src/modules/auth/infrastructure/dev-email-provider';

const PASSWORD = 'correct-horse-battery-staple';
const EMAIL_DOMAIN = 'req-e2e-blood-ops.invalid';
const stamp = Date.now().toString(36);
const makeEmail = (label: string): string => `${label}-${stamp}@${EMAIL_DOMAIN}`.toLowerCase();

function sessionCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const pair = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) throw new Error('session cookie not set');
  const separator = pair.indexOf(';');
  return separator >= 0 ? pair.slice(0, separator) : pair;
}
function csrfOf(res: request.Response): string {
  return res.body.data.csrfToken as string;
}
interface Credentials { cookie: string; csrf: string; }

describe('Blood requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  const orgCodes: string[] = [];
  const facilityCodes: string[] = [];
  const orgA: string[] = [];
  const facA: string[] = [];
  const facB: string[] = [];
  let fidA = '';
  let fidB = '';
  let componentTypeId = '';

  let superAuth: Credentials;
  let superId = '';
  const managerA = { email: '', id: '' };
  const hospitalA = { email: '', id: '' };
  const managerB = { email: '', id: '' };
  const outsider = { email: '', id: '' };
  const creds = new Map<string, Credentials>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    provider = app.get<EmailProvider>(EMAIL_PROVIDER) as DevConsoleEmailProvider;

    const ct = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!ct) throw new Error('No active component type seeded');
    componentTypeId = ct.id;
  }, 30000);

  afterAll(async () => {
    const facWhere = facilityCodes.length ? `"code" IN ('${facilityCodes.join("','")}')` : 'FALSE';
    const orgWhere = orgCodes.length ? `"code" IN ('${orgCodes.join("','")}')` : 'FALSE';
    const reqScope = `"facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere})`;
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent" WHERE "actorUserId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}') OR ${reqScope};`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "IssuanceItem" WHERE "issuanceId" IN (SELECT "id" FROM "Issuance" WHERE ${reqScope});`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Issuance" WHERE ${reqScope};`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ReservationItem" WHERE "reservationId" IN (SELECT "id" FROM "Reservation" WHERE ${reqScope});`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "Reservation" WHERE ${reqScope};`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "BloodRequestLine" WHERE "requestId" IN (SELECT "id" FROM "BloodRequest" WHERE ${reqScope});`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "BloodRequest" WHERE ${reqScope};`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "FacilityMembership" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}') OR "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere});`,
    );
    await prisma.userRole.deleteMany({ where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } } });
    await prisma.$executeRawUnsafe(`DELETE FROM "Facility" WHERE ${facWhere};`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Organization" WHERE ${orgWhere};`);
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
    await app.close();
  });

  const lastToken = (): string => {
    const last = provider.outbox[provider.outbox.length - 1];
    if (!last?.tokenValue) throw new Error('no email captured');
    return last.tokenValue;
  };
  async function verifiedUser(email: string): Promise<string> {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(201);
    const token = lastToken();
    const v = await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token });
    expect(v.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('user not created');
    return user.id;
  }
  async function login(email: string): Promise<Credentials> {
    const cached = creds.get(email);
    if (cached) return cached;
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const c = { cookie: sessionCookie(res), csrf: csrfOf(res) };
    creds.set(email, c);
    return c;
  }
  async function promoteGlobal(userId: string, roleCode: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) throw new Error(`role ${roleCode} not seeded`);
    await prisma.userRole.create({ data: { userId, roleId: role.id, assignedById: userId } });
  }
  async function addMember(facilityId: string, userId: string, role: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/facilities/${facilityId}/members`)
      .set('Cookie', superAuth.cookie)
      .set('x-csrf-token', superAuth.csrf)
      .send({ userId, role })
      .expect(201);
  }
  async function createActiveFacility(orgId: string, code: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/facilities')
      .set('Cookie', superAuth.cookie)
      .set('x-csrf-token', superAuth.csrf)
      .send({ organizationId: orgId, code, name, type: 'HOSPITAL' })
      .expect(201);
    const id = res.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/facilities/${id}`)
      .set('Cookie', superAuth.cookie)
      .set('x-csrf-token', superAuth.csrf)
      .send({ status: 'ACTIVE' })
      .expect(200);
    return id;
  }

  describe('setup', () => {
    it('creates fixtures and memberships', async () => {
      const superEmail = makeEmail('super');
      superId = await verifiedUser(superEmail);
      await promoteGlobal(superId, 'PLATFORM_SUPER_ADMIN');
      superAuth = await login(superEmail);

      const orgCode = `RQA${stamp.toUpperCase()}`;
      orgCodes.push(orgCode);
      const orgRes = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAuth.cookie)
        .set('x-csrf-token', superAuth.csrf)
        .send({ code: orgCode, name: 'Request Test Org' })
        .expect(201);
      orgA.push(orgRes.body.data.id);

      const faCode = `RQFA${stamp.toUpperCase()}`;
      const fbCode = `RQFB${stamp.toUpperCase()}`;
      facilityCodes.push(faCode, fbCode);
      const orgId = orgA[0];
      if (!orgId) throw new Error('org fixture missing');
      facA.push(await createActiveFacility(orgId, faCode, 'Request Facility A'));
      facB.push(await createActiveFacility(orgId, fbCode, 'Request Facility B'));
      fidA = facA[0]!;
      fidB = facB[0]!;

      managerA.email = makeEmail('mgr-a'); managerA.id = await verifiedUser(managerA.email);
      hospitalA.email = makeEmail('hosp-a'); hospitalA.id = await verifiedUser(hospitalA.email);
      managerB.email = makeEmail('mgr-b'); managerB.id = await verifiedUser(managerB.email);
      outsider.email = makeEmail('out'); outsider.id = await verifiedUser(outsider.email);
      await addMember(fidA, managerA.id, 'FACILITY_MANAGER');
      await addMember(fidA, hospitalA.id, 'HOSPITAL_STAFF');
      await addMember(fidB, managerB.id, 'FACILITY_MANAGER');
    });
  });

  describe('create/read/update/list', () => {
    let requestId = '';
    it('creates a draft request (hospital staff)', async () => {
      const auth = await login(hospitalA.email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({
          facilityId: fidA,
          urgency: 'URGENT',
          operationalNotes: 'e2e',
          lines: [{ componentTypeId, quantityRequested: 2 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.publicCode).toMatch(/^REQ-/);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].quantityRequested).toBe(2);
      expect(res.body.data.emergencyEscalatedAt).toBeNull(); // URGENT, not emergency/critical
      expect(res.body.meta.requestId).toBeTruthy();
      requestId = res.body.data.id;
    });

    it('rejects missing CSRF on mutation', async () => {
      const auth = await login(hospitalA.email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Cookie', auth.cookie)
        .send({ facilityId: fidA, lines: [{ componentTypeId, quantityRequested: 1 }] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_VIOLATION');
    });

    it('validates quantity invariants (DTO)', async () => {
      const auth = await login(hospitalA.email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ facilityId: fidA, lines: [{ componentTypeId, quantityRequested: 0 }] });
      expect(res.status).toBe(400);
    });

    it('gets and lists in scope', async () => {
      const auth = await login(managerA.email);
      const get = await request(app.getHttpServer()).get(`/api/v1/requests/${requestId}`).set('Cookie', auth.cookie).expect(200);
      expect(get.body.data.id).toBe(requestId);
      const list = await request(app.getHttpServer()).get('/api/v1/requests').set('Cookie', auth.cookie).expect(200);
      expect(list.body.data.items.some((r: any) => r.id === requestId)).toBe(true);
      expect(list.body.data.total).toBeGreaterThan(0);
    });

    it('updates draft and replaces lines transactionally', async () => {
      const auth = await login(hospitalA.email);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ urgency: 'CRITICAL', lines: [{ componentTypeId, quantityRequested: 3, notes: 'n' }] })
        .expect(200);
      expect(res.body.data.urgency).toBe('CRITICAL');
      expect(res.body.data.emergencyEscalatedAt).toBeTruthy();
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].quantityRequested).toBe(3);
      const lineCount = await prisma.bloodRequestLine.count({ where: { requestId } });
      expect(lineCount).toBe(1);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/requests').expect(401);
      await request(app.getHttpServer()).get(`/api/v1/requests/${requestId}`).expect(401);
    });
  });

  describe('facility isolation and RBAC', () => {
    let reqA = '';
    let reqB = '';
    beforeAll(async () => {
      const a = await login(hospitalA.email);
      const r1 = await request(app.getHttpServer())
        .post('/api/v1/requests').set('Cookie', a.cookie).set('x-csrf-token', a.csrf)
        .send({ facilityId: fidA, lines: [{ componentTypeId, quantityRequested: 1 }] }).expect(201);
      reqA = r1.body.data.id;
      // create in facB as super admin (has approve/global create context via service? super has request.self.create)
      const r2 = await request(app.getHttpServer())
        .post('/api/v1/requests').set('Cookie', superAuth.cookie).set('x-csrf-token', superAuth.csrf)
        .send({ facilityId: fidB, lines: [{ componentTypeId, quantityRequested: 1 }] }).expect(201);
      reqB = r2.body.data.id;
    });

    it('masks cross-facility request as 404', async () => {
      const auth = await login(managerA.email);
      const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqB}`).set('Cookie', auth.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('REQUEST_NOT_FOUND');
    });

    it('scopes list to permitted facilities', async () => {
      const auth = await login(managerA.email);
      const list = await request(app.getHttpServer()).get('/api/v1/requests').set('Cookie', auth.cookie).expect(200);
      const ids = list.body.data.items.map((r: any) => r.id);
      expect(ids).toContain(reqA);
      expect(ids).not.toContain(reqB);
    });

    it('denies outsider without request permissions', async () => {
      const auth = await login(outsider.email);
      const res = await request(app.getHttpServer()).get('/api/v1/requests').set('Cookie', auth.cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies cross-facility approval attempt (404 masking)', async () => {
      // Submit reqB via super admin (global request permissions) to create cross-facility target state.
      await request(app.getHttpServer())
        .post(`/api/v1/requests/${reqB}/submit`)
        .set('Cookie', superAuth.cookie)
        .set('x-csrf-token', superAuth.csrf)
        .expect(200);
      const a = await login(managerA.email);
      const res = await request(app.getHttpServer()).post(`/api/v1/requests/${reqB}/approve`).set('Cookie', a.cookie).set('x-csrf-token', a.csrf);
      expect(res.status).toBe(404); // out of scope masked
      expect(res.body.error.code).toBe('REQUEST_NOT_FOUND');
    });
  });

  describe('lifecycle and invalid transitions', () => {
    async function createDraft(): Promise<string> {
      const auth = await login(hospitalA.email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests').set('Cookie', auth.cookie).set('x-csrf-token', auth.csrf)
        .send({ facilityId: fidA, lines: [{ componentTypeId, quantityRequested: 1 }] }).expect(201);
      return res.body.data.id;
    }

    it('follows submit -> approve lifecycle and records audit', async () => {
      const id = await createDraft();
      const h = await login(hospitalA.email);
      const sub = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/submit`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf).expect(200);
      expect(sub.body.data.status).toBe('SUBMITTED');
      expect(sub.body.data.submittedAt).toBeTruthy();
      const m = await login(managerA.email);
      const appr = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/approve`).set('Cookie', m.cookie).set('x-csrf-token', m.csrf).expect(200);
      expect(appr.body.data.status).toBe('APPROVED');
      expect(appr.body.data.reviewedAt).toBeTruthy();
      expect(appr.body.data.approvedAt).toBeTruthy();
      const audits = await prisma.auditEvent.findMany({ where: { targetType: 'BloodRequest', targetId: id }, orderBy: { occurredAt: 'asc' } });
      const actions = audits.map((a) => a.action);
      expect(actions).toContain('request.created');
      expect(actions).toContain('request.submitted');
      expect(actions).toContain('request.approved');
    });

    it('rejects with required reason', async () => {
      const id = await createDraft();
      const h = await login(hospitalA.email);
      await request(app.getHttpServer()).post(`/api/v1/requests/${id}/submit`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf).expect(200);
      const m = await login(managerA.email);
      const bad = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/reject`).set('Cookie', m.cookie).set('x-csrf-token', m.csrf).send({ reason: '' });
      expect(bad.status).toBe(400);
      const ok = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/reject`).set('Cookie', m.cookie).set('x-csrf-token', m.csrf).send({ reason: 'insufficient info' }).expect(200);
      expect(ok.body.data.status).toBe('REJECTED');
      expect(ok.body.data.rejectionReason).toBe('insufficient info');
    });

    it('prevents invalid transitions and post-terminal mutation', async () => {
      const id = await createDraft();
      const m = await login(managerA.email);
      // cannot approve draft directly
      const badApprove = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/approve`).set('Cookie', m.cookie).set('x-csrf-token', m.csrf);
      expect(badApprove.status).toBe(409);
      expect(badApprove.body.error.code).toBe('INVALID_REQUEST_TRANSITION');
      // cancel draft, then cannot submit
      await request(app.getHttpServer()).post(`/api/v1/requests/${id}/cancel`).set('Cookie', m.cookie).set('x-csrf-token', m.csrf).send({ reason: 'test' }).expect(200);
      const h = await login(hospitalA.email);
      const afterTerm = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/submit`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf);
      expect(afterTerm.status).toBe(409);
      expect(['REQUEST_TERMINAL_STATE', 'INVALID_REQUEST_TRANSITION']).toContain(afterTerm.body.error.code);
      // cannot update cancelled
      const upd = await request(app.getHttpServer()).patch(`/api/v1/requests/${id}`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf).send({ operationalNotes: 'x' });
      expect(upd.status).toBe(409);
      expect(upd.body.error.code).toBe('REQUEST_MUTABLE_FIELDS_LOCKED');
    });

    it('cancels submitted request', async () => {
      const id = await createDraft();
      const h = await login(hospitalA.email);
      await request(app.getHttpServer()).post(`/api/v1/requests/${id}/submit`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf).expect(200);
      const cancelled = await request(app.getHttpServer()).post(`/api/v1/requests/${id}/cancel`).set('Cookie', h.cookie).set('x-csrf-token', h.csrf).send({}).expect(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');
      expect(cancelled.body.data.cancelledAt).toBeTruthy();
    });
  });

  describe('transaction rollback / DB invariants', () => {
    it('rolled-back draft update leaves request/lines unchanged', async () => {
      const auth = await login(hospitalA.email);
      const created = await request(app.getHttpServer())
        .post('/api/v1/requests').set('Cookie', auth.cookie).set('x-csrf-token', auth.csrf)
        .send({ facilityId: fidA, operationalNotes: 'before', lines: [{ componentTypeId, quantityRequested: 1 }] }).expect(201);
      const id = created.body.data.id;
      const before = await prisma.bloodRequest.findUnique({ where: { id }, include: { lines: true } });
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.bloodRequestLine.deleteMany({ where: { requestId: id } });
          await tx.bloodRequest.update({ where: { id }, data: { operationalNotes: 'after-tx' } });
          throw new Error('FORCE_ROLLBACK');
        }),
      ).rejects.toThrow('FORCE_ROLLBACK');
      const after = await prisma.bloodRequest.findUnique({ where: { id }, include: { lines: true } });
      expect(after?.operationalNotes).toBe(before?.operationalNotes);
      expect(after?.lines).toHaveLength(before?.lines.length ?? 0);
    });

    it('persists request/line referential integrity', async () => {
      const reqRow = await prisma.bloodRequest.findFirst({ where: { facilityId: fidA } });
      expect(reqRow).toBeTruthy();
      if (!reqRow) return;
      const lines = await prisma.bloodRequestLine.findMany({ where: { requestId: reqRow.id } });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.quantityRequested).toBeGreaterThan(0);
        expect(line.quantityReserved).toBe(0);
        expect(line.quantityIssued).toBe(0);
      }
    });
  });
});
