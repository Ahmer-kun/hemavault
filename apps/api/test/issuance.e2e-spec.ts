import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
  BloodRequestStatus,
  FacilityStatus,
  FacilityType,
  OrganizationStatus,
  PrismaClient,
  RequestUrgency,
  ReservationStatus,
  UnitState,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../src/common/audit/audit.service';
import { InventoryMovementService } from '../src/modules/inventory/application/inventory-movement.service';
import { ExpiryService } from '../src/modules/inventory/application/expiry.service';
import { RequestReservationService } from '../src/modules/inventory/application/request-reservation.service';
import { CompatibilityRuleSetRepository } from '../src/modules/matching/infrastructure/compatibility-rule-set.repository';
import { IssuanceService } from '../src/modules/issuance/application/issuance.service';

/**
 * Genuine PostgreSQL integration tests for Phase 5 Step 5 issuance/fulfillment.
 * Requires TEST_DATABASE_URL pointing to an ISOLATED local/test PostgreSQL.
 * Never run against production or shared Supabase. Skipped when unset.
 *
 * NON-CLINICAL TEST FIXTURE: creates an isNonClinicalFixture=true ACTIVE rule set
 * in the isolated DB. Test-only; never clinical truth.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIf = TEST_URL ? describe : describe.skip;

function assertSafeTestDatabase(url: string): void {
  const lower = url.toLowerCase();
  if (lower.includes('supabase') || lower.includes('pooler.supabase') || lower.includes('.supabase.co')) {
    throw new Error('Refusing to run issuance tests against a Supabase/shared database URL.');
  }
  if (!/localhost|127\.0\.0\.1|::1/.test(lower)) {
    throw new Error('Refusing to run issuance tests against a non-local database host.');
  }
}

describeIf('Issuance and fulfillment (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let issuance: IssuanceService;
  let reservations: RequestReservationService;

  let orgId: string;
  let facilityAId: string;
  let facilityBId: string;
  let componentTypeId: string;
  let ruleSetId: string;
  let donationAId: string;
  let donationBId: string;
  const userIds: string[] = [];
  const donorProfileIds: string[] = [];

  const adminId = { value: '' };

  function adminActor() {
    return {
      userId: adminId.value,
      sessionId: 'issuance-session',
      globalPermissions: new Set([
        'inventory.reserve',
        'inventory.issue',
        'inventory.read',
        'inventory.release_reservation',
        'request.read',
        'request.fulfill',
      ]),
      facilityPermissions: new Map<string, ReadonlySet<string>>(),
    };
  }

  function facilityActor() {
    return {
      userId: adminId.value,
      sessionId: 'issuance-session-facility',
      globalPermissions: new Set<string>(),
      facilityPermissions: new Map<string, ReadonlySet<string>>([
        [facilityAId, new Set(['inventory.issue', 'request.read', 'inventory.read'])],
      ]),
    };
  }

  function noPermissionActor() {
    return {
      userId: adminId.value,
      sessionId: 'issuance-session-none',
      globalPermissions: new Set<string>(),
      facilityPermissions: new Map<string, ReadonlySet<string>>(),
    };
  }

  function ctx(label: string) {
    return { requestId: `test-${label}`, ipAddress: '127.0.0.1', userAgent: 'vitest' };
  }

  async function createUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `issuance-${label}-${randomUUID()}@test.local`,
        passwordHash: 'not-used',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      } as never,
    });
    userIds.push(user.id);
    return user.id;
  }

  let donorUserId = '';
  async function getOrCreateDonor(): Promise<string> {
    if (donorProfileIds.length > 0) return donorProfileIds[0]!;
    donorUserId = await createUser('donor');
    const donor = await prisma.donorProfile.create({
      data: {
        publicCode: `IDN-${randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Issuance Donor',
        userId: donorUserId,
      },
    });
    donorProfileIds.push(donor.id);
    return donor.id;
  }

  async function createDonation(facilityId: string, label: string): Promise<string> {
    const donorProfileId = await getOrCreateDonor();
    const donation = await prisma.donation.create({
      data: {
        publicCode: `IDO-${label}-${randomUUID().slice(0, 6)}`.toUpperCase(),
        donorProfileId,
        facilityId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: 'A_POS',
      } as never,
    });
    return donation.id;
  }

  async function createUnit(
    state: UnitState = UnitState.AVAILABLE,
    options: {
      expiresAt?: Date;
      facilityId?: string;
      donationId?: string;
    } = {},
  ) {
    const facilityId = options.facilityId ?? facilityAId;
    const donationId =
      options.donationId ?? (facilityId === facilityAId ? donationAId : donationBId);
    return prisma.bloodComponentUnit.create({
      data: {
        publicCode: `IUN-${randomUUID().slice(0, 8)}`.toUpperCase(),
        donationId,
        componentTypeId,
        facilityId,
        bloodGroup: 'A_POS',
        state,
        collectionAt: new Date(),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 86400000),
      } as never,
    });
  }

  async function createRequest(
    quantity: number,
    options: { status?: BloodRequestStatus; facilityId?: string; urgency?: RequestUrgency } = {},
  ) {
    return prisma.bloodRequest.create({
      data: {
        publicCode: `IREQ-${randomUUID().slice(0, 8)}`.toUpperCase(),
        facilityId: options.facilityId ?? facilityAId,
        urgency: options.urgency ?? RequestUrgency.NORMAL,
        status: options.status ?? BloodRequestStatus.APPROVED,
        lines: {
          create: [{ componentTypeId, bloodGroupRequired: 'A_POS', quantityRequested: quantity }],
        },
      },
      include: { lines: true },
    });
  }

  async function reserve(requestId: string, lineId: string, unitIds: string[]) {
    const result = await reservations.createForRequest(
      adminActor(),
      {
        requestId,
        items: unitIds.map((unitId) => ({ unitId, requestLineId: lineId })),
        idempotencyKey: `res-${randomUUID()}`,
      },
      ctx('reserve'),
    );
    return result.reservation;
  }

  async function reserveNew(quantity = 1) {
    const request = await createRequest(quantity);
    const units = [];
    for (let index = 0; index < quantity; index += 1) {
      units.push(await createUnit());
    }
    const reservation = await reserve(request.id, request.lines[0]!.id, units.map((unit) => unit.id));
    const items = await prisma.reservationItem.findMany({
      where: { reservationId: reservation.id, isActive: true },
      orderBy: { id: 'asc' },
    });
    return { request, units, reservation, items };
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    assertSafeTestDatabase(TEST_URL);
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    const movementService = new InventoryMovementService(prisma);
    const expiryService = new ExpiryService(prisma, movementService);
    const ruleSetRepository = new CompatibilityRuleSetRepository(prisma);
    const audit = new AuditService(prisma);
    const config = new ConfigService({ NODE_ENV: 'test' });

    issuance = new IssuanceService(prisma, expiryService, movementService, audit);
    reservations = new RequestReservationService(
      prisma,
      expiryService,
      ruleSetRepository,
      config,
      audit,
    );

    const org = await prisma.organization.create({
      data: {
        code: `ISO${Date.now()}`.slice(0, 10),
        name: 'Issuance Test Org',
        status: OrganizationStatus.ACTIVE,
      },
    });
    orgId = org.id;

    const facilityA = await prisma.facility.create({
      data: {
        organizationId: org.id,
        code: `ISA${Date.now()}`.slice(0, 10),
        name: 'Issuance Facility A',
        type: FacilityType.BLOOD_BANK,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityAId = facilityA.id;
    const facilityB = await prisma.facility.create({
      data: {
        organizationId: org.id,
        code: `ISB${Date.now()}`.slice(0, 10),
        name: 'Issuance Facility B',
        type: FacilityType.BLOOD_BANK,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityBId = facilityB.id;

    adminId.value = await createUser('admin');

    const componentType = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!componentType) throw new Error('No active component type seeded');
    componentTypeId = componentType.id;

    const ruleSet = await prisma.compatibilityRuleSet.create({
      data: {
        code: `NONCLIN-ISS-${Date.now()}`.slice(0, 40),
        version: 'issuance-test-1',
        name: 'NON-CLINICAL TEST FIXTURE - issuance integration',
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
        recipientBloodGroup: 'A_POS',
        donorBloodGroup: 'A_POS',
        isCompatible: true,
        priority: 1,
      },
    });

    donationAId = await createDonation(facilityAId, 'A');
    donationBId = await createDonation(facilityBId, 'B');
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    const facilityIds = [facilityAId, facilityBId].filter(Boolean);
    try {
      await prisma.auditEvent.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.issuanceItem.deleteMany({
        where: { issuance: { facilityId: { in: facilityIds } } },
      });
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
      for (const donationId of [donationAId, donationBId].filter(Boolean)) {
        await prisma.donation.deleteMany({ where: { id: donationId } });
      }
      if (donorProfileIds.length) {
        await prisma.donorProfile.deleteMany({ where: { id: { in: donorProfileIds } } });
      }
      if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (ruleSetId) {
        await prisma.compatibilityRule.deleteMany({ where: { ruleSetId } });
        await prisma.compatibilityRuleSet.deleteMany({ where: { id: ruleSetId } });
      }
      await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  it('creates a staged issuance, then confirms and fulfills the request with movements and audit', async () => {
    const { request, units, reservation, items } = await reserveNew(2);

    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: items.map((item) => ({ reservationItemId: item.id })) },
      ctx('create-happy'),
    );
    expect(created.idempotent).toBe(false);
    const staged = created.issuance as { id: string; status: string; reservationId: string | null };
    expect(staged.status).toBe('CREATED');
    expect(staged.reservationId).toBe(reservation.id);

    const afterCreate = await prisma.bloodComponentUnit.findMany({
      where: { id: { in: units.map((unit) => unit.id) } },
    });
    expect(afterCreate.every((unit) => unit.state === UnitState.RESERVED)).toBe(true);
    expect(
      await prisma.inventoryMovement.count({
        where: { issuanceId: staged.id, movementType: 'ISSUED' },
      }),
    ).toBe(0);

    const confirmed = await issuance.confirm(adminActor(), staged.id, ctx('confirm-happy'));
    expect(confirmed.idempotent).toBe(false);

    const afterConfirm = await prisma.bloodComponentUnit.findMany({
      where: { id: { in: units.map((unit) => unit.id) } },
    });
    expect(afterConfirm.every((unit) => unit.state === UnitState.ISSUED)).toBe(true);

    const movements = await prisma.inventoryMovement.findMany({
      where: { issuanceId: staged.id, movementType: 'ISSUED' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.fromState === UnitState.RESERVED)).toBe(true);
    expect(movements.every((movement) => movement.toState === UnitState.ISSUED)).toBe(true);

    const requestAfter = await prisma.bloodRequest.findUnique({
      where: { id: request.id },
      include: { lines: true },
    });
    expect(requestAfter?.status).toBe(BloodRequestStatus.FULFILLED);
    expect(requestAfter?.fulfilledAt).toBeTruthy();
    expect(requestAfter?.lines[0]?.quantityReserved).toBe(0);
    expect(requestAfter?.lines[0]?.quantityIssued).toBe(2);

    const reservationAfter = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(reservationAfter?.status).toBe(ReservationStatus.CONVERTED_TO_ISSUANCE);
    expect(reservationAfter?.convertedAt).toBeTruthy();

    expect(
      await prisma.auditEvent.count({
        where: { facilityId: facilityAId, action: 'issuance.created', targetId: staged.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { facilityId: facilityAId, action: 'issuance.confirmed', targetId: staged.id },
      }),
    ).toBe(1);
  });

  it('supports partial issuance and keeps counters consistent across multiple issuances', async () => {
    const { request, items } = await reserveNew(2);

    const first = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('partial-1'),
    );
    await issuance.confirm(adminActor(), (first.issuance as { id: string }).id, ctx('partial-1-confirm'));

    const midRequest = await prisma.bloodRequest.findUnique({
      where: { id: request.id },
      include: { lines: true },
    });
    expect(midRequest?.status).toBe(BloodRequestStatus.PARTIALLY_FULFILLED);
    expect(midRequest?.lines[0]?.quantityReserved).toBe(1);
    expect(midRequest?.lines[0]?.quantityIssued).toBe(1);

    const second = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[1]!.id }] },
      ctx('partial-2'),
    );
    await issuance.confirm(adminActor(), (second.issuance as { id: string }).id, ctx('partial-2-confirm'));

    const finalRequest = await prisma.bloodRequest.findUnique({
      where: { id: request.id },
      include: { lines: true },
    });
    expect(finalRequest?.status).toBe(BloodRequestStatus.FULFILLED);
    expect(finalRequest?.lines[0]?.quantityReserved).toBe(0);
    expect(finalRequest?.lines[0]?.quantityIssued).toBe(2);
  });

  it('rejects unreserved, inactive, and unknown reservation items', async () => {
    const { request, reservation, items } = await reserveNew(1);
    await reservations.release(adminActor(), reservation.id, 'test release', ctx('release'));

    await expect(
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }] },
        ctx('inactive'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESERVATION_ITEM_NOT_ACTIVE' }),
    });

    await expect(
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: randomUUID() }] },
        ctx('missing'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESERVATION_ITEM_NOT_FOUND' }),
    });
  });

  it('rejects expired, recalled, quarantined, and discarded units even when a claim exists', async () => {
    const expiredCase = await reserveNew(1);
    await prisma.bloodComponentUnit.update({
      where: { id: expiredCase.units[0]!.id },
      data: { expiresAt: new Date(Date.now() - 86400000) },
    });
    await expect(
      issuance.create(
        adminActor(),
        expiredCase.request.id,
        { items: [{ reservationItemId: expiredCase.items[0]!.id }] },
        ctx('expired'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNIT_NOT_ALLOCATABLE' }),
    });

    for (const state of [UnitState.RECALLED, UnitState.QUARANTINED, UnitState.DISCARDED]) {
      const unsafeCase = await reserveNew(1);
      await prisma.bloodComponentUnit.update({
        where: { id: unsafeCase.units[0]!.id },
        data: { state },
      });
      await expect(
        issuance.create(
          adminActor(),
          unsafeCase.request.id,
          { items: [{ reservationItemId: unsafeCase.items[0]!.id }] },
          ctx(`unsafe-${state}`),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'UNIT_NOT_ALLOCATABLE' }),
      });
      const unit = await prisma.bloodComponentUnit.findUnique({
        where: { id: unsafeCase.units[0]!.id },
      });
      expect(unit?.state).toBe(state);
    }
  });

  it('masks out-of-scope requests and rejects cross-facility reservation/unit tampering', async () => {
    const facilityBRequest = await createRequest(1, { facilityId: facilityBId });
    const unitB = await createUnit(UnitState.AVAILABLE, { facilityId: facilityBId });

    await expect(
      issuance.create(
        facilityActor(),
        facilityBRequest.id,
        { items: [{ reservationItemId: randomUUID() }] },
        ctx('masked'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }),
    });

    const tampered = await reserveNew(1);
    await prisma.bloodComponentUnit.update({
      where: { id: tampered.units[0]!.id },
      data: { facilityId: facilityBId },
    });
    await expect(
      issuance.create(
        adminActor(),
        tampered.request.id,
        { items: [{ reservationItemId: tampered.items[0]!.id }] },
        ctx('tampered-facility'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FACILITY_SCOPE_VIOLATION' }),
    });

    await expect(
      issuance.create(
        noPermissionActor(),
        tampered.request.id,
        { items: [{ reservationItemId: tampered.items[0]!.id }] },
        ctx('no-permission'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }),
    });

    expect(unitB.state).toBe(UnitState.AVAILABLE);
  });

  it('prevents duplicate issuance for the same reservation item', async () => {
    const { request, items } = await reserveNew(2);
    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('dup-1'),
    );

    await expect(
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }] },
        ctx('dup-2'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOUBLE_ISSUANCE' }),
    });

    await issuance.confirm(adminActor(), (created.issuance as { id: string }).id, ctx('dup-confirm'));

    // After confirmation the reservation claim is consumed; re-issuance is refused.
    await expect(
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }] },
        ctx('dup-3'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESERVATION_ITEM_NOT_ACTIVE' }),
    });
  });

  it('never issues more than the requested quantity for a line', async () => {
    const { request, items } = await reserveNew(1);
    const extraUnit = await createUnit(UnitState.RESERVED);
    const extraItem = await prisma.reservationItem.create({
      data: {
        reservationId: items[0]!.reservationId,
        unitId: extraUnit.id,
        requestLineId: items[0]!.requestLineId,
        isActive: true,
      },
    });

    await expect(
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }, { reservationItemId: extraItem.id }] },
        ctx('over-issue'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EXCEEDS_REMAINING' }),
    });
  });

  it('is idempotent for retries and rejects key reuse across requests', async () => {
    const { request, items } = await reserveNew(1);
    const key = `idem-${randomUUID()}`;
    const first = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }], idempotencyKey: key },
      ctx('idem-1'),
    );
    const second = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }], idempotencyKey: key },
      ctx('idem-2'),
    );
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect((second.issuance as { id: string }).id).toBe((first.issuance as { id: string }).id);

    const other = await reserveNew(1);
    await expect(
      issuance.create(
        adminActor(),
        other.request.id,
        { items: [{ reservationItemId: other.items[0]!.id }], idempotencyKey: key },
        ctx('idem-conflict'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
  });

  it('allows only one concurrent issuance for the same reservation item', async () => {
    const { request, items } = await reserveNew(1);

    const [a, b] = await Promise.allSettled([
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }] },
        ctx('race-create-a'),
      ),
      issuance.create(
        adminActor(),
        request.id,
        { items: [{ reservationItemId: items[0]!.id }] },
        ctx('race-create-b'),
      ),
    ]);
    const fulfilled = [a, b].filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(
      await prisma.issuance.count({ where: { requestId: request.id, status: 'CREATED' } }),
    ).toBe(1);
  });

  it('allows only one effective confirmation and one ISSUED movement set', async () => {
    const { request, items } = await reserveNew(1);
    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('race-confirm-create'),
    );
    const id = (created.issuance as { id: string }).id;

    const [a, b] = await Promise.allSettled([
      issuance.confirm(adminActor(), id, ctx('race-confirm-a')),
      issuance.confirm(adminActor(), id, ctx('race-confirm-b')),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    expect(
      await prisma.inventoryMovement.count({ where: { issuanceId: id, movementType: 'ISSUED' } }),
    ).toBe(1);
    expect(await prisma.issuanceItem.count({ where: { issuanceId: id, issuedAt: { not: null } } })).toBe(1);
  });

  it('rolls back the whole confirmation when any unit is no longer eligible', async () => {
    const { request, items, units } = await reserveNew(2);
    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: items.map((item) => ({ reservationItemId: item.id })) },
      ctx('rollback-create'),
    );
    const id = (created.issuance as { id: string }).id;

    await prisma.bloodComponentUnit.update({
      where: { id: units[1]!.id },
      data: { state: UnitState.QUARANTINED },
    });

    await expect(issuance.confirm(adminActor(), id, ctx('rollback-confirm'))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNIT_NOT_ALLOCATABLE' }),
    });

    const after = await prisma.bloodComponentUnit.findMany({
      where: { id: { in: units.map((unit) => unit.id) } },
    });
    expect(after.find((unit) => unit.id === units[0]!.id)?.state).toBe(UnitState.RESERVED);
    expect(after.find((unit) => unit.id === units[1]!.id)?.state).toBe(UnitState.QUARANTINED);
    expect(
      await prisma.inventoryMovement.count({ where: { issuanceId: id, movementType: 'ISSUED' } }),
    ).toBe(0);
    const issuanceAfter = await prisma.issuance.findUnique({ where: { id } });
    expect(issuanceAfter?.status).toBe('CREATED');
  });

  it('cancels only unconfirmed issuances and never returns an issued unit to available', async () => {
    const { request, items, units } = await reserveNew(1);
    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('cancel-create'),
    );
    const id = (created.issuance as { id: string }).id;

    const cancelled = await issuance.cancel(adminActor(), id, 'operator cancelled before dispatch', ctx('cancel'));
    expect(cancelled.idempotent).toBe(false);

    const unitAfterCancel = await prisma.bloodComponentUnit.findUnique({
      where: { id: units[0]!.id },
    });
    expect(unitAfterCancel?.state).toBe(UnitState.RESERVED);
    expect(
      await prisma.inventoryMovement.count({ where: { issuanceId: id, movementType: 'ISSUED' } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { facilityId: facilityAId, action: 'issuance.cancelled', targetId: id },
      }),
    ).toBe(1);

    // Cancelling releases nothing: the same reservation item can be issued again.
    const retry = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('cancel-retry'),
    );
    const retryId = (retry.issuance as { id: string }).id;
    await issuance.confirm(adminActor(), retryId, ctx('cancel-retry-confirm'));

    await expect(issuance.cancel(adminActor(), retryId, 'too late', ctx('cancel-confirmed'))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ISSUANCE_NOT_CANCELLABLE' }),
    });
    const issuedUnit = await prisma.bloodComponentUnit.findUnique({
      where: { id: units[0]!.id },
    });
    expect(issuedUnit?.state).toBe(UnitState.ISSUED);
    expect(
      await prisma.inventoryMovement.count({
        where: { unitId: units[0]!.id, toState: UnitState.AVAILABLE },
      }),
    ).toBe(0);
  });

  it('confirms issuance from a CONFIRMED reservation', async () => {
    const { request, reservation, items } = await reserveNew(1);
    await reservations.confirm(adminActor(), reservation.id, ctx('reservation-confirm'));

    const created = await issuance.create(
      adminActor(),
      request.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('confirmed-reservation'),
    );
    const confirmed = await issuance.confirm(
      adminActor(),
      (created.issuance as { id: string }).id,
      ctx('confirmed-reservation-confirm'),
    );
    expect(confirmed.idempotent).toBe(false);
  });

  it('does not bypass safety for EMERGENCY requests', async () => {
    const emergencyRequest = await createRequest(1, { urgency: RequestUrgency.EMERGENCY });
    const eligibleUnit = await createUnit();
    const reservation = await reserve(
      emergencyRequest.id,
      emergencyRequest.lines[0]!.id,
      [eligibleUnit.id],
    );
    const items = await prisma.reservationItem.findMany({
      where: { reservationId: reservation.id, isActive: true },
    });
    const created = await issuance.create(
      adminActor(),
      emergencyRequest.id,
      { items: [{ reservationItemId: items[0]!.id }] },
      ctx('emergency-happy'),
    );
    await issuance.confirm(adminActor(), (created.issuance as { id: string }).id, ctx('emergency-confirm'));
    const unit = await prisma.bloodComponentUnit.findUnique({ where: { id: eligibleUnit.id } });
    expect(unit?.state).toBe(UnitState.ISSUED);

    const unsafeEmergency = await createRequest(1, { urgency: RequestUrgency.CRITICAL });
    const unsafeUnit = await createUnit();
    const unsafeReservation = await reserve(
      unsafeEmergency.id,
      unsafeEmergency.lines[0]!.id,
      [unsafeUnit.id],
    );
    const unsafeItems = await prisma.reservationItem.findMany({
      where: { reservationId: unsafeReservation.id, isActive: true },
    });
    await prisma.bloodComponentUnit.update({
      where: { id: unsafeUnit.id },
      data: { state: UnitState.RECALLED },
    });
    await expect(
      issuance.create(
        adminActor(),
        unsafeEmergency.id,
        { items: [{ reservationItemId: unsafeItems[0]!.id }] },
        ctx('emergency-unsafe'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNIT_NOT_ALLOCATABLE' }),
    });
  });
});
