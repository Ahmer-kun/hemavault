import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { PrismaClient, UnitState, OrganizationStatus, FacilityStatus, FacilityType, ComponentCategory } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReservationService } from '../src/modules/inventory/application/reservation.service';
import { ExpiryService } from '../src/modules/inventory/application/expiry.service';
import { InventoryMovementService } from '../src/modules/inventory/application/inventory-movement.service';

/**
 * Genuine PostgreSQL integration/concurrency tests for Phase 4 inventory invariants.
 *
 * Safety: requires TEST_DATABASE_URL pointing to an ISOLATED local/test PostgreSQL.
 * Never run against production or shared Supabase. The suite is skipped when
 * TEST_DATABASE_URL is not set.
 *
 * Example (isolated local Postgres):
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hemavault_test npx vitest run test/inventory-concurrency.e2e-spec.ts --config vitest.config.ts
 *
 * Note: globalSetup seeds access control/component types using DATABASE_URL. For a
 * fully isolated run, point DATABASE_URL and the test client at the same isolated DB
 * and ensure migrations have been applied (`prisma migrate deploy`).
 */
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const looksUnsafe = !TEST_DB_URL || /supabase\.co|supabase\.com/i.test(TEST_DB_URL);
const canRun = !!TEST_DB_URL && !looksUnsafe;

const describeIf = canRun ? describe : describe.skip;

describeIf('Inventory concurrency/invariants (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let reservationService: ReservationService;
  let movementService: InventoryMovementService;
  const fixtures: { orgId: string; facilityA: string; facilityB: string; componentTypeId: string; donorId: string; userId: string } = {
    orgId: '', facilityA: '', facilityB: '', componentTypeId: '', donorId: '', userId: '',
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    movementService = new InventoryMovementService(prisma as any);
    reservationService = new ReservationService(prisma as any, new ExpiryService(prisma as any, movementService));

    // Minimal fixture graph (idempotent-ish via unique codes/ids).
    const org = await prisma.organization.create({
      data: { name: 'Inv Test Org', code: `ITORG-${randomUUID().slice(0, 8)}`, status: OrganizationStatus.ACTIVE },
    });
    fixtures.orgId = org.id;
    const facA = await prisma.facility.create({
      data: { organizationId: org.id, code: `ITFA-${randomUUID().slice(0, 8)}`, name: 'Facility A', type: FacilityType.HOSPITAL, status: FacilityStatus.ACTIVE },
    });
    const facB = await prisma.facility.create({
      data: { organizationId: org.id, code: `ITFB-${randomUUID().slice(0, 8)}`, name: 'Facility B', type: FacilityType.BLOOD_BANK, status: FacilityStatus.ACTIVE },
    });
    fixtures.facilityA = facA.id;
    fixtures.facilityB = facB.id;

    let ct = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!ct) {
      ct = await prisma.componentType.create({
        data: { code: `WB-${randomUUID().slice(0, 6)}`, name: 'Whole Blood', category: ComponentCategory.WHOLE_BLOOD, shelfLifeDays: 35, isActive: true },
      });
    }
    fixtures.componentTypeId = ct.id;

    // Donor profile + donation required by BloodComponentUnit (DonorProfile requires userId + name).
    const user = await prisma.user.create({
      data: {
        email: `invtest-donor-${randomUUID()}@test.local`,
        passwordHash: 'not-used-in-inventory-tests',
        status: 'ACTIVE' as any,
        emailVerifiedAt: new Date(),
        name: 'Inventory Test Donor User',
      } as any,
    });
    fixtures.userId = user.id;
    const donor = await prisma.donorProfile.create({
      data: {
        publicCode: `DNR-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId: user.id,
        name: 'Test Donor',
      },
    });
    fixtures.donorId = donor.id;
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    // Best-effort cleanup of fixtures we created (children first where practical).
    try {
      await prisma.inventoryMovement.deleteMany({ where: { facilityId: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } });
      await prisma.reservationItem.deleteMany({ where: { reservation: { facilityId: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } } });
      await prisma.reservation.deleteMany({ where: { facilityId: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } });
      await prisma.bloodComponentUnit.deleteMany({ where: { facilityId: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } });
      await prisma.donation.deleteMany({ where: { facilityId: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } });
      await prisma.donorProfile.deleteMany({ where: { id: fixtures.donorId || undefined } });
      await prisma.user.deleteMany({ where: { id: fixtures.userId || undefined } });
      await prisma.facility.deleteMany({ where: { id: { in: [fixtures.facilityA, fixtures.facilityB].filter(Boolean) } } });
      await prisma.organization.deleteMany({ where: { id: fixtures.orgId || undefined } });
    } catch {
      // ignore cleanup failures in isolated test DB
    }
    await prisma.$disconnect();
  });

  async function createAvailableUnit(facilityId = fixtures.facilityA, expiresAt?: Date) {
    const donation = await prisma.donation.create({
      data: {
        publicCode: `DON-${randomUUID().slice(0, 8).toUpperCase()}`,
        donorProfileId: fixtures.donorId,
        facilityId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: 'O_POS' as any,
      } as any,
    });
    return prisma.bloodComponentUnit.create({
      data: {
        publicCode: `UNIT-${randomUUID().slice(0, 10).toUpperCase()}`,
        donationId: donation.id,
        componentTypeId: fixtures.componentTypeId,
        facilityId,
        bloodGroup: 'O_POS' as any,
        state: 'AVAILABLE' as any,
        collectionAt: new Date(),
        expiresAt: expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  it('two simultaneous reservation attempts against the same unit: exactly one winner', async () => {
    const unit = await createAvailableUnit();
    const [a, b] = await Promise.allSettled([
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA }),
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
    const updated = await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    expect(updated?.state).toBe(UnitState.RESERVED);
  }, 20000);

  it('same idempotency key retried returns consistent result (no duplicate claims)', async () => {
    const unit = await createAvailableUnit();
    const key = `idem-${randomUUID()}`;
    const r1 = await reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA, idempotencyKey: key });
    const r2 = await reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA, idempotencyKey: key });
    const r3 = await reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA, idempotencyKey: key });
    expect((r1 as any).reservation?.id || (r1 as any).id).toBeTruthy();
    expect((r2 as any).reservation?.id || (r2 as any).id).toBe((r1 as any).reservation?.id || (r1 as any).id);
    expect((r3 as any).reservation?.id || (r3 as any).id).toBe((r1 as any).reservation?.id || (r1 as any).id);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
  });

  it('different idempotency keys cannot both claim the same unit', async () => {
    const unit = await createAvailableUnit();
    const [a, b] = await Promise.allSettled([
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA, idempotencyKey: `k-${randomUUID()}` }),
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA, idempotencyKey: `k-${randomUUID()}` }),
    ]);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([a, b].filter((r) => r.status === 'rejected')).toHaveLength(1);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
  }, 20000);

  it('expired units are rejected for reservation', async () => {
    const unit = await createAvailableUnit(fixtures.facilityA, new Date(Date.now() - 60_000));
    await expect(
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA }),
    ).rejects.toThrow(/UNIT_NOT_AVAILABLE|EXPIRED/i);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(0);
  });

  it('partial unique index rejects duplicate active claims (DB-level)', async () => {
    const unit = await createAvailableUnit();
    const res = await prisma.reservation.create({
      data: { facilityId: fixtures.facilityA, status: 'ACTIVE' as any },
    });
    await prisma.reservationItem.create({ data: { reservationId: res.id, unitId: unit.id, isActive: true } });
    await expect(
      prisma.reservationItem.create({ data: { reservationId: res.id, unitId: unit.id, isActive: true } }),
    ).rejects.toThrow();
    const inactiveOk = await prisma.reservationItem.create({
      data: { reservationId: res.id, unitId: unit.id, isActive: false, releasedAt: new Date() },
    });
    expect(inactiveOk.id).toBeTruthy();
  });

  it('facility isolation: wrong-facility reservation attempt is rejected', async () => {
    const unit = await createAvailableUnit(fixtures.facilityA);
    await expect(
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityB }),
    ).rejects.toThrow(/FACILITY_SCOPE_VIOLATION|NOT_FOUND|UNIT_NOT_AVAILABLE/i);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(0);
  });

  it('no duplicate active claims across many attempts (invariant)', async () => {
    const unit = await createAvailableUnit();
    const attempts = Array.from({ length: 8 }, () =>
      reservationService.reserveUnit({ unitId: unit.id, facilityId: fixtures.facilityA }).catch((e) => e),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => !(r instanceof Error) && r);
    expect(successes.length).toBe(1);
    const activeClaims = await prisma.reservationItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(activeClaims).toBe(1);
  }, 30000);

  it('movement/state change atomicity: failed tx leaves unit state unchanged (DB-level)', async () => {
    const unit = await createAvailableUnit();
    const before = await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.bloodComponentUnit.update({ where: { id: unit.id }, data: { state: UnitState.RESERVED } });
        await tx.inventoryMovement.create({
          data: {
            unitId: unit.id,
            facilityId: fixtures.facilityA,
            movementType: 'RESERVED',
            fromState: UnitState.AVAILABLE,
            toState: UnitState.RESERVED,
          },
        });
        throw new Error('FORCE_ROLLBACK');
      }),
    ).rejects.toThrow('FORCE_ROLLBACK');
    const after = await prisma.bloodComponentUnit.findUnique({ where: { id: unit.id } });
    expect(after?.state).toBe(before?.state);
    const moves = await prisma.inventoryMovement.count({ where: { unitId: unit.id } });
    expect(moves).toBe(0);
  });
});

if (!canRun) {
  describe('Inventory concurrency/invariants (PostgreSQL)', () => {
    it.skip('requires TEST_DATABASE_URL pointing to an isolated PostgreSQL (never production/Supabase)', () => {});
  });
}
