import { describe, expect, it } from 'vitest';
import { BloodRequestStatus } from '@prisma/client';
import {
  assertValidRequestTransition,
  canTransitionRequest,
  isTerminalRequestStatus,
} from './request-state-machine';

describe('request state machine', () => {
  it('accepts documented happy-path transitions', () => {
    expect(canTransitionRequest(BloodRequestStatus.DRAFT, BloodRequestStatus.SUBMITTED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.SUBMITTED, BloodRequestStatus.UNDER_REVIEW)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.UNDER_REVIEW, BloodRequestStatus.APPROVED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.APPROVED, BloodRequestStatus.RESERVED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.RESERVED, BloodRequestStatus.PARTIALLY_FULFILLED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.PARTIALLY_FULFILLED, BloodRequestStatus.FULFILLED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.RESERVED, BloodRequestStatus.FULFILLED)).toBe(true);
  });

  it('allows documented cancellation/expiry/rejection paths', () => {
    expect(canTransitionRequest(BloodRequestStatus.DRAFT, BloodRequestStatus.CANCELLED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.SUBMITTED, BloodRequestStatus.CANCELLED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.UNDER_REVIEW, BloodRequestStatus.REJECTED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.RESERVED, BloodRequestStatus.EXPIRED)).toBe(true);
    expect(canTransitionRequest(BloodRequestStatus.PARTIALLY_FULFILLED, BloodRequestStatus.CANCELLED)).toBe(true);
  });

  it('rejects invalid and terminal transitions', () => {
    const invalid: Array<[BloodRequestStatus, BloodRequestStatus]> = [
      [BloodRequestStatus.DRAFT, BloodRequestStatus.APPROVED],
      [BloodRequestStatus.SUBMITTED, BloodRequestStatus.APPROVED],
      [BloodRequestStatus.APPROVED, BloodRequestStatus.FULFILLED],
      [BloodRequestStatus.REJECTED, BloodRequestStatus.APPROVED],
      [BloodRequestStatus.CANCELLED, BloodRequestStatus.SUBMITTED],
      [BloodRequestStatus.FULFILLED, BloodRequestStatus.CANCELLED],
      [BloodRequestStatus.EXPIRED, BloodRequestStatus.RESERVED],
      [BloodRequestStatus.DRAFT, BloodRequestStatus.DRAFT],
    ];
    for (const [from, to] of invalid) {
      expect(canTransitionRequest(from, to)).toBe(false);
    }
  });

  it('asserts with stable errors', () => {
    expect(() => assertValidRequestTransition(BloodRequestStatus.DRAFT, BloodRequestStatus.DRAFT)).toThrow(
      'REQUEST_TRANSITION_SAME_STATE',
    );
    expect(() => assertValidRequestTransition(BloodRequestStatus.REJECTED, BloodRequestStatus.DRAFT)).toThrow(
      'REQUEST_TERMINAL_STATE',
    );
    expect(() => assertValidRequestTransition(BloodRequestStatus.DRAFT, BloodRequestStatus.APPROVED)).toThrow(
      'INVALID_REQUEST_TRANSITION',
    );
  });

  it('flags terminal states', () => {
    expect(isTerminalRequestStatus(BloodRequestStatus.REJECTED)).toBe(true);
    expect(isTerminalRequestStatus(BloodRequestStatus.CANCELLED)).toBe(true);
    expect(isTerminalRequestStatus(BloodRequestStatus.FULFILLED)).toBe(true);
    expect(isTerminalRequestStatus(BloodRequestStatus.EXPIRED)).toBe(true);
    expect(isTerminalRequestStatus(BloodRequestStatus.APPROVED)).toBe(false);
    expect(isTerminalRequestStatus(BloodRequestStatus.DRAFT)).toBe(false);
  });
});
