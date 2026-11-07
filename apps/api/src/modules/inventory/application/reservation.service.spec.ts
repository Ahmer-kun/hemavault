import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnitState } from '@prisma/client';
import { ReservationService } from './reservation.service';

describe('ReservationService', () => {
  let prisma: any;
  let expiryService: any;
  let service: ReservationService;

  beforeEach(() => {
    expiryService = { getEffectiveState: vi.fn().mockReturnValue(UnitState.AVAILABLE) };
    prisma = {
      reservation: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    service = new ReservationService(prisma, expiryService);
  });

  it('returns existing reservation for idempotent retry', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: 'r1', items: [] });
    const result = await service.reserveUnit({
      unitId: 'u1',
      facilityId: 'f1',
      idempotencyKey: 'k1',
    });
    expect((result as any).idempotent).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reservation for expired unit', async () => {
    expiryService.getEffectiveState.mockReturnValue(UnitState.EXPIRED);
    const tx = {
      reservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      reservationItem: { findFirst: vi.fn().mockResolvedValue(null) },
      bloodComponentUnit: { updateMany: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'u1', state: UnitState.AVAILABLE, expiresAt: new Date(Date.now() - 1), facilityId: 'f1' }]),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    await expect(
      service.reserveUnit({ unitId: 'u1', facilityId: 'f1' }),
    ).rejects.toThrow('UNIT_NOT_AVAILABLE');
  });

  it('rejects when unit already has active reservation', async () => {
    const tx = {
      reservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      reservationItem: { findFirst: vi.fn().mockResolvedValue({ id: 'ri1' }) },
      bloodComponentUnit: { updateMany: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'u1', state: UnitState.AVAILABLE, expiresAt: new Date(Date.now() + 86400000), facilityId: 'f1' }]),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    await expect(
      service.reserveUnit({ unitId: 'u1', facilityId: 'f1' }),
    ).rejects.toThrow('UNIT_ALREADY_RESERVED');
  });
});
