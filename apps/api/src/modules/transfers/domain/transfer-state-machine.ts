import { TransferStatus } from '@prisma/client';

export { TransferStatus };

const TERMINAL_STATES: ReadonlySet<TransferStatus> = new Set([
  TransferStatus.RECEIVED,
  TransferStatus.REJECTED,
  TransferStatus.CANCELLED,
]);

/**
 * Authoritative transfer lifecycle (docs/STATE_MACHINES.md):
 * REQUESTED → APPROVED → PACKED → DISPATCHED → IN_TRANSIT → RECEIVED
 * with REQUESTED → REJECTED/CANCELLED and APPROVED/PACKED → CANCELLED.
 *
 * The dispatch command advances DISPATCHED → IN_TRANSIT atomically because the
 * API contract exposes no separate in-transit command (ADR-048).
 */
const ALLOWED_TRANSITIONS: Record<TransferStatus, ReadonlySet<TransferStatus>> = {
  [TransferStatus.REQUESTED]: new Set([
    TransferStatus.APPROVED,
    TransferStatus.REJECTED,
    TransferStatus.CANCELLED,
  ]),
  [TransferStatus.APPROVED]: new Set([TransferStatus.PACKED, TransferStatus.CANCELLED]),
  [TransferStatus.PACKED]: new Set([TransferStatus.DISPATCHED, TransferStatus.CANCELLED]),
  [TransferStatus.DISPATCHED]: new Set([TransferStatus.IN_TRANSIT]),
  [TransferStatus.IN_TRANSIT]: new Set([TransferStatus.RECEIVED]),
  [TransferStatus.RECEIVED]: new Set(),
  [TransferStatus.REJECTED]: new Set(),
  [TransferStatus.CANCELLED]: new Set(),
};

export function canTransitionTransfer(from: TransferStatus, to: TransferStatus): boolean {
  if (from === to) return false;
  if (TERMINAL_STATES.has(from)) return false;
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertValidTransferTransition(from: TransferStatus, to: TransferStatus): void {
  if (from === to) {
    throw new Error('TRANSFER_TRANSITION_SAME_STATE');
  }
  if (TERMINAL_STATES.has(from)) {
    throw new Error('TRANSFER_TERMINAL_STATE');
  }
  if (!canTransitionTransfer(from, to)) {
    throw new Error('INVALID_TRANSFER_TRANSITION');
  }
}

export function isTerminalTransferStatus(status: TransferStatus): boolean {
  return TERMINAL_STATES.has(status);
}

/** States in which source units are still held and may be returned on cancellation. */
export function canCancelTransfer(status: TransferStatus): boolean {
  return (
    status === TransferStatus.REQUESTED ||
    status === TransferStatus.APPROVED ||
    status === TransferStatus.PACKED
  );
}

export function canReceiveTransfer(status: TransferStatus): boolean {
  return status === TransferStatus.IN_TRANSIT;
}

export function getTransferAllowedTransitions(from: TransferStatus): TransferStatus[] {
  if (TERMINAL_STATES.has(from)) return [];
  return Array.from(ALLOWED_TRANSITIONS[from] ?? []);
}
