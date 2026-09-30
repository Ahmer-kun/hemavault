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
const EMAIL_DOMAIN = 'rbac-e2e-blood-ops.invalid';
const stamp = Date.now().toString(36);
const makeEmail = (label: string): string => `${label}-${stamp}@${EMAIL_DOMAIN}`;

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

interface Credentials {
  cookie: string;
  csrf: string;
}

describe('RBAC, organizations, and facilities (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  const orgCodes: string[] = [];
  const facilityCodes: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    provider = app.get<EmailProvider>(EMAIL_PROVIDER) as DevConsoleEmailProvider;
  });

  afterAll(async () => {
    const orgWhere = orgCodes.length ? `"code" IN ('${orgCodes.join("','")}')` : 'FALSE';
    const facilityWhere = facilityCodes.length ? `"code" IN ('${facilityCodes.join("','")}')` : 'FALSE';
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent" WHERE "actorUserId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}');`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE ${orgWhere}) OR "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere});`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "FacilityMembership" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}') OR "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere});`,
    );
    await prisma.userRole.deleteMany({
      where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
    });
    await prisma.$executeRawUnsafe(`DELETE FROM "Facility" WHERE ${facilityWhere};`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Organization" WHERE ${orgWhere};`);
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
    await app.close();
  });

  const lastToken = (): string => {
    const last = provider.outbox[provider.outbox.length - 1];
    if (!last?.tokenValue) throw new Error('no email captured');
    return last.tokenValue;
  };

  async function registerUser(email: string): Promise<{ token: string }> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { token: lastToken() };
  }

  async function verifiedUser(email: string): Promise<string> {
    const { token } = await registerUser(email);
    const verification = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token });
    expect(verification.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('user not created');
    return user.id;
  }

  async function login(email: string): Promise<Credentials> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { cookie: sessionCookie(res), csrf: csrfOf(res) };
  }

  async function promoteGlobal(userId: string, roleCode: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) throw new Error(`role ${roleCode} not seeded`);
    await prisma.userRole.create({
      data: { userId, roleId: role.id, assignedById: userId },
    });
  }

  let superAdmin: { email: string; id: string };
  let superAdminAuth: Credentials;
  const orgAIdHolder: string[] = [];
  const orgBIdHolder: string[] = [];
  const facilityAIdHolder: string[] = [];
  const facilityBIdHolder: string[] = [];
  const staffA: { email: string; id: string } = { email: '', id: '' };
  const managerA: { email: string; id: string } = { email: '', id: '' };
  const plainUser: { email: string; id: string } = { email: '', id: '' };

  describe('authentication and permission gate', () => {
    it('rejects unauthenticated access to platform endpoints', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
      await request(app.getHttpServer()).get('/api/v1/organizations').expect(401);
      await request(app.getHttpServer()).get('/api/v1/facilities').expect(401);
    });

    it('denies users who lack the required permission (403)', async () => {
      plainUser.email = makeEmail('plain');
      plainUser.id = await verifiedUser(plainUser.email);
      const auth = await login(plainUser.email);
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Cookie', auth.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Cookie', auth.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ code: `NOPE${stamp.toUpperCase()}`, name: 'Nope' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .expect(403);
    });

    it('rejects state-changing calls without the csrf header even for permitted users', async () => {
      superAdmin = { email: makeEmail('super'), id: '' };
      superAdmin.id = await verifiedUser(superAdmin.email);
      await promoteGlobal(superAdmin.id, 'PLATFORM_SUPER_ADMIN');
      superAdminAuth = await login(superAdmin.email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .send({ code: `CSRF${stamp.toUpperCase()}`, name: 'Csrf check' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_VIOLATION');
    });
  });

  describe('platform super admin manages organizations', () => {
    const orgCode = `E2EORG${stamp.toUpperCase()}`;
    orgCodes.push(orgCode);

    it('creates an organization and normalizes the code to uppercase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: orgCode.toLowerCase(), name: 'Meridian Regional Hospital' })
        .expect(201);
      expect(res.body.data.code).toBe(orgCode);
      expect(res.body.data.status).toBe('ACTIVE');
      orgAIdHolder.push(res.body.data.id as string);
    });

    it('rejects duplicate organization codes', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: orgCode, name: 'Duplicate org' })
        .expect(409);
      expect(res.body.error.code).toBe('ORGANIZATION_CODE_EXISTS');
    });

    it('updates an organization', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${orgAIdHolder[0]}`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ name: 'Meridian Regional Hospital (Renamed)' })
        .expect(200);
      expect(res.body.data.name).toBe('Meridian Regional Hospital (Renamed)');
    });

    it('lists and fetches organizations the caller can see', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(list.body.data.items.map((o: { code: string }) => o.code)).toContain(orgCode);
      const single = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAIdHolder[0]}`)
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(single.body.data.id).toBe(orgAIdHolder[0]);
    });

    it('measures page bounds', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/organizations?limit=0')
        .set('Cookie', superAdminAuth.cookie)
        .expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('facility lifecycle', () => {
    const facilityACode = `E2EFACA${stamp.toUpperCase()}`;
    facilityCodes.push(facilityACode);

    it('creates a facility under the org', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({
          organizationId: orgAIdHolder[0],
          code: facilityACode.toLowerCase(),
          name: 'Meridian Central Blood Bank',
          type: 'BLOOD_BANK',
        })
        .expect(201);
      expect(res.body.data.code).toBe(facilityACode);
      expect(res.body.data.organization.code).toBe(orgCodes[0]);
      facilityAIdHolder.push(res.body.data.id as string);
    });

    it('lists facilities the caller can see', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(list.body.data.items.map((f: { code: string }) => f.code)).toContain(facilityACode);
    });

    it('rejects a facility code that already exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({
          organizationId: orgAIdHolder[0],
          code: facilityACode,
          name: 'Duplicate facility',
          type: 'BLOOD_BANK',
        })
        .expect(409);
      expect(res.body.error.code).toBe('FACILITY_CODE_EXISTS');
    });

    it('rejects creating under a missing or inactive organization', async () => {
      const missing = await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({
          organizationId: '00000000-0000-0000-0000-000000000000',
          code: `E2EFGX${stamp.toUpperCase()}`,
          name: 'Ghost',
          type: 'HOSPITAL',
        })
        .expect(404);
      expect(missing.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

      const inactiveOrgCode = `E2EOFF${stamp.toUpperCase()}`;
      orgCodes.push(inactiveOrgCode);
      const inactive = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: inactiveOrgCode, name: 'Inactive Org' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${inactive.body.data.id}`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ status: 'INACTIVE' })
        .expect(200);
      const res = await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({
          organizationId: inactive.body.data.id,
          code: `E2EFIA${stamp.toUpperCase()}`,
          name: 'Under inactive',
          type: 'BLOOD_BANK',
        })
        .expect(409);
      expect(res.body.error.code).toBe('ORGANIZATION_INACTIVE');
    });
  });

  describe('facility membership', () => {
    it('adds members with facility-scoped roles', async () => {
      staffA.email = makeEmail('staff');
      staffA.id = await verifiedUser(staffA.email);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: staffA.id, role: 'LAB_STAFF' })
        .expect(201);
      expect(res.body.data.membership.roleCode).toBe('LAB_STAFF');
      expect(res.body.data.membership.email).toBe(staffA.email);
    });

    it('lists members of a facility', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(res.body.data.items.map((m: { email: string }) => m.email)).toContain(staffA.email);
    });

    it('rejects duplicate memberships, non-facility roles, and unknown users', async () => {
      const duplicate = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: staffA.id, role: 'LAB_STAFF' })
        .expect(409);
      expect(duplicate.body.error.code).toBe('MEMBERSHIP_EXISTS');

      const badRole = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: staffA.id, role: 'PLATFORM_ADMIN' })
        .expect(400);
      expect(badRole.body.error.code).toBe('INVALID_MEMBERSHIP_ROLE');

      const ghost = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: '00000000-0000-0000-0000-000000000000', role: 'LAB_STAFF' })
        .expect(404);
      expect(ghost.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('removes a membership and reflects it in the list', async () => {
      const removalEmail = makeEmail('leaver');
      const removalId = await verifiedUser(removalEmail);
      const add = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: removalId, role: 'HOSPITAL_STAFF' })
        .expect(201);
      const membershipId = add.body.data.membership.id;
      await request(app.getHttpServer())
        .delete(`/api/v1/facilities/${facilityAIdHolder[0]}/members/${membershipId}`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .expect(200);
      const list = await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(list.body.data.items.map((m: { email: string }) => m.email)).not.toContain(
        removalEmail,
      );
    });

    it('grants a facility manager membership', async () => {
      managerA.email = makeEmail('manager');
      managerA.id = await verifiedUser(managerA.email);
      await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ userId: managerA.id, role: 'FACILITY_MANAGER' })
        .expect(201);
    });
  });

  describe('facility-scoped authorization', () => {
    const orgBCode = `E2EORGB${stamp.toUpperCase()}`;
    const facilityBCode = `E2EFACB${stamp.toUpperCase()}`;
    orgCodes.push(orgBCode);
    facilityCodes.push(facilityBCode);

    beforeAll(async () => {
      const orgB = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: orgBCode, name: 'Southside Clinic' })
        .expect(201);
      orgBIdHolder.push(orgB.body.data.id as string);
      const facilityB = await request(app.getHttpServer())
        .post('/api/v1/facilities')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({
          organizationId: orgB.body.data.id,
          code: facilityBCode,
          name: 'Southside Blood Bank',
          type: 'BLOOD_BANK',
        })
        .expect(201);
      facilityBIdHolder.push(facilityB.body.data.id as string);
    });

    it('allows lab staff to read their own facility and its members', async () => {
      const auth = await login(staffA.email);
      const facility = await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityAIdHolder[0]}`)
        .set('Cookie', auth.cookie)
        .expect(200);
      expect(facility.body.data.id).toBe(facilityAIdHolder[0]);
      await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', auth.cookie)
        .expect(200);
    });

    it('blocks lab staff from managing the facility or its members', async () => {
      const auth = await login(staffA.email);
      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/facilities/${facilityAIdHolder[0]}`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ name: 'Hijack' })
        .expect(403);
      expect(patch.body.error.code).toBe('FORBIDDEN');
      const add = await request(app.getHttpServer())
        .post(`/api/v1/facilities/${facilityAIdHolder[0]}/members`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ userId: plainUser.id, role: 'HOSPITAL_STAFF' })
        .expect(403);
      expect(add.body.error.code).toBe('FORBIDDEN');
    });

    it('hides facilities outside the users scope (cross-facility)', async () => {
      const staffAuth = await login(staffA.email);
      const deniedFacility = await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityBIdHolder[0]}`)
        .set('Cookie', staffAuth.cookie)
        .expect(403);
      expect(deniedFacility.body.error.code).toBe('FORBIDDEN');
      const deniedMembers = await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityBIdHolder[0]}/members`)
        .set('Cookie', staffAuth.cookie)
        .expect(403);
      expect(deniedMembers.body.error.code).toBe('FORBIDDEN');
    });

    it('masks out-of-scope organizations as 404 (anti-enumeration)', async () => {
      const managerAuth = await login(managerA.email);
      const visible = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAIdHolder[0]}`)
        .set('Cookie', managerAuth.cookie)
        .expect(200);
      expect(visible.body.data.id).toBe(orgAIdHolder[0]);
      const hidden = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgBIdHolder[0]}`)
        .set('Cookie', managerAuth.cookie)
        .expect(404);
      expect(hidden.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
      const scopedList = await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Cookie', managerAuth.cookie)
        .expect(200);
      const codes = scopedList.body.data.items.map((o: { code: string }) => o.code);
      expect(codes).toContain(orgCodes[0]);
      expect(codes).not.toContain(orgBCode);
      const staffDenied = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAIdHolder[0]}`)
        .set('Cookie', (await login(staffA.email)).cookie)
        .expect(403);
      expect(staffDenied.body.error.code).toBe('FORBIDDEN');
    });

    it('lets a facility manager manage their own facility but no other', async () => {
      const auth = await login(managerA.email);
      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/facilities/${facilityAIdHolder[0]}`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ name: 'Meridian Central - Main Site' })
        .expect(200);
      expect(updated.body.data.name).toBe('Meridian Central - Main Site');
      const crossFacility = await request(app.getHttpServer())
        .patch(`/api/v1/facilities/${facilityBIdHolder[0]}`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ name: 'Hijack B' })
        .expect(403);
      expect(crossFacility.body.error.code).toBe('FORBIDDEN');
      await request(app.getHttpServer())
        .get(`/api/v1/facilities/${facilityBIdHolder[0]}`)
        .set('Cookie', auth.cookie)
        .expect(403);
    });
  });

  describe('profile and effective permissions', () => {
    it('shows memberships, roles, and effective permissions in /users/me', async () => {
      const auth = await login(staffA.email);
      const me = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', auth.cookie)
        .expect(200);
      expect(me.body.data.user.email).toBe(staffA.email);
      expect(me.body.data.globalRoles).toEqual([]);
      expect(me.body.data.memberships).toHaveLength(1);
      expect(me.body.data.memberships[0].role).toBe('LAB_STAFF');
      expect(me.body.data.memberships[0].facilityId).toBe(facilityAIdHolder[0]);
      expect(me.body.data.effectivePermissions).toContain('inventory.read');
      expect(me.body.data.effectivePermissions).not.toContain('facility.manage_members');
    });

    it('updates the profile name', async () => {
      const auth = await login(staffA.email);
      const updated = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ name: 'Staff Person' })
        .expect(200);
      expect(updated.body.data.user.name).toBe('Staff Person');
    });

    it('reports the super admin global role and full permission set', async () => {
      const me = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', superAdminAuth.cookie)
        .expect(200);
      expect(me.body.data.globalRoles).toContain('PLATFORM_SUPER_ADMIN');
      expect(me.body.data.effectivePermissions).toContain('organization.manage');
      expect(me.body.data.effectivePermissions).toContain('user.manage_roles');
    });
  });

  describe('global role assignment', () => {
    let auditor: { email: string; id: string };

    it('assigns and revokes a global role and guards the last super admin', async () => {
      auditor = { email: makeEmail('auditor'), id: '' };
      auditor.id = await verifiedUser(auditor.email);

      const badScope = await request(app.getHttpServer())
        .post(`/api/v1/users/${auditor.id}/roles`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ role: 'LAB_STAFF' })
        .expect(400);
      expect(badScope.body.error.code).toBe('INVALID_ROLE_SCOPE');

      await request(app.getHttpServer())
        .post(`/api/v1/users/${auditor.id}/roles`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ role: 'auditor' })
        .expect(201);

      const duplicate = await request(app.getHttpServer())
        .post(`/api/v1/users/${auditor.id}/roles`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ role: 'AUDITOR' })
        .expect(409);
      expect(duplicate.body.error.code).toBe('ROLE_ALREADY_ASSIGNED');

      const auditorAuth = await login(auditor.email);
      await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Cookie', auditorAuth.cookie)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/${auditor.id}/roles/AUDITOR`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .expect(200);

      const nowDenied = await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Cookie', auditorAuth.cookie)
        .expect(403);
      expect(nowDenied.body.error.code).toBe('FORBIDDEN');

      const lastSuperAdmin = await request(app.getHttpServer())
        .delete(`/api/v1/users/${superAdmin.id}/roles/PLATFORM_SUPER_ADMIN`)
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .expect(409);
      expect(lastSuperAdmin.body.error.code).toBe('LAST_SUPER_ADMIN');
    });
  });

  describe('audit trail for management actions', () => {
    it('records management events with organization and facility context', async () => {
      const events = await prisma.auditEvent.findMany({
        where: {
          organizationId: orgAIdHolder[0],
          action: { in: ['organization.created', 'facility.created', 'facility.member_added'] },
        },
        orderBy: { occurredAt: 'asc' },
      });
      const actions = events.map((e) => e.action);
      expect(actions).toContain('organization.created');
      expect(actions).toContain('facility.created');
      expect(actions).toContain('facility.member_added');
      for (const event of events) {
        expect(event.organizationId).toBe(orgAIdHolder[0]);
        expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      }
      const memberEvents = events.filter((e) => e.action === 'facility.member_added');
      for (const event of memberEvents) {
        expect(event.facilityId).toBe(facilityAIdHolder[0]);
      }
      const orgEvents = await prisma.auditEvent.findMany({
        where: { action: 'organization.created', targetId: orgAIdHolder[0] },
      });
      expect(orgEvents.length).toBeGreaterThan(0);
      expect(orgEvents[0]?.targetType).toBe('organization');
      expect(orgEvents[0]?.actorUserId).toBe(superAdmin.id);
    });
  });
});