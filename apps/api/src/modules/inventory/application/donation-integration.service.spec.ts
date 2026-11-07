import { describe, expect, it, vi } from 'vitest';
import { DonationState, UnitState } from '@prisma/client';
import { DonationIntegrationService } from './donation-integration.service';

describe('DonationIntegrationService', () => {
  it('is idempotent when unit already exists for donation', async () => {
    const prisma: any = {
      donation: { findUnique: vi.fn().mockResolvedValue({ id: 'd1', state: DonationState.RELEASED, bloodGroup: 'O_POSITIVE', facilityId: 'f1' }) },
      bloodComponentUnit: { findFirst: vi.fn().mockResolvedValue({ id: 'u1' }) },
      componentType: { findFirst: vi.fn() },
    };
    const movement = { recordMovement: vi.fn() };
    const svc = new DonationIntegrationService(prisma, movement as any);
    const result = await svc.createUnitsForReleasedDonation('d1');
    expect(result).toEqual({ id: 'u1' });
    expect(movement.recordMovement).not.toHaveBeenCalled();
  });

  it('rejects if donation is not released', async () => {
    const prisma: any = {
      donation: { findUnique: vi.fn().mockResolvedValue({ id: 'd1', state: DonationState.QUARANTINED, bloodGroup: 'O_POSITIVE' }) },
    };
    const svc = new DonationIntegrationService(prisma, { recordMovement: vi.fn() } as any);
    await expect(svc.createUnitsForReleasedDonation('d1')).rejects.toThrow('DONATION_NOT_RELEASED');
  });

  it('releases unit to AVAILABLE via separate action (ADR-015)', async () => {
    const movement = { recordMovement: vi.fn().mockResolvedValue({ ok: true }) };
    const svc = new DonationIntegrationService({} as any, movement as any);
    await svc.releaseUnitToAvailable('u1', 'actor1');
    expect(movement.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'u1', toState: UnitState.AVAILABLE, movementType: 'RELEASED_TO_AVAILABLE' }),
    );
  });
});
