import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InventoryMovementService } from './inventory-movement.service';

describe('InventoryMovementService', () => {
  let service: InventoryMovementService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (fn: any) => {
        const tx = {
          bloodComponentUnit: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
          inventoryMovement: { create: vi.fn() },
        };
        return fn(tx);
      }),
    };
    service = new InventoryMovementService(prisma as any);
  });

  it('records a movement and updates unit state atomically', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'u1', state: 'QUARANTINED', facilityId: 'f1' })
          .mockResolvedValueOnce({ id: 'u1', state: 'AVAILABLE', facilityId: 'f1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: {
        create: vi.fn().mockResolvedValue({ id: 'm1', unitId: 'u1', fromState: 'QUARANTINED', toState: 'AVAILABLE' }),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await service.recordMovement({
      unitId: 'u1',
      movementType: 'RELEASED_TO_AVAILABLE' as any,
      toState: 'AVAILABLE' as any,
      actorUserId: 'a1',
    });

    expect(tx.bloodComponentUnit.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(tx.bloodComponentUnit.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', state: 'QUARANTINED' },
      data: { state: 'AVAILABLE' },
    });
    expect(tx.inventoryMovement.create).toHaveBeenCalled();
    expect(result.unit.state).toBe('AVAILABLE');
  });

  it('rejects invalid transition and does not create movement', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', state: 'COLLECTED', facilityId: 'f1' }),
        updateMany: vi.fn(),
      },
      inventoryMovement: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      service.recordMovement({
        unitId: 'u1',
        movementType: 'QUARANTINED' as any,
        toState: 'AVAILABLE' as any,
      }),
    ).rejects.toThrow('INVALID_INVENTORY_UNIT_TRANSITION');

    expect(tx.bloodComponentUnit.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects movement type that contradicts target state', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', state: 'QUARANTINED', facilityId: 'f1' }),
        updateMany: vi.fn(),
      },
      inventoryMovement: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      service.recordMovement({
        unitId: 'u1',
        movementType: 'DISCARDED' as any,
        toState: 'AVAILABLE' as any,
      }),
    ).rejects.toThrow('MOVEMENT_TYPE_STATE_MISMATCH');

    expect(tx.bloodComponentUnit.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale concurrent writes', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', state: 'AVAILABLE', facilityId: 'f1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryMovement: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      service.recordMovement({
        unitId: 'u1',
        movementType: 'RESERVED' as any,
        toState: 'RESERVED' as any,
      }),
    ).rejects.toThrow('INVENTORY_UNIT_STATE_CONFLICT');

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rolls back if movement creation fails (transactional)', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'u1', state: 'AVAILABLE', facilityId: 'f1' })
          .mockResolvedValueOnce({ id: 'u1', state: 'RESERVED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: vi.fn().mockRejectedValue(new Error('DB_ERROR')) },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      service.recordMovement({
        unitId: 'u1',
        movementType: 'RESERVED' as any,
        toState: 'RESERVED' as any,
      }),
    ).rejects.toThrow('DB_ERROR');

    expect(tx.bloodComponentUnit.updateMany).toHaveBeenCalled();
    expect(tx.inventoryMovement.create).toHaveBeenCalled();
  });

  it('preserves movement history by appending only', async () => {
    const tx = {
      bloodComponentUnit: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'u1', state: 'AVAILABLE', facilityId: 'f1' })
          .mockResolvedValueOnce({ id: 'u1', state: 'RESERVED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await service.recordMovement({
      unitId: 'u1',
      movementType: 'RESERVED' as any,
      toState: 'RESERVED' as any,
    });

    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect((tx.inventoryMovement as any).update).toBeUndefined();
    expect((tx.inventoryMovement as any).delete).toBeUndefined();
  });

  it('does not allow transitions from RECALLED', async () => {
    const tx = {
      bloodComponentUnit: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', state: 'RECALLED', facilityId: 'f1' }), updateMany: vi.fn() },
      inventoryMovement: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      service.recordMovement({
        unitId: 'u1',
        movementType: 'RECALLED' as any,
        toState: 'AVAILABLE' as any,
      }),
    ).rejects.toThrow('INVENTORY_UNIT_TERMINAL_STATE');

    expect(tx.bloodComponentUnit.updateMany).not.toHaveBeenCalled();
  });
});
