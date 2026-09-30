import { describe, expect, it } from 'vitest';
import {
  allowedDonationTargets,
  canTransitionDonation,
  DONATION_TRANSITIONS,
  isTerminalDonationState,
} from './donation-state-machine';

describe('donation state machine', () => {
  it('accepts every declared transition exactly once', () => {
    const pairs = new Set(DONATION_TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    for (const transition of DONATION_TRANSITIONS) {
      expect(canTransitionDonation(transition.from, transition.to)).toBe(true);
      pairs.add(`${transition.from}>${transition.to}`);
    }
    expect(pairs.size).toBe(DONATION_TRANSITIONS.length);
  });

  it.each([
    ['SCHEDULED', 'CHECKED_IN'],
    ['SCHEDULED', 'CANCELLED'],
    ['CHECKED_IN', 'COLLECTED'],
    ['COLLECTED', 'SCREENING'],
    ['SCREENING', 'QUARANTINED'],
    ['SCREENING', 'REJECTED'],
    ['QUARANTINED', 'RELEASED'],
    ['QUARANTINED', 'REJECTED'],
    ['RELEASED', 'COMPLETED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionDonation(from, to)).toBe(true);
  });

  it.each([
    ['SCHEDULED', 'COLLECTED'],
    ['SCHEDULED', 'RELEASED'],
    ['CHECKED_IN', 'SCHEDULED'],
    ['COLLECTED', 'QUARANTINED'],
    ['COLLECTED', 'REJECTED'],
    ['SCREENING', 'RELEASED'],
    ['SCREENING', 'COMPLETED'],
    ['QUARANTINED', 'CHECKED_IN'],
    ['QUARANTINED', 'SCREENING'],
    ['RELEASED', 'QUARANTINED'],
    ['REJECTED', 'QUARANTINED'],
    ['CANCELLED', 'SCHEDULED'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionDonation(from, to)).toBe(false);
  });

  it('exposes only legal target states', () => {
    expect([...allowedDonationTargets('SCREENING')].sort()).toEqual(['QUARANTINED', 'REJECTED'].sort());
    expect(allowedDonationTargets('CHECKED_IN')).toEqual(['COLLECTED']);
    expect(allowedDonationTargets('REJECTED')).toEqual([]);
  });

  it('flags terminal states', () => {
    expect(isTerminalDonationState('REJECTED')).toBe(true);
    expect(isTerminalDonationState('CANCELLED')).toBe(true);
    expect(isTerminalDonationState('COMPLETED')).toBe(true);
    expect(isTerminalDonationState('RELEASED')).toBe(false);
    expect(isTerminalDonationState('QUARANTINED')).toBe(false);
  });
});