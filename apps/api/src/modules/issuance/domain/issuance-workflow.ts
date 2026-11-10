import { BloodRequestStatus, IssuanceStatus } from '@prisma/client';
import { canTransitionRequest } from '../../requests/domain/request-state-machine';

/**
 * Pure issuance/fulfillment rules (Phase 5 Step 5).
 *
 * Safety posture (ADR-018/021/041):
 * - Issuance never selects or overrides inventory; it only consumes units that an
 *   already-approved reservation claim has placed in RESERVED state.
 * - A unit that reached ISSUED cannot return to AVAILABLE. Cancellation is only
 *   valid before confirmation. Reversal of an issued unit is a separate clinical
 *   / disposal workflow and is not implemented here.
 */
export const ISSUABLE_REQUEST_STATUSES: ReadonlySet<BloodRequestStatus> = new Set([
  BloodRequestStatus.RESERVED,
  BloodRequestStatus.PARTIALLY_FULFILLED,
]);

export function isRequestIssuable(status: BloodRequestStatus): boolean {
  return ISSUABLE_REQUEST_STATUSES.has(status);
}

export function canConfirmIssuance(status: IssuanceStatus): boolean {
  return status === IssuanceStatus.CREATED;
}

export function canCancelIssuance(status: IssuanceStatus): boolean {
  return status === IssuanceStatus.CREATED;
}

export interface FulfillmentLine {
  quantityRequested: number;
  quantityReserved: number;
  quantityIssued: number;
}

/**
 * Derives the request status from authoritative line counters. Returns the current
 * status when the derived status is not reachable through the request state machine,
 * so callers never force an invalid transition.
 */
export function computeRequestFulfillmentStatus(
  lines: readonly FulfillmentLine[],
  current: BloodRequestStatus,
): BloodRequestStatus {
  if (lines.length === 0) {
    return current;
  }
  const totalRequested = lines.reduce((sum, line) => sum + line.quantityRequested, 0);
  if (totalRequested <= 0) {
    return current;
  }
  const allIssued = lines.every((line) => line.quantityIssued >= line.quantityRequested);
  const anyIssued = lines.some((line) => line.quantityIssued > 0);
  const anyReserved = lines.some((line) => line.quantityReserved > 0);

  const desired = allIssued
    ? BloodRequestStatus.FULFILLED
    : anyIssued
      ? BloodRequestStatus.PARTIALLY_FULFILLED
      : anyReserved
        ? BloodRequestStatus.RESERVED
        : current;

  if (desired === current || !canTransitionRequest(current, desired)) {
    return current;
  }
  return desired;
}
