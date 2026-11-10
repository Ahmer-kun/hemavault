import { BloodRequestStatus, IssuanceStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canCancelIssuance,
  canConfirmIssuance,
  computeRequestFulfillmentStatus,
  isRequestIssuable,
} from './issuance-workflow';

describe('issuance workflow rules', () => {
  it('only allows issuance for requests that have active reservations', () => {
    for (const status of [
      BloodRequestStatus.DRAFT,
      BloodRequestStatus.SUBMITTED,
      BloodRequestStatus.UNDER_REVIEW,
      BloodRequestStatus.APPROVED,
      BloodRequestStatus.FULFILLED,
      BloodRequestStatus.CANCELLED,
      BloodRequestStatus.REJECTED,
      BloodRequestStatus.EXPIRED,
    ]) {
      expect(isRequestIssuable(status)).toBe(false);
    }
    expect(isRequestIssuable(BloodRequestStatus.RESERVED)).toBe(true);
    expect(isRequestIssuable(BloodRequestStatus.PARTIALLY_FULFILLED)).toBe(true);
  });

  it('only confirms or cancels an issuance in CREATED state', () => {
    expect(canConfirmIssuance(IssuanceStatus.CREATED)).toBe(true);
    expect(canConfirmIssuance(IssuanceStatus.CONFIRMED)).toBe(false);
    expect(canConfirmIssuance(IssuanceStatus.CANCELLED)).toBe(false);
    expect(canCancelIssuance(IssuanceStatus.CREATED)).toBe(true);
    // Issued units cannot be returned to available inventory.
    expect(canCancelIssuance(IssuanceStatus.CONFIRMED)).toBe(false);
    expect(canCancelIssuance(IssuanceStatus.CANCELLED)).toBe(false);
  });

  it('derives RESERVED -> PARTIALLY_FULFILLED -> FULFILLED from line counters', () => {
    const partial = computeRequestFulfillmentStatus(
      [{ quantityRequested: 2, quantityReserved: 1, quantityIssued: 1 }],
      BloodRequestStatus.RESERVED,
    );
    expect(partial).toBe(BloodRequestStatus.PARTIALLY_FULFILLED);

    const complete = computeRequestFulfillmentStatus(
      [{ quantityRequested: 2, quantityReserved: 0, quantityIssued: 2 }],
      BloodRequestStatus.PARTIALLY_FULFILLED,
    );
    expect(complete).toBe(BloodRequestStatus.FULFILLED);
  });

  it('requires every line to be issued before FULFILLED', () => {
    const status = computeRequestFulfillmentStatus(
      [
        { quantityRequested: 1, quantityReserved: 0, quantityIssued: 1 },
        { quantityRequested: 1, quantityReserved: 1, quantityIssued: 0 },
      ],
      BloodRequestStatus.RESERVED,
    );
    expect(status).toBe(BloodRequestStatus.PARTIALLY_FULFILLED);
  });

  it('keeps the current status when no valid transition is available', () => {
    const status = computeRequestFulfillmentStatus(
      [{ quantityRequested: 1, quantityReserved: 0, quantityIssued: 1 }],
      BloodRequestStatus.APPROVED,
    );
    expect(status).toBe(BloodRequestStatus.APPROVED);
  });

  it('does not update status for an empty request or non-positive totals', () => {
    expect(computeRequestFulfillmentStatus([], BloodRequestStatus.RESERVED)).toBe(
      BloodRequestStatus.RESERVED,
    );
    expect(
      computeRequestFulfillmentStatus(
        [{ quantityRequested: 0, quantityReserved: 0, quantityIssued: 0 }],
        BloodRequestStatus.RESERVED,
      ),
    ).toBe(BloodRequestStatus.RESERVED);
  });
});
