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
const EMAIL_DOMAIN = 'match-e2e-blood-ops.invalid';
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

/**
 * NON-CLINICAL TEST FIXTURE NOTICE:
 * Compatibility rule sets/values created in this spec are explicitly marked
 * isNonClinicalFixture=true and are used ONLY in isolated test databases.
 * They must never be seeded into production or treated as medically valid.
 */
describe('Request matching API (e2e, NON-CLINICAL fixtures)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  const orgCodes: string[] = [];
  const facilityCodes: string[] = [];
  let fidA = '';
  let fidB = '';
  let componentTypeId = '';
  let donorProfileId = '';
  let donorUserId = '';
  let donationId = '';
  let ruleSetId = '';
  let superAuth: Credentials;
  const managerA = { email: '', id: '' };
  const managerB = { email: '', id: '' };
  const outsider = { email: '', id: '' };
  const creds = new Map<string, Credentials>();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
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
    const unitScope = `"facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere})`;
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "actorUserId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}') OR ${reqScope} OR ${unitScope};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "InventoryMovement" WHERE "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere});`);
      await prisma.$executeRawUnsafe(`DELETE FROM "ReservationItem" WHERE "unitId" IN (SELECT "id" FROM "BloodComponentUnit" WHERE ${unitScope}) OR "reservationId" IN (SELECT "id" FROM "Reservation" WHERE ${reqScope});`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Reservation" WHERE ${reqScope};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "IssuanceItem" WHERE "issuanceId" IN (SELECT "id" FROM "Issuance" WHERE ${reqScope});`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Issuance" WHERE ${reqScope};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "BloodRequestLine" WHERE "requestId" IN (SELECT "id" FROM "BloodRequest" WHERE ${reqScope});`);
      await prisma.$executeRawUnsafe(`DELETE FROM "BloodRequest" WHERE ${reqScope};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "BloodComponentUnit" WHERE ${unitScope};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Donation" WHERE "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere});`);
      await prisma.donorProfile.deleteMany({ where: { userId: donorUserId || undefined } });
      if (ruleSetId) {
        await prisma.compatibilityRule.deleteMany({ where: { ruleSetId } });
        await prisma.compatibilityRuleSet.deleteMany({ where: { id: ruleSetId } });
      }
      await prisma.$executeRawUnsafe(`DELETE FROM "FacilityMembership" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}') OR "facilityId" IN (SELECT "id" FROM "Facility" WHERE ${facWhere});`);
      await prisma.userRole.deleteMany({ where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } } });
      await prisma.$executeRawUnsafe(`DELETE FROM "Facility" WHERE ${facWhere};`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Organization" WHERE ${orgWhere};`);
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
    } finally {
      await app.close();
    }
  });

  const lastToken = (): string => {
    const last = provider.outbox[provider.outbox.length - 1];
    if (!last?.tokenValue) throw new Error('no email captured');
    return last.tokenValue;
  };
  async function verifiedUser(email: string): Promise<string> {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(201);
    const token = lastToken();
    await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
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
  async function createRequestAsSuper(facilityId: string, bloodGroupRequired: string | null, qty = 2): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Cookie', superAuth.cookie)
      .set('x-csrf-token', superAuth.csrf)
      .send({
        facilityId,
        urgency: 'NORMAL',
        lines: [{ componentTypeId, bloodGroupRequired, quantityRequested: qty }],
      })
      .expect(201);
    return res.body.data.id as string;
  }
  async function createUnit(facilityId: string, state: string, bloodGroup = 'A_POS', expiresAt?: Date, publicCode?: string) {
    return prisma.bloodComponentUnit.create({
      data: {
        publicCode: publicCode ?? `MUNIT-${stamp}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
        donationId,
        componentTypeId,
        facilityId,
        bloodGroup: bloodGroup as any,
        state: state as any,
        collectionAt: new Date(),
        expiresAt: expiresAt ?? new Date(Date.now() + 20 * 86400000),
      },
    });
  }

  describe('setup', () => {
    it('creates fixtures and NON-CLINICAL compatibility fixture rule set', async () => {
      const superEmail = makeEmail('super');
      const superId = await verifiedUser(superEmail);
      await promoteGlobal(superId, 'PLATFORM_SUPER_ADMIN');
      superAuth = await login(superEmail);

      const orgCode = `MQA${stamp.toUpperCase()}`;
      orgCodes.push(orgCode);
      const orgRes = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', superAuth.cookie)
        .set('x-csrf-token', superAuth.csrf)
        .send({ code: orgCode, name: 'Match Test Org' })
        .expect(201);
      const orgId = orgRes.body.data.id as string;

      const faCode = `MQFA${stamp.toUpperCase()}`;
      const fbCode = `MQFB${stamp.toUpperCase()}`;
      facilityCodes.push(faCode, fbCode);
      fidA = await createActiveFacility(orgId, faCode, 'Match Facility A');
      fidB = await createActiveFacility(orgId, fbCode, 'Match Facility B');

      managerA.email = makeEmail('mgr-a'); managerA.id = await verifiedUser(managerA.email);
      managerB.email = makeEmail('mgr-b'); managerB.id = await verifiedUser(managerB.email);
      outsider.email = makeEmail('out'); outsider.id = await verifiedUser(outsider.email);
      await addMember(fidA, managerA.id, 'FACILITY_MANAGER');
      await addMember(fidB, managerB.id, 'FACILITY_MANAGER');

      donorUserId = await verifiedUser(makeEmail('donor'));
      const donor = await prisma.donorProfile.create({
        data: { publicCode: `MDNR-${stamp.toUpperCase()}`, userId: donorUserId, name: 'Match Donor' },
      });
      donorProfileId = donor.id;
      const donation = await prisma.donation.create({
        data: {
          publicCode: `MDON-${stamp.toUpperCase()}`,
          donorProfileId,
          facilityId: fidA,
          state: 'RELEASED',
          scheduledFor: new Date(),
          collectedAt: new Date(),
          bloodGroup: 'A_POS' as any,
        } as any,
      });
      donationId = donation.id;

      // NON-CLINICAL fixture only. Never seed in production. Isolated test DB.
      const rs = await prisma.compatibilityRuleSet.create({
        data: {
          code: `NONCLINICAL-MATCH-${stamp}`.toUpperCase(),
          version: 'test-fixture-1',
          name: 'NON-CLINICAL TEST FIXTURE - DO NOT USE FOR CLINICAL DECISIONS',
          status: 'ACTIVE',
          isNonClinicalFixture: true,
          sourceReference: 'AUTOMATED_TEST_ONLY',
          notes: 'Isolated test fixture. Not medically reviewed. Not for production matching.',
        },
      });
      ruleSetId = rs.id;
      await prisma.compatibilityRule.create({
        data: {
          ruleSetId,
          componentTypeId,
          recipientBloodGroup: 'A_POS' as any,
          donorBloodGroup: 'A_POS' as any,
          isCompatible: true,
          priority: 1,
          notes: 'NON-CLINICAL fixture rule',
        },
      });
    });
  });

  describe('authorization and isolation', () => {
    it('returns 401 without authentication', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS');
      await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).expect(401);
    });

    it('masks cross-facility request as 404', async () => {
      const reqId = await createRequestAsSuper(fidB, 'A_POS');
      const auth = await login(managerA.email);
      const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', auth.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('REQUEST_NOT_FOUND');
    });

    it('returns authorized matches for in-scope request', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS');
      const auth = await login(managerA.email);
      const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', auth.cookie).expect(200);
      expect(res.body.data.requestId).toBe(reqId);
      expect(res.body.data.ruleSet.version).toBe('test-fixture-1');
      expect(res.body.data.ruleSet.isNonClinicalFixture).toBe(true);
      expect(res.body.data.advisoryNotice).toMatch(/not a clinical decision/i);
      expect(res.body.meta.requestId).toBeTruthy();
      expect(Array.isArray(res.body.data.lines)).toBe(true);
    });
  });

  describe('eligibility, exclusions, FEFO, partial matching', () => {
    it('excludes expired/recalled/quarantined/reserved/ineligible-state units and returns FEFO partial matches', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS', 3);
      const sooner = await createUnit(fidA, 'AVAILABLE', 'A_POS', new Date(Date.now() + 5 * 86400000), `MFEFO-A-${stamp}`);
      const later = await createUnit(fidA, 'AVAILABLE', 'A_POS', new Date(Date.now() + 15 * 86400000), `MFEFO-B-${stamp}`);
      await createUnit(fidA, 'QUARANTINED', 'A_POS', new Date(Date.now() + 6 * 86400000), `MQ-${stamp}`);
      await createUnit(fidA, 'RECALLED', 'A_POS', new Date(Date.now() + 6 * 86400000), `MR-${stamp}`);
      await createUnit(fidA, 'DISCARDED', 'A_POS', new Date(Date.now() + 6 * 86400000), `MD-${stamp}`);
      await createUnit(fidA, 'EXPIRED', 'A_POS', new Date(Date.now() - 86400000), `ME-${stamp}`);
      await createUnit(fidA, 'ISSUED', 'A_POS', new Date(Date.now() + 6 * 86400000), `MI-${stamp}`);
      const reservedUnit = await createUnit(fidA, 'RESERVED', 'A_POS', new Date(Date.now() + 6 * 86400000), `MRS-${stamp}`);
      const resv = await prisma.reservation.create({ data: { facilityId: fidA, status: 'ACTIVE' as any } });
      await prisma.reservationItem.create({ data: { reservationId: resv.id, unitId: reservedUnit.id, isActive: true } });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/requests/${reqId}/matches?limitPerLine=50`)
        .set('Cookie', superAuth.cookie)
        .expect(200);
      const line = res.body.data.lines[0];
      expect(line.quantityNeeded).toBe(3);
      expect(line.quantityEligible).toBe(2);
      expect(line.shortfall).toBe(1);
      const eligibleIds = line.candidates.filter((c: any) => c.eligible).map((c: any) => c.unitId);
      expect(eligibleIds).toEqual([sooner.id, later.id]); // FEFO
      const reasonsById = Object.fromEntries(line.candidates.map((c: any) => [c.unitId, c.exclusionReasons]));
      expect(reasonsById[reservedUnit.id]).toContain('RESERVED_OR_ACTIVELY_CLAIMED');
      const quarantined = line.candidates.find((c: any) => c.exclusionReasons?.includes('STATE_QUARANTINED'));
      expect(quarantined).toBeTruthy();
      const recalled = line.candidates.find((c: any) => c.exclusionReasons?.includes('STATE_RECALLED'));
      expect(recalled).toBeTruthy();
    });

    it('excludes effectively expired AVAILABLE units', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS', 1);
      const stale = await createUnit(fidA, 'AVAILABLE', 'A_POS', new Date(Date.now() - 60000), `MSTALE-${stamp}`);
      const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', superAuth.cookie).expect(200);
      const cand = res.body.data.lines[0].candidates.find((c: any) => c.unitId === stale.id);
      expect(cand?.eligible).toBe(false);
      expect(cand?.exclusionReasons).toContain('EFFECTIVELY_EXPIRED');
    });

    it('does not mutate inventory, reservations, or movements on repeated matching', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS', 1);
      await createUnit(fidA, 'AVAILABLE', 'A_POS', new Date(Date.now() + 10 * 86400000), `MSNAP-${stamp}`);
      const [unitsBefore, reservationsBefore, reservationItemsBefore, movementsBefore] = await Promise.all([
        prisma.bloodComponentUnit.findMany({ where: { facilityId: fidA }, select: { id: true, state: true, updatedAt: true } }),
        prisma.reservation.count({ where: { facilityId: fidA } }),
        prisma.reservationItem.count({ where: { reservation: { facilityId: fidA } } }),
        prisma.inventoryMovement.count({ where: { facilityId: fidA } }),
      ]);
      await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', superAuth.cookie).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', superAuth.cookie).expect(200);
      const [unitsAfter, reservationsAfter, reservationItemsAfter, movementsAfter] = await Promise.all([
        prisma.bloodComponentUnit.findMany({ where: { facilityId: fidA }, select: { id: true, state: true, updatedAt: true } }),
        prisma.reservation.count({ where: { facilityId: fidA } }),
        prisma.reservationItem.count({ where: { reservation: { facilityId: fidA } } }),
        prisma.inventoryMovement.count({ where: { facilityId: fidA } }),
      ]);
      expect(unitsAfter).toEqual(unitsBefore);
      expect(reservationsAfter).toBe(reservationsBefore);
      expect(reservationItemsAfter).toBe(reservationItemsBefore);
      expect(movementsAfter).toBe(movementsBefore);
    });
  });

  describe('policy availability', () => {
    it('returns MATCHING_POLICY_UNAVAILABLE for inactive policy', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS', 1);
      await prisma.compatibilityRuleSet.update({ where: { id: ruleSetId }, data: { status: 'DRAFT' } });
      try {
        const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', superAuth.cookie);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('MATCHING_POLICY_UNAVAILABLE');
        expect(res.body.error.details?.reason).toBe('INACTIVE');
      } finally {
        await prisma.compatibilityRuleSet.update({ where: { id: ruleSetId }, data: { status: 'ACTIVE' } });
      }
    });

    it('returns MATCHING_POLICY_UNAVAILABLE when policy is missing', async () => {
      const reqId = await createRequestAsSuper(fidA, 'A_POS', 1);
      const savedRules = await prisma.compatibilityRule.findMany({ where: { ruleSetId } });
      const savedSet = await prisma.compatibilityRuleSet.findUnique({ where: { id: ruleSetId } });
      await prisma.compatibilityRule.deleteMany({ where: { ruleSetId } });
      await prisma.compatibilityRuleSet.delete({ where: { id: ruleSetId } });
      try {
        const res = await request(app.getHttpServer()).get(`/api/v1/requests/${reqId}/matches`).set('Cookie', superAuth.cookie);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('MATCHING_POLICY_UNAVAILABLE');
      } finally {
        if (savedSet) {
          await prisma.compatibilityRuleSet.create({
            data: {
              id: savedSet.id,
              code: savedSet.code,
              version: savedSet.version,
              name: savedSet.name,
              status: savedSet.status,
              sourceReference: savedSet.sourceReference,
              approvedBy: savedSet.approvedBy,
              approvedAt: savedSet.approvedAt,
              isNonClinicalFixture: savedSet.isNonClinicalFixture,
              notes: savedSet.notes,
              effectiveFrom: savedSet.effectiveFrom,
              effectiveTo: savedSet.effectiveTo,
            },
          });
          for (const r of savedRules) {
            await prisma.compatibilityRule.create({
              data: {
                id: r.id,
                ruleSetId,
                componentCategory: r.componentCategory,
                componentTypeId: r.componentTypeId,
                recipientBloodGroup: r.recipientBloodGroup,
                donorBloodGroup: r.donorBloodGroup,
                isCompatible: r.isCompatible,
                priority: r.priority,
                notes: r.notes,
              },
            });
          }
        }
      }
    });
  });
});
