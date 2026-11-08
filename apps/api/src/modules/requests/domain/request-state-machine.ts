import { BloodRequestStatus } from '@prisma/client';

export { BloodRequestStatus };

const TERMINAL = new Set<BloodRequestStatus>([
  BloodRequestStatus.REJECTED,
  BloodRequestStatus.CANCELLED,
  BloodRequestStatus.FULFILLED,
  BloodRequestStatus.EXPIRED,
]);

const ALLOWED: Record<BloodRequestStatus, Set<BloodRequestStatus>> = {
  [BloodRequestStatus.DRAFT]: new Set([BloodRequestStatus.SUBMITTED, BloodRequestStatus.CANCELLED]),
  [BloodRequestStatus.SUBMITTED]: new Set([BloodRequestStatus.UNDER_REVIEW, BloodRequestStatus.CANCELLED]),
  [BloodRequestStatus.UNDER_REVIEW]: new Set([
    BloodRequestStatus.APPROVED,
    BloodRequestStatus.REJECTED,
    BloodRequestStatus.CANCELLED,
  ]),
  [BloodRequestStatus.APPROVED]: new Set([BloodRequestStatus.RESERVED, BloodRequestStatus.CANCELLED]),
  [BloodRequestStatus.RESERVED]: new Set([
    BloodRequestStatus.PARTIALLY_FULFILLED,
    BloodRequestStatus.FULFILLED,
    BloodRequestStatus.CANCELLED,
    BloodRequestStatus.EXPIRED,
  ]),
  [BloodRequestStatus.PARTIALLY_FULFILLED]: new Set([
    BloodRequestStatus.FULFILLED,
    BloodRequestStatus.CANCELLED,
    BloodRequestStatus.EXPIRED,
  ]),
  [BloodRequestStatus.REJECTED]: new Set(),
  [BloodRequestStatus.CANCELLED]: new Set(),
  [BloodRequestStatus.FULFILLED]: new Set(),
  [BloodRequestStatus.EXPIRED]: new Set(),
};

export function isTerminalRequestStatus(status: BloodRequestStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransitionRequest(from: BloodRequestStatus, to: BloodRequestStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  return ALLOWED[from]?.has(to) ?? false;
}

export function assertValidRequestTransition(from: BloodRequestStatus, to: BloodRequestStatus): void {
  if (from === to) throw new Error('REQUEST_TRANSITION_SAME_STATE');
  if (TERMINAL.has(from)) throw new Error('REQUEST_TERMINAL_STATE');
  if (!canTransitionRequest(from, to)) throw new Error('INVALID_REQUEST_TRANSITION');
}
