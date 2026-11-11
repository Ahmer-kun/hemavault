import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
  FacilityStatus,
  FacilityType,
  InventoryMovementType,
  NotificationType,
  OrganizationStatus,
  PrismaClient,
  TransferStatus,
  UnitState,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service';
import { InventoryMovementService } from '../src/modules/inventory/application/inventory-movement.service';
import { ExpiryService } from '../src/modules/inventory/application/expiry.service';
import { NotificationDeliveryService } from '../src/modules/notifications/application/notification-delivery.service';
import { NotificationEventsService } from '../src/modules/notifications/application/notification-events.service';
import { NotificationService } from '../src/modules/notifications/application/notification.service';
import { TransferService } from '../src/modules/transfers/application/transfer.service';

/**
 * Genuine PostgreSQL integration tests for Phase 6 inter-facility transfers.
 * Requires TEST_DATABASE_URL pointing at an ISOLATED local/test PostgreSQL.
 * Never run against production or shared Supabase. Skipped when unset.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIf = TEST_URL ? describe : describe.skip;

function assertSafeTestDatabase(url: string): void {
  const lower = url.toLowerCase();
  if (
    lower.includes('supabase') ||
    lower.includes('pooler.supabase') ||
    lower.includes('.supabase.co')
  ) {
    throw new Error('Refusing to run transfer tests against a Supabase/shared database URL.');
  }
  if (!/localhost|127\.0\.0\.1|::1/.test(lower)) {
    throw new Error('Refusing to run transfer tests against a non-local database host.');
  }
}

describeIf('Inter-facility transfers (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let transfers: TransferService;
  let notifications: NotificationService;

  let orgId = '';
  let otherOrgId = '';
  let facilityAId = '';
  let facilityBId = '';
  let facilityCId = '';
  let componentTypeId = '';
  let donationAId = '';
  let donationBId = '';
  let donorProfileId = '';

  const userIds: string[] = [];
  const creator = { id: '' };
  const approver = { id: '' };
  const destinationUser = { id: '' };
  const outsider = { id: '' };

  function actor(
    userId: string,
    facilityPermissions: Array<[string, string[]]>,
    globalPermissions: string[] = [],
  ) {
    return {
      userId,
      sessionId: `transfer-${userId.slice(0, 8)}`,
      globalPermissions: new Set(globalPermissions),
      facilityPermissions: new Map<string, ReadonlySet<string>>(
        facilityPermissions.map(([facilityId, permissions]) => [facilityId, new Set(permissions)]),
      ),
    };
  }

  const sourceActor = () =>
    actor(creator.id, [
      [
        facilityAId,
        [
          'transfer.create',
          'transfer.read',
          'transfer.approve',
          'transfer.pack',
          'transfer.dispatch',
          'transfer.cancel',
        ],
      ],
    ]);
  const destinationActor = () =>
    actor(destinationUser.id, [[facilityBId, ['transfer.read', 'transfer.receive']]]);
  const outsiderActor = () => actor(outsider.id, [[facilityCId, ['transfer.read']]]);

  function ctx(label: string) {
    return { requestId: `transfer-test-${label}`, ipAddress: '127.0.0.1', userAgent: 'vitest' };
  }

  async function createUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `transfer-${label}-${randomUUID()}@test.local`,
        passwordHash: 'not-used',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      } as never,
    });
    userIds.push(user.id);
    return user.id;
  }

  async function addManager(facilityId: string, userId: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { code: 'FACILITY_MANAGER' } });
    if (!role) throw new Error('FACILITY_MANAGER role not seeded');
    await prisma.facilityMembership.create({
      data: { facilityId, userId, roleId: role.id, status: 'ACTIVE' },
    });
  }

  async function createUnit(
    state: UnitState = UnitState.AVAILABLE,
    options: { facilityId?: string; expiresAt?: Date; label?: string } = {},
  ) {
    const facilityId = options.facilityId ?? facilityAId;
    const donationId = facilityId === facilityAId ? donationAId : donationBId;
    return prisma.bloodComponentUnit.create({
      data: {
        publicCode: `TUN-${options.label ?? randomUUID().slice(0, 8)}`.toUpperCase(),
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

  async function createTransfer(
    unitIds: string[],
    options: { idempotencyKey?: string; notes?: string } = {},
  ) {
    return transfers.create(
      sourceActor(),
      {
        sourceFacilityId: facilityAId,
        destinationFacilityId: facilityBId,
        unitIds,
        notes: options.notes ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
      },
      ctx('create'),
    );
  }

  async function advanceToInTransit(unitIds: string[]) {
    const created = await createTransfer(unitIds);
    await transfers.approve(sourceActor(), created.transfer.id, ctx('approve'));
    await transfers.pack(sourceActor(), created.transfer.id, ctx('pack'));
    await transfers.dispatch(sourceActor(), created.transfer.id, ctx('dispatch'));
    return created.transfer;
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    assertSafeTestDatabase(TEST_URL);
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    const movementService = new InventoryMovementService(prisma);
    const expiryService = new ExpiryService(prisma, movementService);
    const audit = new AuditService(prisma);
    const events = new NotificationEventsService();
    const delivery = new NotificationDeliveryService(prisma);
    notifications = new NotificationService(prisma, audit, events, delivery);
    transfers = new TransferService(prisma, expiryService, movementService, audit, notifications);

    const org = await prisma.organization.create({
      data: {
        code: `TRF${Date.now()}`.slice(0, 12).toUpperCase(),
        name: 'Transfer Test Org',
        status: OrganizationStatus.ACTIVE,
      },
    });
    orgId = org.id;
    const otherOrg = await prisma.organization.create({
      data: {
        code: `TRO${Date.now()}`.slice(0, 12).toUpperCase(),
        name: 'Transfer Other Org',
        status: OrganizationStatus.ACTIVE,
      },
    });
    otherOrgId = otherOrg.id;

    const facilityA = await prisma.facility.create({
      data: {
        organizationId: org.id,
        code: `TRFA${Date.now()}`.slice(0, 12).toUpperCase(),
        name: 'Transfer Facility A',
        type: FacilityType.BLOOD_BANK,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityAId = facilityA.id;
    const facilityB = await prisma.facility.create({
      data: {
        organizationId: org.id,
        code: `TRFB${Date.now()}`.slice(0, 12).toUpperCase(),
        name: 'Transfer Facility B',
        type: FacilityType.HOSPITAL,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityBId = facilityB.id;
    const facilityC = await prisma.facility.create({
      data: {
        organizationId: otherOrg.id,
        code: `TRFC${Date.now()}`.slice(0, 12).toUpperCase(),
        name: 'Transfer Facility C',
        type: FacilityType.HOSPITAL,
        status: FacilityStatus.ACTIVE,
      },
    });
    facilityCId = facilityC.id;

    creator.id = await createUser('creator');
    approver.id = await createUser('approver');
    destinationUser.id = await createUser('destination');
    outsider.id = await createUser('outsider');
    await addManager(facilityAId, creator.id);
    await addManager(facilityAId, approver.id);
    await addManager(facilityBId, destinationUser.id);

    const componentType = await prisma.componentType.findFirst({ where: { isActive: true } });
    if (!componentType) throw new Error('No active component type seeded');
    componentTypeId = componentType.id;

    const donorUser = await createUser('donor');
    const donor = await prisma.donorProfile.create({
      data: {
        publicCode: `TDN-${randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Transfer Donor',
        userId: donorUser,
      },
    });
    donorProfileId = donor.id;

    const donationA = await prisma.donation.create({
      data: {
        publicCode: `TDA-${randomUUID().slice(0, 8)}`.toUpperCase(),
        donorProfileId: donor.id,
        facilityId: facilityAId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: 'A_POS',
      } as never,
    });
    donationAId = donationA.id;
    const donationB = await prisma.donation.create({
      data: {
        publicCode: `TDB-${randomUUID().slice(0, 8)}`.toUpperCase(),
        donorProfileId: donor.id,
        facilityId: facilityBId,
        state: 'RELEASED',
        scheduledFor: new Date(),
        collectedAt: new Date(),
        bloodGroup: 'A_POS',
      } as never,
    });
    donationBId = donationB.id;
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    const facilityIds = [facilityAId, facilityBId, facilityCId].filter(Boolean);
    const userIdList = userIds.filter(Boolean);
    try {
      await prisma.notificationDelivery.deleteMany({
        where: { notification: { userId: { in: userIdList } } },
      });
      await prisma.notification.deleteMany({ where: { userId: { in: userIdList } } });
      await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIdList } } });
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: userIdList } },
            { facilityId: { in: facilityIds } },
            { organizationId: { in: [orgId, otherOrgId].filter(Boolean) } },
          ],
        },
      });
      await prisma.inventoryMovement.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.transferItem.deleteMany({
        where: { transfer: { sourceFacilityId: { in: facilityIds } } },
      });
      await prisma.transfer.deleteMany({ where: { sourceFacilityId: { in: facilityIds } } });
      await prisma.bloodComponentUnit.deleteMany({ where: { facilityId: { in: facilityIds } } });
      await prisma.donation.deleteMany({
        where: { id: { in: [donationAId, donationBId].filter(Boolean) } },
      });
      if (donorProfileId) await prisma.donorProfile.deleteMany({ where: { id: donorProfileId } });
      await prisma.facilityMembership.deleteMany({ where: { userId: { in: userIdList } } });
      await prisma.user.deleteMany({ where: { id: { in: userIdList } } });
      await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgId, otherOrgId].filter(Boolean) } },
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  it('runs the full lifecycle, moves the unit to the destination, and writes movements/audit/notifications', async () => {
    const unit = await createUnit();
    const created = await createTransfer([unit.id], { idempotencyKey: `lifecycle-${unit.id}` });
    expect(created.idempotent).toBe(false);
    expect(created.transfer.status).toBe(TransferStatus.REQUESTED);
    expect(created.transfer.items).toHaveLength(1);

    const claimed = await prisma.bloodComponentUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(claimed.state).toBe(UnitState.TRANSFER_PENDING);
    expect(claimed.facilityId).toBe(facilityAId);

    const requestedNotification = await prisma.notification.findFirst({
      where: { userId: approver.id, dedupeKey: `transfer:${created.transfer.id}:requested` },
    });
    expect(requestedNotification?.type).toBe(NotificationType.TRANSFER_REQUESTED);
    expect(requestedNotification?.priority).toBe('HIGH');
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notificationId: requestedNotification!.id },
    });
    expect(deliveries).toHaveLength(3);
    expect(deliveries.find((delivery) => delivery.channel === 'IN_APP')?.status).toBe('DELIVERED');
    expect(deliveries.find((delivery) => delivery.channel === 'EMAIL')?.status).toBe('SKIPPED');
    expect(deliveries.find((delivery) => delivery.channel === 'SMS')?.status).toBe('SKIPPED');

    await transfers.approve(sourceActor(), created.transfer.id, ctx('approve'));
    await transfers.pack(sourceActor(), created.transfer.id, ctx('pack'));
    const dispatched = await transfers.dispatch(
      sourceActor(),
      created.transfer.id,
      ctx('dispatch'),
    );
    expect(dispatched.transfer.status).toBe(TransferStatus.IN_TRANSIT);
    const inTransitUnit = await prisma.bloodComponentUnit.findUniqueOrThrow({
      where: { id: unit.id },
    });
    expect(inTransitUnit.state).toBe(UnitState.IN_TRANSIT);

    const received = await transfers.receive(
      destinationActor(),
      created.transfer.id,
      ctx('receive'),
    );
    expect(received.transfer.status).toBe(TransferStatus.RECEIVED);
    const receivedUnit = await prisma.bloodComponentUnit.findUniqueOrThrow({
      where: { id: unit.id },
    });
    expect(receivedUnit.state).toBe(UnitState.RECEIVED);
    expect(receivedUnit.facilityId).toBe(facilityBId);

    const movementTypes = (
      await prisma.inventoryMovement.findMany({
        where: { transferId: created.transfer.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((movement) => movement.movementType);
    expect(movementTypes).toContain(InventoryMovementType.STATE_CHANGE);
    expect(movementTypes).toContain(InventoryMovementType.DISPATCHED);
    expect(movementTypes).toContain(InventoryMovementType.RECEIVED);

    const actions = (
      await prisma.auditEvent.findMany({
        where: { targetType: 'Transfer', targetId: created.transfer.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((event) => event.action);
    expect(actions).toEqual([
      'transfer.created',
      'transfer.approved',
      'transfer.packed',
      'transfer.dispatched',
      'transfer.received',
    ]);

    const idempotent = await transfers.receive(
      destinationActor(),
      created.transfer.id,
      ctx('receive-again'),
    );
    expect(idempotent.idempotent).toBe(true);
  });

  it('cancels before dispatch and returns units to available inventory', async () => {
    const unit = await createUnit();
    const created = await createTransfer([unit.id]);
    const cancelled = await transfers.cancel(
      sourceActor(),
      created.transfer.id,
      'no longer needed',
      ctx('cancel'),
    );
    expect(cancelled.transfer.status).toBe(TransferStatus.CANCELLED);
    expect(cancelled.transfer.cancellationReason).toBe('no longer needed');

    const after = await prisma.bloodComponentUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(after.state).toBe(UnitState.AVAILABLE);
    expect(after.facilityId).toBe(facilityAId);
    const activeItems = await prisma.transferItem.count({
      where: { transferId: created.transfer.id, isActive: true },
    });
    expect(activeItems).toBe(0);

    await expect(
      transfers.approve(sourceActor(), created.transfer.id, ctx('approve-after-cancel')),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a requested transfer with a reason and releases the claim', async () => {
    const unit = await createUnit();
    const created = await createTransfer([unit.id]);
    await expect(
      transfers.reject(sourceActor(), created.transfer.id, null, ctx('reject-no-reason')),
    ).rejects.toMatchObject({ status: 400 });

    const rejected = await transfers.reject(
      sourceActor(),
      created.transfer.id,
      'insufficient stock',
      ctx('reject'),
    );
    expect(rejected.transfer.status).toBe(TransferStatus.REJECTED);
    const after = await prisma.bloodComponentUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(after.state).toBe(UnitState.AVAILABLE);
  });

  it('prevents cancellation after dispatch and requires destination authority for receipt', async () => {
    const unit = await createUnit();
    const created = await advanceToInTransit([unit.id]);
    await expect(
      transfers.cancel(sourceActor(), created.id, 'late cancel', ctx('late-cancel')),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      transfers.receive(sourceActor(), created.id, ctx('wrong-receiver')),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects ineligible units without partial claims (transactional rollback)', async () => {
    const valid = await createUnit(UnitState.AVAILABLE, {
      label: `ok-${randomUUID().slice(0, 4)}`,
    });
    const quarantined = await createUnit(UnitState.QUARANTINED, {
      label: `q-${randomUUID().slice(0, 4)}`,
    });
    const notes = `rollback-${randomUUID()}`;
    await expect(createTransfer([valid.id, quarantined.id], { notes })).rejects.toMatchObject({
      status: 409,
    });

    const transferCount = await prisma.transfer.count({ where: { notes } });
    expect(transferCount).toBe(0);
    const validAfter = await prisma.bloodComponentUnit.findUniqueOrThrow({
      where: { id: valid.id },
    });
    expect(validAfter.state).toBe(UnitState.AVAILABLE);
    const movements = await prisma.inventoryMovement.count({ where: { unitId: valid.id } });
    expect(movements).toBe(0);

    const cases: Array<[UnitState, string]> = [
      [UnitState.RESERVED, 'STATE_NOT_AVAILABLE'],
      [UnitState.RECALLED, 'STATE_NOT_AVAILABLE'],
      [UnitState.DISCARDED, 'STATE_NOT_AVAILABLE'],
      [UnitState.ISSUED, 'STATE_NOT_AVAILABLE'],
      [UnitState.IN_TRANSIT, 'STATE_NOT_AVAILABLE'],
    ];
    for (const [state] of cases) {
      const unit = await createUnit(state, { label: `${state}-${randomUUID().slice(0, 4)}` });
      await expect(createTransfer([unit.id])).rejects.toMatchObject({ status: 409 });
    }

    const expired = await createUnit(UnitState.AVAILABLE, {
      label: `expired-${randomUUID().slice(0, 4)}`,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(createTransfer([expired.id])).rejects.toMatchObject({ status: 409 });
  });

  it('rejects units from another source facility and cross-organization destinations', async () => {
    const unitAtB = await createUnit(UnitState.AVAILABLE, { facilityId: facilityBId });
    await expect(
      transfers.create(
        sourceActor(),
        {
          sourceFacilityId: facilityAId,
          destinationFacilityId: facilityBId,
          unitIds: [unitAtB.id],
        },
        ctx('wrong-facility'),
      ),
    ).rejects.toMatchObject({ status: 409 });

    const unit = await createUnit();
    await expect(
      transfers.create(
        sourceActor(),
        {
          sourceFacilityId: facilityAId,
          destinationFacilityId: facilityCId,
          unitIds: [unit.id],
        },
        ctx('cross-org'),
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      transfers.create(
        sourceActor(),
        {
          sourceFacilityId: facilityAId,
          destinationFacilityId: facilityAId,
          unitIds: [unit.id],
        },
        ctx('same-facility'),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('claims a unit at most once under concurrent transfer requests', async () => {
    const unit = await createUnit(UnitState.AVAILABLE, {
      label: `race-${randomUUID().slice(0, 6)}`,
    });
    const results = await Promise.allSettled([
      createTransfer([unit.id]),
      createTransfer([unit.id]),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const active = await prisma.transferItem.count({ where: { unitId: unit.id, isActive: true } });
    expect(active).toBe(1);
    const after = await prisma.bloodComponentUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(after.state).toBe(UnitState.TRANSFER_PENDING);
  });

  it('supports facility-scoped idempotency and detects conflicting reuse', async () => {
    const unit = await createUnit();
    const key = `idem-${randomUUID()}`;
    const first = await createTransfer([unit.id], { idempotencyKey: key });
    const second = await createTransfer([unit.id], { idempotencyKey: key });
    expect(second.idempotent).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(
      await prisma.transfer.count({
        where: { sourceFacilityId: facilityAId, idempotencyKey: key },
      }),
    ).toBe(1);

    const otherUnit = await createUnit();
    await expect(createTransfer([otherUnit.id], { idempotencyKey: key })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('enforces source/destination scope, masking out-of-scope transfers as not found', async () => {
    const unit = await createUnit();
    const created = await createTransfer([unit.id]);

    await expect(transfers.getById(outsiderActor(), created.transfer.id)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      transfers.create(
        destinationActor(),
        {
          sourceFacilityId: facilityAId,
          destinationFacilityId: facilityBId,
          unitIds: [unit.id],
        },
        ctx('no-source-permission'),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const sourceList = await transfers.list(sourceActor(), {});
    expect(sourceList.items.some((item) => item.id === created.transfer.id)).toBe(true);
    const outsiderList = await transfers.list(outsiderActor(), {});
    expect(outsiderList.items.some((item) => item.id === created.transfer.id)).toBe(false);

    const destinationView = await transfers.getById(destinationActor(), created.transfer.id);
    expect(destinationView.id).toBe(created.transfer.id);
  });

  it('rejects duplicate units and oversized transfers with structured errors', async () => {
    const unit = await createUnit();
    await expect(createTransfer([unit.id, unit.id])).rejects.toMatchObject({ status: 400 });

    const tooManyUnitIds = Array.from({ length: 51 }, () => randomUUID());
    await expect(
      transfers.create(
        sourceActor(),
        {
          sourceFacilityId: facilityAId,
          destinationFacilityId: facilityBId,
          unitIds: tooManyUnitIds,
        },
        ctx('too-many'),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
