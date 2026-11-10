import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BloodGroup,
  OrganizationStatus,
  RequestUrgency,
  UnitState,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../src/modules/auth/infrastructure/email-provider';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/domain/auth.constants';
import { DevConsoleEmailProvider } from '../src/modules/auth/infrastructure/dev-email-provider';

/**
 * Phase 5 Step 6: emergency/priority workflow (ADR-021).
 *
 * NON-CLINICAL TEST FIXTURE NOTICE:
 * The compatibility rule set created here is explicitly marked
 * isNonClinicalFixture=true and is used ONLY in an isolated local test database.
 * It must never be seeded into production or treated as medically valid.
 *
 * Emergency priority must never bypass authorization, facility scope, state
 * machines, compatibility policy, expiry, quarantine, reservation locking, or
 * issuance validation.
 */
const PASSWORD = 'correct-horse-battery-staple';
const EMAIL_DOMAIN = 'req-emergency-blood-ops.invalid';
const stamp = Date.now().toString(36);
const makeEmail = (label: string): string => `${label}-${stamp}@${EMAIL_DOMAIN}`.toLowerCase();
const day = 86_400_000;

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

describe('Emergency request workflow (e2e, NON-CLINICAL fixtures)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  let orgId = '';
  let facilityAId = '';
  let facilityBId = '';
  let componentTypeId = '';
  let ruleSetId = '';
  let donationAId = '';
  let donationBId = '';
  const donorUserIds: string[] = [];
  const donorProfileIds: string[] = [];

  let superAuth: Credentials;
  let superId = '';
  const hospitalA = { email: '', id: '' };
  const managerA = { email: '', id: '' };
  const managerB = { email: '', id: '' };
  const outsider = { email: '', id: '' };
  const creds = new Map<string, Credentials>();

  const lastToken = (): string => {
    const last = provider.outbox[provider.outbox.length - 1];
    if (!last?.tokenValue) throw new Error('no email captured');
    return last.tokenValue;
  };

  async function verifiedUser(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    const token = lastToken();
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token });
    expect(verified.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('user not created');
    return user.id;
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

  async function createActiveFacility(code: string, name: string): Promise<string> {
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

  function createAs(
    auth: Credentials,
    body: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Cookie', auth.cookie)
      .set('x-csrf-token', auth.csrf)
      .send(body);
  }

  async function createRequest(
    auth: Credentials,
    options: {
      facilityId: string;
      urgency: RequestUrgency;
      requiredByAt?: string;
      bloodGroupRequired?: BloodGroup;
    },
  ): Promise<{ id: string; lineId: string }> {
    const res = await createAs(auth, {
      facilityId: options.facilityId,
      urgency: options.urgency,
      ...(options.requiredByAt ? { requiredByAt: options.requiredByAt } : {}),
      lines: [
        {
          componentTypeId,
          ...(options.bloodGroupRequired
            ? { bloodGroupRequired: options.bloodGroupRequired }
            : {}),
          quantityRequested: 1,
        },
      ],
    }).expect(201);
    return { id: res.body.data.id as string, lineId: res.body.data.lines[0].id as string };
  }

  async function submitRequest(auth: Credentials, requestId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/requests/${requestId}/submit`)
      .set('Cookie', auth.cookie)
      .set('x-csrf-token', auth.csrf)
      .expect(200);
  }

  async function approveRequest(auth: Credentials, requestId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/requests/${requestId}/approve`)
      .set('Cookie', auth.cookie)
      .set('x-csrf-token', auth.csrf)
      .expect(200);
  }

  async function createApprovedEmergencyRequest(): Promise<{ id: string; lineId: string }> {
    const created = await createRequest(hospitalA_auth.auth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.EMERGENCY,
      bloodGroupRequired: BloodGroup.A_POS,
    });
    await submitRequest(hospitalA_auth.auth, created.id);
    await approveRequest(managerA_auth.auth, created.id);
    return created;
  }

  async function createDonorFixture(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: makeEmail(`donor-${donorUserIds.length}`),
        passwordHash: 'not-used',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      } as never,
    });
    donorUserIds.push(user.id);
    const donorProfile = await prisma.donorProfile.create({
      data: {
        publicCode: `IDN-${stamp}-${donorProfileIds.length}`.toUpperCase().slice(0, 20),
        name: 'Emergency Test Donor',
        userId: user.id,
      },
    });
    donorProfileIds.push(donorProfile.id);
    return donorProfile.id;
  }

  async function createDonation(facilityId: string): Promise<string> {
    const donorProfileId = await createDonorFixture();
    const donation = await prisma.donation.create({
      data: {
        publicCode: `IDO-${stamp}-${donorUserIds.length}`.toUpperCase().slice(0, 20),
        donorProfileId,
        facilityId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: BloodGroup.A_POS,
      } as never,
    });
    return donation.id;
  }

  async function createUnit(
    facilityId: string,
    options: {
      state?: UnitState;
      bloodGroup?: BloodGroup;
      expiresAt?: Date;
    } = {},
  ): Promise<string> {
    const donationId = facilityId === facilityAId ? donationAId : donationBId;
    const unit = await prisma.bloodComponentUnit.create({
      data: {
        publicCode: `IUN-${stamp}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 20),
        donationId,
        componentTypeId,
        facilityId,
        bloodGroup: options.bloodGroup ?? BloodGroup.A_POS,
        state: options.state ?? UnitState.AVAILABLE,
        collectionAt: new Date(),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * day),
      } as never,
    });
    return unit.id;
  }

  function reserveAs(
    auth: Credentials,
    requestId: string,
    lineId: string,
    unitId: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/requests/${requestId}/reservations`)
      .set('Cookie', auth.cookie)
      .set('x-csrf-token', auth.csrf)
      .send({ items: [{ unitId, requestLineId: lineId }] });
  }

  const hospitalA_auth = { get auth() { return creds.get(hospitalA.email)!; } };
  const managerA_auth = { get auth() { return creds.get(managerA.email)!; } };
  const managerB_auth = { get auth() { return creds.get(managerB.email)!; } };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    provider = app.get<EmailProvider>(EMAIL_PROVIDER) as DevConsoleEmailProvider;

    const componentType = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!componentType) throw new Error('No active component type seeded');
    componentTypeId = componentType.id;

    const org = await prisma.organization.create({
      data: { code: `EMR${stamp}`.toUpperCase().slice(0, 10), name: 'Emergency Test Org', status: OrganizationStatus.ACTIVE },
    });
    orgId = org.id;

    superId = await verifiedUser(makeEmail('super'));
    await promoteGlobal(superId, 'PLATFORM_SUPER_ADMIN');
    superAuth = await login(makeEmail('super'));

    facilityAId = await createActiveFacility(`EMRA${stamp}`.toUpperCase().slice(0, 10), 'Emergency Facility A');
    facilityBId = await createActiveFacility(`EMRB${stamp}`.toUpperCase().slice(0, 10), 'Emergency Facility B');

    hospitalA.email = makeEmail('hosp-a');
    hospitalA.id = await verifiedUser(hospitalA.email);
    managerA.email = makeEmail('mgr-a');
    managerA.id = await verifiedUser(managerA.email);
    managerB.email = makeEmail('mgr-b');
    managerB.id = await verifiedUser(managerB.email);
    outsider.email = makeEmail('out');
    outsider.id = await verifiedUser(outsider.email);

    await addMember(facilityAId, hospitalA.id, 'HOSPITAL_STAFF');
    await addMember(facilityAId, managerA.id, 'FACILITY_MANAGER');
    await addMember(facilityBId, managerB.id, 'FACILITY_MANAGER');

    await login(hospitalA.email);
    await login(managerA.email);
    await login(managerB.email);

    donationAId = await createDonation(facilityAId);
    donationBId = await createDonation(facilityBId);

    // NON-CLINICAL TEST FIXTURE: allowed only because NODE_ENV=test.
    const ruleSet = await prisma.compatibilityRuleSet.create({
      data: {
        code: `NONCLIN-EMR-${stamp}`.toUpperCase().slice(0, 40),
        version: 'emergency-test-1',
        name: 'NON-CLINICAL TEST FIXTURE - emergency workflow',
        status: 'ACTIVE',
        isNonClinicalFixture: true,
        sourceReference: 'AUTOMATED_TEST_ONLY',
      },
    });
    ruleSetId = ruleSet.id;
    await prisma.compatibilityRule.create({
      data: {
        ruleSetId,
        componentTypeId,
        recipientBloodGroup: BloodGroup.A_POS,
        donorBloodGroup: BloodGroup.A_POS,
        isCompatible: true,
        priority: 1,
      },
    });
  }, 60000);

  afterAll(async () => {
    if (!prisma) {
      await app?.close();
      return;
    }
    const facilityIds = [facilityAId, facilityBId].filter(Boolean);
    try {
      await prisma.auditEvent.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.issuanceItem.deleteMany({ where: { issuance: { facilityId: { in: facilityIds } } } });
      await prisma.issuance.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.reservationItem.deleteMany({
        where: { reservation: { facilityId: { in: facilityIds } } },
      });
      await prisma.reservation.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.bloodRequestLine.deleteMany({
        where: { request: { facilityId: { in: facilityIds } } },
      });
      await prisma.bloodRequest.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.bloodComponentUnit.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.donation.deleteMany({ where: { facilityId: { in: facilityIds } } });
      if (donorProfileIds.length) {
        await prisma.donorProfile.deleteMany({ where: { id: { in: donorProfileIds } } });
      }
      if (donorUserIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: donorUserIds } } });
      }
      if (ruleSetId) {
        await prisma.compatibilityRule.deleteMany({ where: { ruleSetId } });
        await prisma.compatibilityRuleSet.deleteMany({ where: { id: ruleSetId } });
      }
      await prisma.facilityMembership.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.userRole.deleteMany({
        where: { user: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
    } finally {
      await app.close();
    }
  }, 60000);

  it('persists urgency and records explicit escalation audits for emergency/critical requests', async () => {
    const normal = await createRequest(superAuth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.NORMAL,
    });
    const urgent = await createRequest(superAuth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.URGENT,
    });
    const emergency = await createRequest(superAuth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.EMERGENCY,
      requiredByAt: new Date(Date.now() + day).toISOString(),
    });
    const critical = await createRequest(superAuth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.CRITICAL,
    });

    const rows = await prisma.bloodRequest.findMany({
      where: { id: { in: [normal.id, urgent.id, emergency.id, critical.id] } },
      select: { id: true, urgency: true, emergencyEscalatedAt: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(normal.id)?.urgency).toBe(RequestUrgency.NORMAL);
    expect(byId.get(normal.id)?.emergencyEscalatedAt).toBeNull();
    expect(byId.get(urgent.id)?.emergencyEscalatedAt).toBeNull();
    expect(byId.get(emergency.id)?.urgency).toBe(RequestUrgency.EMERGENCY);
    expect(byId.get(emergency.id)?.emergencyEscalatedAt).toBeTruthy();
    expect(byId.get(critical.id)?.urgency).toBe(RequestUrgency.CRITICAL);
    expect(byId.get(critical.id)?.emergencyEscalatedAt).toBeTruthy();

    const escalations = await prisma.auditEvent.findMany({
      where: {
        action: 'request.emergency_escalated',
        targetId: { in: [emergency.id, critical.id] },
      },
    });
    expect(escalations).toHaveLength(2);
    for (const event of escalations) {
      const stored = event.metadata;
      const metadata = (
        typeof stored === 'string' ? JSON.parse(stored) : stored
      ) as Record<string, unknown>;
      expect(metadata.alertRequired).toBe(true);
      expect(metadata.notificationDelivery).toBe('DEFERRED_PHASE_6');
      expect(metadata.escalatedAt).toBeTruthy();
    }
    expect(
      await prisma.auditEvent.count({
        where: {
          action: 'request.emergency_escalated',
          targetId: { in: [normal.id, urgent.id] },
        },
      }),
    ).toBe(0);
  });

  it('orders the operational queue by urgency, required-by, then age', async () => {
    const normal = await createRequest(superAuth, {
      facilityId: facilityBId,
      urgency: RequestUrgency.NORMAL,
    });
    const urgent = await createRequest(superAuth, {
      facilityId: facilityBId,
      urgency: RequestUrgency.URGENT,
      requiredByAt: new Date(Date.now() + 3 * day).toISOString(),
    });
    const emergency = await createRequest(superAuth, {
      facilityId: facilityBId,
      urgency: RequestUrgency.EMERGENCY,
    });
    const criticalLater = await createRequest(superAuth, {
      facilityId: facilityBId,
      urgency: RequestUrgency.CRITICAL,
      requiredByAt: new Date(Date.now() + 2 * day).toISOString(),
    });
    const criticalEarlier = await createRequest(superAuth, {
      facilityId: facilityBId,
      urgency: RequestUrgency.CRITICAL,
      requiredByAt: new Date(Date.now() + day).toISOString(),
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/requests?limit=100')
      .set('Cookie', managerB_auth.auth.cookie)
      .expect(200);

    const ids = res.body.data.items
      .filter((row: { facility: { id: string } }) => row.facility.id === facilityBId)
      .map((row: { id: string }) => row.id);
    expect(ids).toEqual([
      criticalEarlier.id,
      criticalLater.id,
      emergency.id,
      urgent.id,
      normal.id,
    ]);
  });

  it('supports the emergency lifecycle without bypassing state transitions', async () => {
    const created = await createRequest(hospitalA_auth.auth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.EMERGENCY,
      requiredByAt: new Date(Date.now() + day).toISOString(),
    });

    await submitRequest(hospitalA_auth.auth, created.id);
    await approveRequest(managerA_auth.auth, created.id);

    const row = await prisma.bloodRequest.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('APPROVED');
    expect(row?.submittedAt).toBeTruthy();
    expect(row?.reviewedAt).toBeTruthy();
    expect(row?.approvedAt).toBeTruthy();
    expect(row?.emergencyEscalatedAt).toBeTruthy();

    const actions = (
      await prisma.auditEvent.findMany({
        where: { targetType: 'BloodRequest', targetId: created.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((event) => event.action);
    expect(actions).toContain('request.created');
    expect(actions).toContain('request.emergency_escalated');
    expect(actions).toContain('request.submitted');
    expect(actions).toContain('request.approved');

    const premature = await createRequest(hospitalA_auth.auth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.CRITICAL,
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/requests/${premature.id}/approve`)
      .set('Cookie', managerA_auth.auth.cookie)
      .set('x-csrf-token', managerA_auth.auth.csrf);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_REQUEST_TRANSITION');

    const stillDraft = await prisma.bloodRequest.findUnique({ where: { id: premature.id } });
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('keeps emergency requests behind authorization and facility isolation', async () => {
    const created = await createRequest(hospitalA_auth.auth, {
      facilityId: facilityAId,
      urgency: RequestUrgency.CRITICAL,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/requests/${created.id}`)
      .expect(401);

    const noPermission = await request(app.getHttpServer())
      .get(`/api/v1/requests/${created.id}`)
      .set('Cookie', (await login(outsider.email)).cookie);
    expect(noPermission.status).toBe(403);
    expect(noPermission.body.error.code).toBe('FORBIDDEN');

    const maskedRead = await request(app.getHttpServer())
      .get(`/api/v1/requests/${created.id}`)
      .set('Cookie', managerB_auth.auth.cookie);
    expect(maskedRead.status).toBe(404);
    expect(maskedRead.body.error.code).toBe('REQUEST_NOT_FOUND');

    const maskedApprove = await request(app.getHttpServer())
      .post(`/api/v1/requests/${created.id}/approve`)
      .set('Cookie', managerB_auth.auth.cookie)
      .set('x-csrf-token', managerB_auth.auth.csrf);
    expect(maskedApprove.status).toBe(404);
    expect(maskedApprove.body.error.code).toBe('REQUEST_NOT_FOUND');

    const stillDraft = await prisma.bloodRequest.findUnique({ where: { id: created.id } });
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('does not let emergency priority bypass reservation safety rules', async () => {
    const target = await createApprovedEmergencyRequest();

    const incompatibleUnit = await createUnit(facilityAId, { bloodGroup: BloodGroup.B_POS });
    const incompatible = await reserveAs(superAuth, target.id, target.lineId, incompatibleUnit);
    expect(incompatible.status).toBe(409);
    expect(incompatible.body.error.code).toBe('UNIT_NOT_COMPATIBLE');

    const quarantinedUnit = await createUnit(facilityAId, { state: UnitState.QUARANTINED });
    const quarantined = await reserveAs(superAuth, target.id, target.lineId, quarantinedUnit);
    expect(quarantined.status).toBe(409);
    expect(quarantined.body.error.code).toBe('UNIT_NOT_AVAILABLE');

    const expiredUnit = await createUnit(facilityAId, {
      expiresAt: new Date(Date.now() - day),
    });
    const expired = await reserveAs(superAuth, target.id, target.lineId, expiredUnit);
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('UNIT_NOT_AVAILABLE');

    const otherFacilityUnit = await createUnit(facilityBId);
    const crossFacility = await reserveAs(superAuth, target.id, target.lineId, otherFacilityUnit);
    expect(crossFacility.status).toBe(409);
    expect(crossFacility.body.error.code).toBe('FACILITY_SCOPE_VIOLATION');

    const afterFailures = await prisma.bloodRequest.findUnique({ where: { id: target.id } });
    expect(afterFailures?.status).toBe('APPROVED');
    for (const unitId of [incompatibleUnit, quarantinedUnit, expiredUnit, otherFacilityUnit]) {
      const unit = await prisma.bloodComponentUnit.findUnique({ where: { id: unitId } });
      expect(unit?.state).not.toBe(UnitState.RESERVED);
    }

    const eligibleUnit = await createUnit(facilityAId);
    const success = await reserveAs(superAuth, target.id, target.lineId, eligibleUnit);
    expect(success.status).toBe(201);
    expect(success.body.data.reservation.status).toBe('ACTIVE');

    const reservedUnit = await prisma.bloodComponentUnit.findUnique({ where: { id: eligibleUnit } });
    expect(reservedUnit?.state).toBe(UnitState.RESERVED);
    const requestAfter = await prisma.bloodRequest.findUnique({ where: { id: target.id } });
    expect(requestAfter?.status).toBe('RESERVED');
    expect(
      await prisma.inventoryMovement.count({
        where: { unitId: eligibleUnit, movementType: 'RESERVED' },
      }),
    ).toBe(1);
  });

  it('still blocks emergency reservation when no approved active policy is available', async () => {
    const target = await createApprovedEmergencyRequest();
    const eligibleUnit = await createUnit(facilityAId);

    const active = await prisma.compatibilityRuleSet.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    const activeIds = active.map((row) => row.id);
    await prisma.compatibilityRuleSet.updateMany({
      where: { id: { in: activeIds } },
      data: { status: 'RETIRED' },
    });
    try {
      const res = await reserveAs(superAuth, target.id, target.lineId, eligibleUnit);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MATCHING_POLICY_UNAVAILABLE');
    } finally {
      await prisma.compatibilityRuleSet.updateMany({
        where: { id: { in: activeIds } },
        data: { status: 'ACTIVE' },
      });
    }

    const unitAfter = await prisma.bloodComponentUnit.findUnique({ where: { id: eligibleUnit } });
    expect(unitAfter?.state).toBe(UnitState.AVAILABLE);
    const requestAfter = await prisma.bloodRequest.findUnique({ where: { id: target.id } });
    expect(requestAfter?.status).toBe('APPROVED');
  });
});
