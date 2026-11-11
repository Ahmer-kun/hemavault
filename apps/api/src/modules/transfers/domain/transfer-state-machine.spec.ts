import { describe, expect, it } from 'vitest';
import { TransferStatus } from '@prisma/client';
import {
  assertValidTransferTransition,
  canCancelTransfer,
  canReceiveTransfer,
  canTransitionTransfer,
  getTransferAllowedTransitions,
  isTerminalTransferStatus,
} from './transfer-state-machine';

describe('transfer state machine', () => {
  it('allows the documented forward lifecycle', () => {
    expect(canTransitionTransfer(TransferStatus.REQUESTED, TransferStatus.APPROVED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.APPROVED, TransferStatus.PACKED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.PACKED, TransferStatus.DISPATCHED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.DISPATCHED, TransferStatus.IN_TRANSIT)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.IN_TRANSIT, TransferStatus.RECEIVED)).toBe(true);
  });

  it('allows rejection/cancellation only before dispatch', () => {
    expect(canTransitionTransfer(TransferStatus.REQUESTED, TransferStatus.REJECTED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.REQUESTED, TransferStatus.CANCELLED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.APPROVED, TransferStatus.CANCELLED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.PACKED, TransferStatus.CANCELLED)).toBe(true);
    expect(canTransitionTransfer(TransferStatus.DISPATCHED, TransferStatus.CANCELLED)).toBe(false);
    expect(canTransitionTransfer(TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED)).toBe(false);
    expect(canTransitionTransfer(TransferStatus.IN_TRANSIT, TransferStatus.APPROVED)).toBe(false);
  });

  it('never transitions out of terminal states', () => {
    for (const terminal of [
      TransferStatus.RECEIVED,
      TransferStatus.REJECTED,
      TransferStatus.CANCELLED,
    ]) {
      expect(isTerminalTransferStatus(terminal)).toBe(true);
      expect(getTransferAllowedTransitions(terminal)).toEqual([]);
      for (const target of Object.values(TransferStatus)) {
        expect(canTransitionTransfer(terminal, target)).toBe(false);
      }
      expect(() => assertValidTransferTransition(terminal, TransferStatus.APPROVED)).toThrow(
        'TRANSFER_TERMINAL_STATE',
      );
    }
  });

  it('rejects same-state and skip transitions', () => {
    expect(canTransitionTransfer(TransferStatus.REQUESTED, TransferStatus.REQUESTED)).toBe(false);
    expect(canTransitionTransfer(TransferStatus.REQUESTED, TransferStatus.PACKED)).toBe(false);
    expect(() =>
      assertValidTransferTransition(TransferStatus.REQUESTED, TransferStatus.REQUESTED),
    ).toThrow('TRANSFER_TRANSITION_SAME_STATE');
    expect(() =>
      assertValidTransferTransition(TransferStatus.REQUESTED, TransferStatus.DISPATCHED),
    ).toThrow('INVALID_TRANSFER_TRANSITION');
  });

  it('exposes cancellation and receipt guards', () => {
    expect(canCancelTransfer(TransferStatus.REQUESTED)).toBe(true);
    expect(canCancelTransfer(TransferStatus.APPROVED)).toBe(true);
    expect(canCancelTransfer(TransferStatus.PACKED)).toBe(true);
    expect(canCancelTransfer(TransferStatus.DISPATCHED)).toBe(false);
    expect(canCancelTransfer(TransferStatus.IN_TRANSIT)).toBe(false);
    expect(canCancelTransfer(TransferStatus.RECEIVED)).toBe(false);
    expect(canReceiveTransfer(TransferStatus.IN_TRANSIT)).toBe(true);
    expect(canReceiveTransfer(TransferStatus.DISPATCHED)).toBe(false);
  });
});
