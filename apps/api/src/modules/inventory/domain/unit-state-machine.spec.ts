import { describe, expect, it } from 'vitest';
import { UnitState, assertValidTransition, canTransition, getAllowedTransitions, isTerminalState } from './unit-state-machine';

describe('inventory unit state machine', () => {
  it('allows COLLECTED -> QUARANTINED', () => {
    expect(canTransition(UnitState.COLLECTED, UnitState.QUARANTINED)).toBe(true);
    expect(() => assertValidTransition(UnitState.COLLECTED, UnitState.QUARANTINED)).not.toThrow();
  });

  it('allows QUARANTINED -> AVAILABLE, DISCARDed, RECALLED', () => {
    expect(canTransition(UnitState.QUARANTINED, UnitState.AVAILABLE)).toBe(true);
    expect(canTransition(UnitState.QUARANTINED, UnitState.DISCARDED)).toBe(true);
    expect(canTransition(UnitState.QUARANTINED, UnitState.RECALLED)).toBe(true);
  });

  it('allows AVAILABLE transitions per spec', () => {
    expect(canTransition(UnitState.AVAILABLE, UnitState.RESERVED)).toBe(true);
    expect(canTransition(UnitState.AVAILABLE, UnitState.TRANSFER_PENDING)).toBe(true);
    expect(canTransition(UnitState.AVAILABLE, UnitState.QUARANTINED)).toBe(true);
    expect(canTransition(UnitState.AVAILABLE, UnitState.EXPIRED)).toBe(true);
    expect(canTransition(UnitState.AVAILABLE, UnitState.DISCARDED)).toBe(true);
    expect(canTransition(UnitState.AVAILABLE, UnitState.RECALLED)).toBe(true);
  });

  it('allows RESERVED transitions per spec', () => {
    expect(canTransition(UnitState.RESERVED, UnitState.AVAILABLE)).toBe(true);
    expect(canTransition(UnitState.RESERVED, UnitState.ISSUED)).toBe(true);
    expect(canTransition(UnitState.RESERVED, UnitState.TRANSFER_PENDING)).toBe(true);
    expect(canTransition(UnitState.RESERVED, UnitState.EXPIRED)).toBe(true);
    expect(canTransition(UnitState.RESERVED, UnitState.DISCARDED)).toBe(true);
    expect(canTransition(UnitState.RESERVED, UnitState.RECALLED)).toBe(true);
  });

  it('allows TRANSFER_PENDING -> IN_TRANSIT and transfer cancellation/rejection back to AVAILABLE', () => {
    expect(canTransition(UnitState.TRANSFER_PENDING, UnitState.IN_TRANSIT)).toBe(true);
    expect(canTransition(UnitState.TRANSFER_PENDING, UnitState.AVAILABLE)).toBe(true);
  });

  it('allows IN_TRANSIT -> RECEIVED', () => {
    expect(canTransition(UnitState.IN_TRANSIT, UnitState.RECEIVED)).toBe(true);
  });

  it('allows ISSUED -> USED or CLOSED', () => {
    expect(canTransition(UnitState.ISSUED, UnitState.USED)).toBe(true);
    expect(canTransition(UnitState.ISSUED, UnitState.CLOSED)).toBe(true);
  });

  it('allows RECEIVED -> RECEIVED_BY_DESTINATION -> CLOSED', () => {
    expect(canTransition(UnitState.RECEIVED, UnitState.RECEIVED_BY_DESTINATION)).toBe(true);
    expect(canTransition(UnitState.RECEIVED_BY_DESTINATION, UnitState.CLOSED)).toBe(true);
  });

  it('rejects same-state transitions', () => {
    expect(canTransition(UnitState.AVAILABLE, UnitState.AVAILABLE)).toBe(false);
    expect(() => assertValidTransition(UnitState.AVAILABLE, UnitState.AVAILABLE)).toThrow('INVENTORY_UNIT_TRANSITION_SAME_STATE');
  });

  it('rejects transitions from terminal states', () => {
    expect(isTerminalState(UnitState.EXPIRED)).toBe(true);
    expect(isTerminalState(UnitState.DISCARDED)).toBe(true);
    expect(isTerminalState(UnitState.RECALLED)).toBe(true);
    expect(isTerminalState(UnitState.CLOSED)).toBe(true);
    expect(isTerminalState(UnitState.USED)).toBe(true);
    expect(canTransition(UnitState.RECALLED, UnitState.AVAILABLE)).toBe(false);
    expect(canTransition(UnitState.DISCARDED, UnitState.AVAILABLE)).toBe(false);
    expect(canTransition(UnitState.EXPIRED, UnitState.AVAILABLE)).toBe(false);
    expect(() => assertValidTransition(UnitState.CLOSED, UnitState.AVAILABLE)).toThrow('INVENTORY_UNIT_TERMINAL_STATE');
  });

  it('rejects invalid transitions', () => {
    expect(canTransition(UnitState.COLLECTED, UnitState.AVAILABLE)).toBe(false);
    expect(canTransition(UnitState.QUARANTINED, UnitState.RESERVED)).toBe(false);
    expect(canTransition(UnitState.AVAILABLE, UnitState.ISSUED)).toBe(false);
    expect(canTransition(UnitState.IN_TRANSIT, UnitState.ISSUED)).toBe(false);
  });

  it('getAllowedTransitions returns expected lists', () => {
    expect(getAllowedTransitions(UnitState.QUARANTINED).sort()).toEqual([UnitState.AVAILABLE, UnitState.DISCARDED, UnitState.RECALLED].sort());
    expect(getAllowedTransitions(UnitState.AVAILABLE)).toContain(UnitState.RECALLED);
    expect(getAllowedTransitions(UnitState.RESERVED)).toContain(UnitState.RECALLED);
    expect(getAllowedTransitions(UnitState.EXPIRED)).toEqual([]);
  });
});
