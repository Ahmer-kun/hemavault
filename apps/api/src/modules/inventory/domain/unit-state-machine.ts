import { UnitState } from '@prisma/client';

export { UnitState };

const TERMINAL_STATES = new Set<UnitState>([
  UnitState.EXPIRED,
  UnitState.DISCARDED,
  UnitState.RECALLED,
  UnitState.CLOSED,
  UnitState.USED,
]);

const ALLOWED_TRANSITIONS: Record<UnitState, Set<UnitState>> = {
  // TRANSFER_PENDING → AVAILABLE is the explicit transfer cancellation/rejection
  // return path (ADR-048). Units never leave the source facility until dispatch.
  [UnitState.COLLECTED]: new Set([UnitState.QUARANTINED]),
  [UnitState.QUARANTINED]: new Set([UnitState.AVAILABLE, UnitState.DISCARDED, UnitState.RECALLED]),
  [UnitState.AVAILABLE]: new Set([
    UnitState.RESERVED,
    UnitState.TRANSFER_PENDING,
    UnitState.QUARANTINED,
    UnitState.EXPIRED,
    UnitState.DISCARDED,
    UnitState.RECALLED,
  ]),
  [UnitState.RESERVED]: new Set([
    UnitState.AVAILABLE,
    UnitState.ISSUED,
    UnitState.TRANSFER_PENDING,
    UnitState.EXPIRED,
    UnitState.DISCARDED,
    UnitState.RECALLED,
  ]),
  [UnitState.TRANSFER_PENDING]: new Set([UnitState.IN_TRANSIT, UnitState.AVAILABLE]),
  [UnitState.IN_TRANSIT]: new Set([UnitState.RECEIVED]),
  [UnitState.RECEIVED]: new Set([UnitState.RECEIVED_BY_DESTINATION]),
  [UnitState.RECEIVED_BY_DESTINATION]: new Set([UnitState.CLOSED]),
  [UnitState.ISSUED]: new Set([UnitState.USED, UnitState.CLOSED]),
  [UnitState.EXPIRED]: new Set(),
  [UnitState.DISCARDED]: new Set(),
  [UnitState.RECALLED]: new Set(),
  [UnitState.CLOSED]: new Set(),
  [UnitState.USED]: new Set(),
};

export function canTransition(from: UnitState, to: UnitState): boolean {
  if (from === to) {
    return false;
  }
  if (TERMINAL_STATES.has(from)) {
    return false;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.has(to);
}

export function assertValidTransition(from: UnitState, to: UnitState): void {
  if (from === to) {
    throw new Error('INVENTORY_UNIT_TRANSITION_SAME_STATE');
  }
  if (TERMINAL_STATES.has(from)) {
    throw new Error('INVENTORY_UNIT_TERMINAL_STATE');
  }
  if (!canTransition(from, to)) {
    throw new Error('INVALID_INVENTORY_UNIT_TRANSITION');
  }
}

export function getAllowedTransitions(from: UnitState): UnitState[] {
  if (TERMINAL_STATES.has(from)) {
    return [];
  }
  return Array.from(ALLOWED_TRANSITIONS[from] ?? []);
}

export function isTerminalState(state: UnitState): boolean {
  return TERMINAL_STATES.has(state);
}
