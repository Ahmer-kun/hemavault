import { describe, expect, it } from 'vitest';
import {
  allowedCampaignTargets,
  CAMPAIGN_TRANSITIONS,
  canTransitionCampaign,
} from './campaign-state-machine';
import {
  allowedRegistrationTargets,
  canTransitionRegistration,
  REGISTRATION_TRANSITIONS,
} from './registration-state-machine';

describe('campaign state machine', () => {
  it('accepts every declared transition', () => {
    for (const transition of CAMPAIGN_TRANSITIONS) {
      expect(canTransitionCampaign(transition.from, transition.to)).toBe(true);
    }
  });

  it.each([
    ['DRAFT', 'PUBLISHED'],
    ['DRAFT', 'CANCELLED'],
    ['PUBLISHED', 'CANCELLED'],
    ['PUBLISHED', 'COMPLETED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionCampaign(from, to)).toBe(true);
  });

  it.each([
    ['DRAFT', 'COMPLETED'],
    ['PUBLISHED', 'DRAFT'],
    ['CANCELLED', 'PUBLISHED'],
    ['COMPLETED', 'PUBLISHED'],
    ['CANCELLED', 'COMPLETED'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionCampaign(from, to)).toBe(false);
  });

  it('exposes only legal target states', () => {
    expect([...allowedCampaignTargets('DRAFT')].sort()).toEqual(['CANCELLED', 'PUBLISHED'].sort());
    expect(allowedCampaignTargets('CANCELLED')).toEqual([]);
  });
});

describe('registration state machine', () => {
  it('accepts every declared transition', () => {
    for (const transition of REGISTRATION_TRANSITIONS) {
      expect(canTransitionRegistration(transition.from, transition.to)).toBe(true);
    }
  });

  it.each([
    ['CONFIRMED', 'CHECKED_IN'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionRegistration(from, to)).toBe(true);
  });

  it.each([
    ['CHECKED_IN', 'CANCELLED'],
    ['CHECKED_IN', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionRegistration(from, to)).toBe(false);
  });

  it('exposes only legal target states', () => {
    expect([...allowedRegistrationTargets('CONFIRMED')].sort()).toEqual(['CANCELLED', 'CHECKED_IN'].sort());
    expect(allowedRegistrationTargets('CANCELLED')).toEqual([]);
  });
});