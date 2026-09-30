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
const EMAIL_DOMAIN = 'donor-e2e-blood-ops.invalid';
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

interface Credentials {
  cookie: string;
  csrf: string;
}

const hour = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const future = (hours: number): string => iso(Date.now() + hours * hour);

describe('donors, campaigns, and donation operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  const orgCodes: string[] = [];
  const facilityCodes: string[] = [];
  const orgAId: string[] = [];
  const orgBId: string[] = [];
  const facilityAId: string[] = [];
  const facilityBId: string[] = [];

  let superAdmin: { email: string; id: string };
  let superAdminAuth: Credentials;
  const managerA: { email: string; id: string } = { email: '', id: '' };
  const managerB: { email: string; id: string } = { email: '', id: '' };
  const donorA: { email: string; id: string } = { email: '', id: '' };
  const donorB: { email: string; id: string } = { email: '', id: '' };
  const donorC: { email: string; id: string } = { email: '', id: '' };
  const plainUser: { email: string; id: string } = { email: '', id: '' };

  const campaignA: string[] = [];
  const campaignB: string[] = [];
  const campaignC: string[] = [];
  const campaignD: string[] = [];
  const campaignX: string[] = [];
  const registrationB: string[] = [];
  const donationA: string[] = [];

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
      `DELETE FROM "DonationScreening" WHERE "donationId" IN (SELECT "id" FROM "Donation" WHERE "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere}));`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Donation" WHERE "donorProfileId" IN (SELECT "id" FROM "DonorProfile" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}')) OR "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere});`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CampaignRegistration" WHERE "campaignId" IN (SELECT "id" FROM "BloodDrive" WHERE "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere}));`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "DonorDeferral" WHERE "donorProfileId" IN (SELECT "id" FROM "DonorProfile" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}'));`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "DonorProfile" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}');`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "BloodDrive" WHERE ${facilityWhere === 'FALSE' ? 'FALSE' : `"facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facilityWhere})`};`);
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

  const userCredentials = new Map<string, Credentials>();
  async function credentials(email: string): Promise<Credentials> {
    const cached = userCredentials.get(email);
    if (cached) return cached;
    const creds = await login(email);
    userCredentials.set(email, creds);
    return creds;
  }

  async function promoteGlobal(userId: string, roleCode: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) throw new Error(`role ${roleCode} not seeded`);
    await prisma.userRole.create({
      data: { userId, roleId: role.id, assignedById: userId },
    });
  }

  async function addMember(facilityId: string, userId: string, role: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/facilities/${facilityId}/members`)
      .set('Cookie', superAdminAuth.cookie)
      .set('x-csrf-token', superAdminAuth.csrf)
      .send({ userId, role })
      .expect(201);
  }

  async function createFacility(orgId: string, code: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/facilities')
      .set('Cookie', superAdminAuth.cookie)
      .set('x-csrf-token', superAdminAuth.csrf)
      .send({ organizationId: orgId, code, name, type: 'BLOOD_BANK' })
      .expect(201);
    const id = res.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/facilities/${id}`)
      .set('Cookie', superAdminAuth.cookie)
      .set('x-csrf-token', superAdminAuth.csrf)
      .send({ status: 'ACTIVE' })
      .expect(200);
    return id;
  }

  async function donorCode(credentials: Credentials): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/donors/me')
      .set('Cookie', credentials.cookie)
      .expect(200);
    return res.body.data.publicCode as string;
  }

  describe('platform setup', () => {
    it('bootstraps organizations, facilities, and staff members', async () => {
      superAdmin = { email: makeEmail('super'), id: '' };
      superAdmin.id = await verifiedUser(superAdmin.email);
      await promoteGlobal(superAdmin.id, 'PLATFORM_SUPER_ADMIN');
      superAdminAuth = await login(superAdmin.email);

      const orgCodeA = `E2EP3OA${stamp.toUpperCase()}`;
      orgCodes.push(orgCodeA);
      const orgA = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: orgCodeA, name: 'Meridian Regional Hospital' })
        .expect(201);
      orgAId.push(orgA.body.data.id as string);
      const facilityACode = `E2EP3FA${stamp.toUpperCase()}`;
      facilityCodes.push(facilityACode);
      facilityAId.push(await createFacility(orgAId[0]!, facilityACode, 'Meridian Central Blood Bank'));

      const orgCodeB = `E2EP3OB${stamp.toUpperCase()}`;
      orgCodes.push(orgCodeB);
      const orgB = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAdminAuth.cookie)
        .set('x-csrf-token', superAdminAuth.csrf)
        .send({ code: orgCodeB, name: 'Southside Clinic' })
        .expect(201);
      orgBId.push(orgB.body.data.id as string);
      const facilityBCode = `E2EP3FB${stamp.toUpperCase()}`;
      facilityCodes.push(facilityBCode);
      facilityBId.push(await createFacility(orgBId[0]!, facilityBCode, 'Southside Blood Bank'));

      managerA.email = makeEmail('managerA');
      managerA.id = await verifiedUser(managerA.email);
      await addMember(facilityAId[0]!, managerA.id, 'FACILITY_MANAGER');
      managerB.email = makeEmail('managerB');
      managerB.id = await verifiedUser(managerB.email);
      await addMember(facilityBId[0]!, managerB.id, 'FACILITY_MANAGER');

      plainUser.email = makeEmail('plain');
      plainUser.id = await verifiedUser(plainUser.email);
    });
  });

  describe('donor self-service', () => {
    it('creates a donor profile on first access and updates it', async () => {
      donorA.email = makeEmail('donorA');
      donorA.id = await verifiedUser(donorA.email);
      const auth = await credentials(donorA.email);
      const me = await request(app.getHttpServer())
        .get('/api/v1/donors/me')
        .set('Cookie', auth.cookie)
        .expect(200);
      expect(me.body.data.publicCode).toMatch(/^D-[A-Z2-9]{10}$/);
      expect(me.body.data.name).toBeTruthy();
      const updated = await request(app.getHttpServer())
        .patch('/api/v1/donors/me')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ name: 'Donor Alpha', bloodGroup: 'O_POS' })
        .expect(200);
      expect(updated.body.data.name).toBe('Donor Alpha');
      expect(updated.body.data.bloodGroup).toBe('O_POS');
      const history = await request(app.getHttpServer())
        .get('/api/v1/donors/me/donations')
        .set('Cookie', auth.cookie)
        .expect(200);
      expect(history.body.data.items).toEqual([]);
    });

    it('rejects staff-only donor routes for the donor', async () => {
      const auth = await credentials(donorA.email);
      const profile = await request(app.getHttpServer())
        .get('/api/v1/donors/me')
        .set('Cookie', auth.cookie)
        .expect(200);
      const id = profile.body.data.id as string;
      await request(app.getHttpServer()).get(`/api/v1/donors/${id}`).set('Cookie', auth.cookie).expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .send({ facilityId: facilityAId[0], donorProfileId: id })
        .expect(403);
      await request(app.getHttpServer()).get('/api/v1/donations').set('Cookie', auth.cookie).expect(403);
    });
  });

  describe('campaign lifecycle (staff)', () => {
    let managerAuth: Credentials;

    beforeAll(async () => {
      managerAuth = await credentials(managerA.email);
    });

    it('creates a draft campaign at an active facility', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({
          facilityId: facilityAId[0],
          name: 'Meridian Autumn Blood Drive',
          description: 'Main site collection week',
          startsAt: future(-1),
          endsAt: future(48),
          targetUnits: 60,
          capacity: 100,
        })
        .expect(201);
      expect(res.body.data.status).toBe('DRAFT');
      campaignA.push(res.body.data.id as string);
    });

    it('does not leak draft campaigns to donors', async () => {
      const auth = await credentials(donorA.email);
      const hidden = await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignA[0]}`)
        .set('Cookie', auth.cookie)
        .expect(404);
      expect(hidden.body.error.code).toBe('CAMPAIGN_NOT_FOUND');
      const list = await request(app.getHttpServer())
        .get('/api/v1/campaigns')
        .set('Cookie', auth.cookie)
        .expect(200);
      expect(list.body.data.items.map((c: { id: string }) => c.id)).not.toContain(campaignA[0]);
    });

    it('publishes the campaign and creates a second published campaign for check-in', async () => {
      const published = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignA[0]}/publish`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      expect(published.body.data.status).toBe('PUBLISHED');
      const res = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({
          facilityId: facilityAId[0],
          name: 'Meridian Walk-In Week',
          startsAt: future(-1),
          endsAt: future(48),
          capacity: 10,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${res.body.data.id}/publish`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      campaignB.push(res.body.data.id as string);
    });

    it('allows a named PATCH and status transitions through PATCH', async () => {
      const managerLogin = await credentials(managerA.email);
      const renamed = await request(app.getHttpServer())
        .patch(`/api/v1/campaigns/${campaignA[0]}`)
        .set('Cookie', managerLogin.cookie)
        .set('x-csrf-token', managerLogin.csrf)
        .send({ description: 'Main site collection week (updated)' })
        .expect(200);
      expect(renamed.body.data.description).toBe('Main site collection week (updated)');
      const badState = await request(app.getHttpServer())
        .patch(`/api/v1/campaigns/${campaignA[0]}`)
        .set('Cookie', managerLogin.cookie)
        .set('x-csrf-token', managerLogin.csrf)
        .send({ status: 'DRAFT' })
        .expect(409);
      expect(badState.body.error.code).toBe('INVALID_CAMPAIGN_STATE');
    });
  });

  describe('donor campaign booking', () => {
    let donorAuth: Credentials;
    let managerAuth: Credentials;

    beforeAll(async () => {
      donorAuth = await credentials(donorA.email);
      managerAuth = await credentials(managerA.email);
    });

    it('lists only published campaigns for a donor and lets them book', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/campaigns')
        .set('Cookie', donorAuth.cookie)
        .expect(200);
      const ids = list.body.data.items.map((c: { id: string }) => c.id as string);
      expect(ids).toContain(campaignA[0]);
      const booking = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignA[0]}/registrations`)
        .set('Cookie', donorAuth.cookie)
        .set('x-csrf-token', donorAuth.csrf)
        .expect(201);
      expect(booking.body.data.status).toBe('CONFIRMED');
      expect(booking.body.data.donor.publicCode).toMatch(/^D-/);
    });

    it('rejects duplicate registrations for the same campaign', async () => {
      const auth = await credentials(donorA.email);
      const dup = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignA[0]}/registrations`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .expect(409);
      expect(dup.body.error.code).toBe('ALREADY_REGISTERED');
    });

    it('lets the donor cancel the registration', async () => {
      const auth = await credentials(donorA.email);
      const list = await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignA[0]}/registrations`)
        .set('Cookie', (await credentials(managerA.email)).cookie)
        .expect(200);
      const registrationId = (list.body.data as Array<{ id: string; status: string }>).find(
        (r) => r.status === 'CONFIRMED',
      )?.id;
      expect(registrationId).toBeTruthy();
      const cancelled = await request(app.getHttpServer())
        .delete(`/api/v1/campaigns/${campaignA[0]}/registrations/${registrationId}`)
        .set('Cookie', auth.cookie)
        .set('x-csrf-token', auth.csrf)
        .expect(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');
    });

    it('blocked over-capacity bookings return CAMPAIGN_FULL', async () => {
      donorC.email = makeEmail('donorC');
      donorC.id = await verifiedUser(donorC.email);
      const cAuth = await credentials(donorC.email);
      const manager = await credentials(managerA.email);
      const small = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', manager.cookie)
        .set('x-csrf-token', manager.csrf)
        .send({
          facilityId: facilityAId[0],
          name: 'Small Capacity Drive',
          startsAt: future(-1),
          endsAt: future(24),
          capacity: 1,
        })
        .expect(201);
      campaignC.push(small.body.data.id as string);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignC[0]}/publish`)
        .set('Cookie', manager.cookie)
        .set('x-csrf-token', manager.csrf)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignC[0]}/registrations`)
        .set('Cookie', cAuth.cookie)
        .set('x-csrf-token', cAuth.csrf)
        .expect(201);
      const donor = await credentials(donorA.email);
      const full = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignC[0]}/registrations`)
        .set('Cookie', donor.cookie)
        .set('x-csrf-token', donor.csrf)
        .expect(409);
      expect(full.body.error.code).toBe('CAMPAIGN_FULL');
    });

    it('rejects booking a published campaign outside its window', async () => {
      const expired = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({
          facilityId: facilityAId[0],
          name: 'Last Month Drive',
          startsAt: future(-72),
          endsAt: future(-48),
        })
        .expect(201);
      campaignX.push(expired.body.data.id as string);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignX[0]}/publish`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      const closed = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignX[0]}/registrations`)
        .set('Cookie', donorAuth.cookie)
        .set('x-csrf-token', donorAuth.csrf)
        .expect(409);
      expect(closed.body.error.code).toBe('CAMPAIGN_WINDOW_CLOSED');
    });
  });

  describe('campaign check-in', () => {
    let donorAuth: Credentials;
    let managerAuth: Credentials;
    let donorCodeA: string;

    beforeAll(async () => {
      donorAuth = await credentials(donorA.email);
      managerAuth = await credentials(managerA.email);
      donorCodeA = await donorCode(donorAuth);
    });

    it('books campaign B and checks the donor in, creating a donation atomically', async () => {
      const booking = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignB[0]}/registrations`)
        .set('Cookie', donorAuth.cookie)
        .set('x-csrf-token', donorAuth.csrf)
        .expect(201);
      registrationB.push(booking.body.data.id as string);

      const checkIn = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignB[0]}/check-ins`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ donorReference: donorCodeA })
        .expect(200);
      expect(checkIn.body.data.donation.state).toBe('CHECKED_IN');
      expect(checkIn.body.data.donation.campaign.name).toBe('Meridian Walk-In Week');
      expect(checkIn.body.data.registrationStatus).toBe('CHECKED_IN');
      donationA.push(checkIn.body.data.donation.id as string);

      const single = await request(app.getHttpServer())
        .get(`/api/v1/donations/${donationA[0]}`)
        .set('Cookie', managerAuth.cookie)
        .expect(200);
      expect(single.body.data.donor.publicCode).toBe(donorCodeA);
    });

    it('is idempotent on repeat check-in', async () => {
      const managerLogin = await credentials(managerA.email);
      const again = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignB[0]}/check-ins`)
        .set('Cookie', managerLogin.cookie)
        .set('x-csrf-token', managerLogin.csrf)
        .send({ donorReference: donorCodeA })
        .expect(200);
      expect(again.body.data.donation.id).toBe(donationA[0]);
    });

    it('rejects check-in of an unregistered donor', async () => {
      const unregistered = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignB[0]}/check-ins`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ donorReference: 'D-ZZZZZZZZZZ' })
        .expect(404);
      expect(unregistered.body.error.code).toBe('DONOR_NOT_FOUND');
    });

    it('shows the campaign-linked donation in donor history', async () => {
      const history = await request(app.getHttpServer())
        .get('/api/v1/donors/me/donations')
        .set('Cookie', donorAuth.cookie)
        .expect(200);
      const ids = history.body.data.items.map((d: { id: string }) => d.id as string);
      expect(ids).toContain(donationA[0]);
    });
  });

  describe('donation operations (staff)', () => {
    let managerAuth: Credentials;
    let donorAuth: Credentials;
    let donorCodeA: string;

    beforeAll(async () => {
      managerAuth = await credentials(managerA.email);
      donorAuth = await credentials(donorA.email);
      donorCodeA = await donorCode(donorAuth);
    });

    it('creates a scheduled walk-in donation for a donor reference', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ facilityId: facilityAId[0], donorReference: donorCodeA })
        .expect(201);
      expect(res.body.data.state).toBe('SCHEDULED');
      expect(res.body.data.publicCode).toMatch(/^DN-/);
      donationA.push(res.body.data.id as string);
    });

    it('checks in the walk-in donation idempotently', async () => {
      const first = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/check-in`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      expect(first.body.data.state).toBe('CHECKED_IN');
      const second = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/check-in`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      expect(second.body.data.id).toBe(donationA[1]);
    });

    it('collects with volume and verified blood group', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 450, bloodGroup: 'O_POS' })
        .expect(200);
      expect(res.body.data.state).toBe('COLLECTED');
      expect(res.body.data.volumeMl).toBe(450);
      const missing = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 450 })
        .expect(400);
      expect(missing.body.error.code).toBe('BLOOD_GROUP_REQUIRED');
    });

    it('enters screening from COLLECTED and quarantines on PASS', async () => {
      const screening = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ bloodGroup: 'O_POS', notes: 'repeat donor, asymptomatic' })
        .expect(200);
      expect(screening.body.data.state).toBe('SCREENING');
      expect(screening.body.data.screening.result).toBe('IN_PROGRESS');
      const passed = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ decision: 'PASS' })
        .expect(200);
      expect(passed.body.data.state).toBe('QUARANTINED');
      expect(passed.body.data.screening.result).toBe('PASS');
    });

    it('requires a decision while in SCREENING', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ facilityId: facilityAId[0], donorReference: donorCodeA })
        .expect(201);
      const id = created.body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/check-in`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 450, bloodGroup: 'A_POS' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ bloodGroup: 'A_POS' })
        .expect(200);
      const none = await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({})
        .expect(400);
      expect(none.body.error.code).toBe('SCREEN_DECISION_REQUIRED');
    });

    it('releases a quarantined donation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/release`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      expect(res.body.data.state).toBe('RELEASED');
    });

    it('rejects transitions from an invalid state', async () => {
      const invalid = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 400, bloodGroup: 'O_POS' })
        .expect(409);
      expect(invalid.body.error.code).toBe('INVALID_DONATION_STATE');
      const screenFromReleased = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ bloodGroup: 'O_POS' })
        .expect(409);
      expect(screenFromReleased.body.error.code).toBe('INVALID_DONATION_STATE');
    });

    it('rejects from SCREENING and from QUARANTINED', async () => {
      const screened = await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ facilityId: facilityAId[0], donorReference: donorCodeA })
        .expect(201);
      const id = screened.body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/check-in`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 450, bloodGroup: 'A_NEG' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ bloodGroup: 'A_NEG' })
        .expect(200);
      const rejectedFromScreening = await request(app.getHttpServer())
        .post(`/api/v1/donations/${id}/reject`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ reasonCode: 'REACTIVE_TEST', reasonNote: 'positive on screening' })
        .expect(200);
      expect(rejectedFromScreening.body.data.state).toBe('REJECTED');
      expect(rejectedFromScreening.body.data.screening.result).toBe('REJECT');

      const unverified = await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ facilityId: facilityAId[0], donorReference: donorCodeA })
        .expect(201);
      const id2 = unverified.body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id2}/check-in`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id2}/collect`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ volumeMl: 450, bloodGroup: 'A_NEG' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id2}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ bloodGroup: 'A_NEG' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/donations/${id2}/screen`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ decision: 'PASS' })
        .expect(200);
      const rejectedFromQuarantine = await request(app.getHttpServer())
        .post(`/api/v1/donations/${id2}/reject`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ reasonCode: 'DISCARDED' })
        .expect(200);
      expect(rejectedFromQuarantine.body.data.state).toBe('REJECTED');
    });

    it('requires a reasonCode to reject', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/donations/${donationA[1]}/reject`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({})
        .expect(400);
      expect(res.body.error.code).toBe('REJECT_REASON_REQUIRED');
    });
  });

  describe('facility scope for donations and donors', () => {
    let managerAAuth: Credentials;
    let managerBAuth: Credentials;
    let donorBAuth: Credentials;
    let donorBCode: string;

    beforeAll(async () => {
      managerAAuth = await credentials(managerA.email);
      managerBAuth = await credentials(managerB.email);
      donorB.email = makeEmail('donorB');
      donorB.id = await verifiedUser(donorB.email);
      donorBAuth = await credentials(donorB.email);
      donorBCode = await donorCode(donorBAuth);
    });

    it('hides a donor not yet linked to the actor facility (404 mask)', async () => {
      const profile = await request(app.getHttpServer())
        .get('/api/v1/donors/me')
        .set('Cookie', donorBAuth.cookie)
        .expect(200);
      const donorBId = profile.body.data.id as string;
      const hidden = await request(app.getHttpServer())
        .get(`/api/v1/donors/${donorBId}`)
        .set('Cookie', managerAAuth.cookie)
        .expect(404);
      expect(hidden.body.error.code).toBe('DONOR_NOT_FOUND');
    });

    it('links donor visibility through donations at the actor facility', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/donations')
        .set('Cookie', managerBAuth.cookie)
        .set('x-csrf-token', managerBAuth.csrf)
        .send({ facilityId: facilityBId[0], donorReference: donorBCode })
        .expect(201);
      expect(created.body.data.publicCode).toMatch(/^DN-/);

      const profile = await request(app.getHttpServer())
        .get('/api/v1/donors/me')
        .set('Cookie', donorBAuth.cookie)
        .expect(200);
      const donorBId = profile.body.data.id as string;
      const stillHidden = await request(app.getHttpServer())
        .get(`/api/v1/donors/${donorBId}`)
        .set('Cookie', managerAAuth.cookie)
        .expect(404);
      expect(stillHidden.body.error.code).toBe('DONOR_NOT_FOUND');
      const visible = await request(app.getHttpServer())
        .get(`/api/v1/donors/${donorBId}`)
        .set('Cookie', managerBAuth.cookie)
        .expect(200);
      expect(visible.body.data.publicCode).toBe(donorBCode);
    });

    it('masks donations outside the actor facility as 404', async () => {
      const cross = await request(app.getHttpServer())
        .get(`/api/v1/donations/${donationA[0]}`)
        .set('Cookie', managerBAuth.cookie)
        .expect(404);
      expect(cross.body.error.code).toBe('DONATION_NOT_FOUND');
      const same = await request(app.getHttpServer())
        .get(`/api/v1/donations/${donationA[0]}`)
        .set('Cookie', managerAAuth.cookie)
        .expect(200);
      expect(same.body.data.id).toBe(donationA[0]);
    });

    it('enforces permission gates even with sessions (403)', async () => {
      const plain = await credentials(plainUser.email);
      await request(app.getHttpServer())
        .get('/api/v1/donations')
        .set('Cookie', plain.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/donors?search=x')
        .set('Cookie', plain.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', plain.cookie)
        .set('x-csrf-token', plain.csrf)
        .send({ facilityId: facilityAId[0], name: 'Nope' })
        .expect(403);
    });
  });

  describe('deferrals gate booking and resolution', () => {
    let managerAuth: Credentials;
    let donorAuth: Credentials;
    let donorAId: string;

    beforeAll(async () => {
      managerAuth = await credentials(managerA.email);
      donorAuth = await credentials(donorA.email);
      const profile = await request(app.getHttpServer())
        .get('/api/v1/donors/me')
        .set('Cookie', donorAuth.cookie)
        .expect(200);
      donorAId = profile.body.data.id as string;
    });

    it('records a deferral and blocks new bookings', async () => {
      const deferral = await request(app.getHttpServer())
        .post(`/api/v1/donors/${donorAId}/deferrals`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ reasonCode: 'RECENT_TATTOO', reasonNote: '8 weeks deferral' })
        .expect(201);
      expect(deferral.body.data.active).toBe(true);

      const newCampaign = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({
          facilityId: facilityAId[0],
          name: 'Meridian Rebooking Drive',
          startsAt: future(-1),
          endsAt: future(48),
        })
        .expect(201);
      campaignD.push(newCampaign.body.data.id as string);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignD[0]}/publish`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .expect(200);

      const blocked = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignD[0]}/registrations`)
        .set('Cookie', donorAuth.cookie)
        .set('x-csrf-token', donorAuth.csrf)
        .expect(409);
      expect(blocked.body.error.code).toBe('DEFERRAL_ACTIVE');
    });

    it('resolves the deferral and permits booking again', async () => {
      const deferrals = await request(app.getHttpServer())
        .get(`/api/v1/donors/${donorAId}/deferrals`)
        .set('Cookie', managerAuth.cookie)
        .expect(200);
      const deferralId = (deferrals.body.data as Array<{ id: string }>)[0]?.id;
      expect(deferralId).toBeTruthy();
      await request(app.getHttpServer())
        .post(`/api/v1/donors/${donorAId}/deferrals/${deferralId}/resolve`)
        .set('Cookie', managerAuth.cookie)
        .set('x-csrf-token', managerAuth.csrf)
        .send({ resolutionNote: 'reassessed and cleared' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignD[0]}/registrations`)
        .set('Cookie', donorAuth.cookie)
        .set('x-csrf-token', donorAuth.csrf)
        .expect(201);
    });
  });

  describe('audit trail for donation and campaign events', () => {
    it('records the full lifecycle with facility context', async () => {
      const events = await prisma.auditEvent.findMany({
        where: { facilityId: facilityAId[0], action: { in: [
          'campaign.created',
          'campaign.published',
          'campaign.registration_created',
          'campaign.registration_checked_in',
          'donation.created',
          'donation.collected',
          'donation.screening_started',
          'donation.quarantined',
          'donation.released',
          'donation.rejected',
        ] } },
      });
      const actions = new Set(events.map((e) => e.action));
      expect(actions).toContain('campaign.created');
      expect(actions).toContain('campaign.published');
      expect(actions).toContain('campaign.registration_created');
      expect(actions).toContain('campaign.registration_checked_in');
      expect(actions).toContain('donation.created');
      expect(actions).toContain('donation.collected');
      expect(actions).toContain('donation.screening_started');
      expect(actions).toContain('donation.quarantined');
      expect(actions).toContain('donation.released');
      expect(actions).toContain('donation.rejected');
      for (const event of events) {
        expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      }
      const deferralEvents = await prisma.auditEvent.findMany({
        where: { targetType: 'donor', action: { in: ['donor.deferral_created', 'donor.deferral_resolved'] } },
      });
      const deferralActions = new Set(deferralEvents.map((e) => e.action));
      expect(deferralActions).toContain('donor.deferral_created');
      expect(deferralActions).toContain('donor.deferral_resolved');
    });
  });
});