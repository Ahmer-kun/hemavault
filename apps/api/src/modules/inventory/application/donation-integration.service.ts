import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DonationState, Prisma, UnitState } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { InventoryMovementService } from './inventory-movement.service';

/**
 * Integrates donation release with inventory creation per ADR-015.
 *
 * A released donation produces component units in QUARANTINED. A separate,
 * explicitly authorized action is required to transition them to AVAILABLE.
 */
@Injectable()
export class DonationIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: InventoryMovementService,
  ) {}

  async createUnitsForReleasedDonation(
    donationId: string,
    actorUserId?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const donation = await client.donation.findUnique({ where: { id: donationId } });
    if (!donation) {
      throw new Error('DONATION_NOT_FOUND');
    }
    if (donation.state !== DonationState.RELEASED) {
      throw new Error('DONATION_NOT_RELEASED');
    }
    if (!donation.bloodGroup) {
      throw new Error('DONATION_BLOOD_GROUP_REQUIRED');
    }

    // Idempotent: a released donation yields at most one component unit for this
    // conservative slice (multi-component split is a separate, policy-driven step).
    const existing = await client.bloodComponentUnit.findFirst({ where: { donationId } });
    if (existing) {
      return existing;
    }

    const componentType = await client.componentType.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    if (!componentType) {
      throw new Error('COMPONENT_TYPE_REQUIRED');
    }

    const collectionAt = donation.collectedAt ?? donation.scheduledFor;
    const shelfLifeDays = componentType.shelfLifeDays ?? 35;
    const expiresAt = new Date(collectionAt.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);

    // Create in COLLECTED then transition to QUARANTINED via the movement service
    // (state machine requires COLLECTED -> QUARANTINED; same-state transitions are invalid).
    const unit = await client.bloodComponentUnit.create({
      data: {
        publicCode: `UNIT-${randomBytes(6).toString('hex').toUpperCase()}`,
        donationId: donation.id,
        componentTypeId: componentType.id,
        facilityId: donation.facilityId,
        bloodGroup: donation.bloodGroup,
        state: UnitState.COLLECTED,
        volumeMl: donation.volumeMl,
        collectionAt,
        expiresAt,
      },
    });

    await this.movementService.recordMovement(
      {
        unitId: unit.id,
        movementType: 'CREATED',
        toState: UnitState.QUARANTINED,
        actorUserId: actorUserId ?? undefined,
        facilityId: unit.facilityId,
      },
      tx,
    );

    return unit;
  }

  async releaseUnitToAvailable(unitId: string, actorUserId?: string | null) {
    return this.movementService.recordMovement({
      unitId,
      movementType: 'RELEASED_TO_AVAILABLE',
      toState: UnitState.AVAILABLE,
      actorUserId: actorUserId ?? undefined,
      unitUpdate: { releasedAt: new Date() },
    });
  }
}
