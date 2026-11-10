import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  UnitState,
  OrganizationStatus,
  FacilityStatus,
  FacilityType,
  BloodRequestStatus,
  RequestUrgency,
  ReservationStatus,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RequestReservationService } from '../src/modules/inventory/application/request-reservation.service';
import { ExpiryService } from '../src/modules/inventory/application/expiry.service';
import { InventoryMovementService } from '../src/modules/inventory/application/inventory-movement.service';
import { CompatibilityRuleSetRepository } from '../src/modules/matching/infrastructure/compatibility-rule-set.repository';
import { AuditService } from '../src/common/audit/audit.service';

/**
 * Genuine PostgreSQL integration/concurrency tests for Phase 5 Step 4 request-scoped reservations.
 * Requires TEST_DATABASE_URL pointing to an ISOLATED local/test PostgreSQL.
 * Never run against production or shared Supabase. Skipped when TEST_DATABASE_URL is not set.
 *
 * NON-CLINICAL TEST FIXTURE: creates an isNonClinicalFixture=true ACTIVE rule set in the isolated DB.
 * This is test-only and never represents clinical truth.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIf = TEST_URL ? describe : describe.skip;

function assertSafeTestDatabase(url: string): void {
  const lower = url.toLowerCase();
  if (lower.includes('supabase') || lower.includes('pooler.supabase') || lower.includes('.supabase.co')) {
    throw new Error('Refusing to run reservation concurrency tests against a Supabase/shared database URL.');
  }
}

describeIf('Request reservation concurrency (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: RequestReservationService;
  let orgId: string;
  let facilityId: string;
  let componentTypeId: string;
  let requestId: string;
  let lineId: string;
  let ruleSetId: string;
  let actorUserId: string;

  const actor = {
    userId: '',
    sessionId: 's',
    globalPermissions: new Set(['inventory.reserve', 'request.read']),
    facilityPermissions: new Map<string, ReadonlySet<string>>(),
  } as any;

  async function createUnit(state: UnitState = UnitState.AVAILABLE, expiresAt = new Date(Date.now() + 30 * 86400000), extra: any = {}) {
    return prisma.bloodComponentUnit.create({
      data: {
        publicCode: `RR-${randomUUID().slice(0, 8)}`.toUpperCase(),
        donationId: (await getOrCreateDonation()).id,
        componentTypeId,
        facilityId,
        bloodGroup: 'A_POS' as any,
        state,
        collectionAt: new Date(),
        expiresAt,
        ...extra,
      },
    });
  }

  async function createApprovedRequest(qty = 2) {
    const req = await prisma.bloodRequest.create({
      data: {
        publicCode: `RREQ-${randomUUID().slice(0, 8)}`.toUpperCase(),
        facilityId,
        urgency: RequestUrgency.NORMAL,
        status: BloodRequestStatus.APPROVED,
        lines: { create: [{ componentTypeId, bloodGroupRequired: 'A_POS' as any, quantityRequested: qty }] },
      },
      include: { lines: true },
    });
    return { requestId: req.id, lineId: req.lines[0]!.id };
  }

  let donationId: string;
  let donorProfileId: string;
  let donorUserId: string;
  async function getOrCreateDonation() {
    if (donationId) return { id: donationId };
    const user = await prisma.user.create({
      data: {
        email: `rr-donor-${randomUUID()}@test.local`,
        passwordHash: 'not-used',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      } as any,
    });
    donorUserId = user.id;
    const donor = await prisma.donorProfile.create({
      data: { publicCode: `RDN-${randomUUID().slice(0, 8)}`.toUpperCase(), name: 'RR Donor', userId: user.id },
    });
    donorProfileId = donor.id;
    const d = await prisma.donation.create({
      data: {
        publicCode: `RDO-${randomUUID().slice(0, 8)}`.toUpperCase(),
        donorProfileId: donor.id,
        facilityId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: 'A_POS' as any,
      } as any,
    });
    donationId = d.id;
    return d;
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    assertSafeTestDatabase(TEST_URL);
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    const movementService = new InventoryMovementService(prisma);
    const expiryService = new ExpiryService(prisma, movementService);
    const ruleSetRepo = new CompatibilityRuleSetRepository(prisma);
    const audit = new AuditService(prisma);
    const config = new ConfigService({ NODE_ENV: 'test' });
    service = new RequestReservationService(prisma, expiryService, ruleSetRepo, config, audit);

    const org = await prisma.organization.create({
      data: { code: `RR${Date.now()}`.slice(0, 10), name: 'RR Org', status: OrganizationStatus.ACTIVE },
    });
    orgId = org.id;
    const fac = await prisma.facility.create({
      data: { organizationId: orgId, code: `RRF${Date.now()}`.slice(0, 10), name: 'RR Fac', type: FacilityType.BLOOD_BANK, status: FacilityStatus.ACTIVE },
    });
    facilityId = fac.id;
    const actorUser = await prisma.user.create({
      data: { email: `rr-actor-${randomUUID()}@test.local`, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date() } as any,
    });
    actorUserId = actorUser.id;
    actor.userId = actorUserId;
    actor.facilityPermissions = new Map([[facilityId, new Set(['inventory.reserve', 'request.read', 'inventory.release_reservation'])]]);

    const ct = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!ct) throw new Error('No component type');
    componentTypeId = ct.id;

    // NON-CLINICAL fixture rule set (test-only)
    const rs = await prisma.compatibilityRuleSet.create({
      data: {
        code: `NONCLIN-RR-${Date.now()}`.slice(0, 40),
        version: 'rr-test-1',
        name: 'NON-CLINICAL TEST FIXTURE - request reservation concurrency',
        status: 'ACTIVE',
        isNonClinicalFixture: true,
        sourceReference: 'AUTOMATED_TEST_ONLY',
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
      },
    });

    const req = await prisma.bloodRequest.create({
      data: {
        publicCode: `RREQ-${Date.now()}`.slice(0, 16),
        facilityId,
        urgency: RequestUrgency.NORMAL,
        status: BloodRequestStatus.APPROVED,
        lines: {
          create: [
            { componentTypeId, bloodGroupRequired: 'A_POS' as any, quantityRequested: 2 },
            { componentTypeId, bloodGroupRequired: 'A_POS' as any, quantityRequested: 1 },
          ],
        },
      },
      include: { lines: true },
    });
    requestId = req.id;
    lineId = req.lines[0]!.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.auditEvent.deleteMany({ where: { facilityId } });
      await prisma.inventoryMovement.deleteMany({ where: { facilityId } });
      await prisma.reservationItem.deleteMany({ where: { reservation: { facilityId } } });
      await prisma.reservation.deleteMany({ where: { facilityId } });
      await prisma.issuanceItem.deleteMany({ where: { issuance: { facilityId } } });
      await prisma.issuance.deleteMany({ where: { facilityId } });
      await prisma.bloodRequestLine.deleteMany({ where: { request: { facilityId } } });
      await prisma.bloodRequest.deleteMany({ where: { facilityId } });
      await prisma.bloodComponentUnit.deleteMany({ where: { facilityId } });
      if (donationId) await prisma.donation.deleteMany({ where: { id: donationId } });
      if (donorProfileId) await prisma.donorProfile.deleteMany({ where: { id: donorProfileId } });
      if (donorUserId) await prisma.user.deleteMany({ where: { id: donorUserId } });
      if (actorUserId) await prisma.user.deleteMany({ where: { id: actorUserId } });
      if (ruleSetId) {
        await prisma.compatibilityRule.deleteMany({ where: { ruleSetId } });
        await prisma.compatibilityRuleSet.deleteMany({ where: { id: ruleSetId } });
      }
      await prisma.facility.deleteMany({ where: { id: facilityId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('only one concurrent reservation succeeds for the same unit (no double active claim)', async () => {
    const unit = await createUnit();
    const [a, b] = await Promise.allSettled([
      service.createForRequest(actor, { requestId, items: [{ unitId: unit.id, requestLineId: lineId }] }, { requestId: 'c1' }),
      service.createForRequest(actor, { requestId, items: [{ unitId: unit.id, requestLineId: lineId }] }, { requestId: 'c2' }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
    const movements = await prisma.inventoryMovement.count({
      where: { unitId: unit.id, movementType: 'RESERVED', toState: UnitState.RESERVED },
    });
    expect(movements).toBe(1);
    const final = await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    expect(final?.state).toBe(UnitState.RESERVED);
  });

  it('supports multiple units in one reservation and partial fulfillment quantities', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(3);
    const u1 = await createUnit(UnitState.AVAILABLE, new Date(Date.now() + 10 * 86400000));
    const u2 = await createUnit(UnitState.AVAILABLE, new Date(Date.now() + 12 * 86400000));
    const result = await service.createForRequest(
      actor,
      { requestId: rid, items: [{ unitId: u1.id, requestLineId: lid }, { unitId: u2.id, requestLineId: lid }] },
      { requestId: 'c3' },
    );
    expect((result as any).idempotent).toBe(false);
    expect((result as any).reservation.items).toHaveLength(2);
    const line = await prisma.bloodRequestLine.findUnique({ where: { id: lid } });
    expect(line?.quantityReserved).toBe(2);
  });

  it('idempotent retries do not create duplicate reservations or claims', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(1);
    const unit = await createUnit();
    const key = `idem-${randomUUID()}`;
    const first = await service.createForRequest(actor, { requestId: rid, items: [{ unitId: unit.id, requestLineId: lid }], idempotencyKey: key }, { requestId: 'c4' });
    const second = await service.createForRequest(actor, { requestId: rid, items: [{ unitId: unit.id, requestLineId: lid }], idempotencyKey: key }, { requestId: 'c5' });
    expect((first as any).idempotent).toBe(false);
    expect((second as any).idempotent).toBe(true);
    expect((second as any).reservation.id).toBe((first as any).reservation.id);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
  });

  it('rejects expired, recalled, and quarantined units', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(5);
    const expired = await createUnit(UnitState.AVAILABLE, new Date(Date.now() - 86400000));
    await expect(
      service.createForRequest(actor, { requestId: rid, items: [{ unitId: expired.id, requestLineId: lid }] }, { requestId: 'c6' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'UNIT_NOT_AVAILABLE' }) });

    const recalled = await createUnit(UnitState.RECALLED);
    await expect(
      service.createForRequest(actor, { requestId: rid, items: [{ unitId: recalled.id, requestLineId: lid }] }, { requestId: 'c7' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'UNIT_NOT_AVAILABLE' }) });

    const quarantined = await createUnit(UnitState.QUARANTINED);
    await expect(
      service.createForRequest(actor, { requestId: rid, items: [{ unitId: quarantined.id, requestLineId: lid }] }, { requestId: 'c8' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'UNIT_NOT_AVAILABLE' }) });
  });

  it('enforces DB constraint: only one active claim per unit', async () => {
    const unit = await createUnit();
    const res = await prisma.reservation.create({ data: { facilityId, requestId, status: ReservationStatus.ACTIVE } });
    await prisma.reservationItem.create({ data: { reservationId: res.id, unitId: unit.id, requestLineId: lineId, isActive: true } });
    await expect(
      prisma.reservationItem.create({ data: { reservationId: res.id, unitId: unit.id, requestLineId: lineId, isActive: true } }),
    ).rejects.toBeTruthy();
  });

  it('release returns units to AVAILABLE, deactivates claims, decrements line quantities, and records movements', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(1);
    const unit = await createUnit();
    const created = await service.createForRequest(actor, { requestId: rid, items: [{ unitId: unit.id, requestLineId: lid }] }, { requestId: 'c9' });
    const reservationId = (created as any).reservation.id;
    const midLine = await prisma.bloodRequestLine.findUnique({ where: { id: lid } });
    expect(midLine?.quantityReserved).toBe(1);

    await service.release(actor, reservationId, 'test release', { requestId: 'c10' });
    const unitAfter = await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    expect(unitAfter?.state).toBe(UnitState.AVAILABLE);
    const active = await prisma.reservationItem.count({ where: { reservationId, isActive: true } });
    expect(active).toBe(0);
    const afterLine = await prisma.bloodRequestLine.findUnique({ where: { id: lid } });
    expect(afterLine?.quantityReserved).toBe(0);
    const releasedMovement = await prisma.inventoryMovement.count({ where: { reservationId, movementType: 'RESERVATION_RELEASED' } });
    expect(releasedMovement).toBe(1);
  });

  it('cancel works like release and sets reservation CANCELLED', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(1);
    const unit = await createUnit();
    const created = await service.createForRequest(actor, { requestId: rid, items: [{ unitId: unit.id, requestLineId: lid }] }, { requestId: 'c11' });
    const reservationId = (created as any).reservation.id;
    await service.cancel(actor, reservationId, 'cancelled', { requestId: 'c12' });
    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res?.status).toBe(ReservationStatus.CANCELLED);
    expect((await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } }))?.state).toBe(UnitState.AVAILABLE);
  });

  it('transaction rollback on failure does not partially reserve', async () => {
    const { requestId: rid, lineId: lid } = await createApprovedRequest(2);
    const good = await createUnit();
    const quarantined = await createUnit(UnitState.QUARANTINED);
    await expect(
      service.createForRequest(
        actor,
        { requestId: rid, items: [{ unitId: good.id, requestLineId: lid }, { unitId: quarantined.id, requestLineId: lid }] },
        { requestId: 'c13' },
      ),
    ).rejects.toBeTruthy();
    expect((await prisma.bloodComponentUnit.findUnique({ where: { id: good.id } }))?.state).toBe(UnitState.AVAILABLE);
    expect(await prisma.reservationItem.count({ where: { unitId: good.id, isActive: true } })).toBe(0);
  });
});
