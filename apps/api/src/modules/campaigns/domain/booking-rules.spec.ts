import { describe, expect, it } from 'vitest';
import { CampaignStatus } from '@prisma/client';
import { canBookCampaignRegistration, canCheckInToCampaign, CampaignGateContext } from './booking-rules';

function context(overrides: Partial<CampaignGateContext> = {}): CampaignGateContext {
  return {
    status: CampaignStatus.PUBLISHED,
    capacity: null,
    startsAt: new Date('2026-01-01T08:00:00Z'),
    endsAt: new Date('2026-01-01T20:00:00Z'),
    registeredCount: 0,
    alreadyRegistered: false,
    activeDeferral: false,
    ...overrides,
  };
}

describe('campaign booking rules', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('allows booking an open published campaign', () => {
    expect(canBookCampaignRegistration(context(), now)).toEqual({ allowed: true });
  });

  it('rejects booking a non-published campaign', () => {
    const verdict = canBookCampaignRegistration(context({ status: CampaignStatus.DRAFT }), now);
    expect(verdict).toEqual({ allowed: false, reason: 'CAMPAIGN_NOT_PUBLISHED' });
  });

  it('rejects booking when the registration window has closed', () => {
    const verdict = canBookCampaignRegistration(
      context({ endsAt: new Date('2026-01-01T09:00:00Z') }),
      now,
    );
    expect(verdict).toEqual({ allowed: false, reason: 'CAMPAIGN_WINDOW_CLOSED' });
  });

  it('rejects booking when capacity is reached', () => {
    const verdict = canBookCampaignRegistration(context({ capacity: 5, registeredCount: 5 }), now);
    expect(verdict).toEqual({ allowed: false, reason: 'CAMPAIGN_FULL' });
  });

  it('allows booking right at capacity boundary', () => {
    expect(canBookCampaignRegistration(context({ capacity: 5, registeredCount: 4 }), now)).toEqual({
      allowed: true,
    });
  });

  it('ignores capacity when unset', () => {
    expect(canBookCampaignRegistration(context({ registeredCount: 99 }), now)).toEqual({
      allowed: true,
    });
  });

  it('rejects booking when the donor already has a registration', () => {
    const verdict = canBookCampaignRegistration(context({ alreadyRegistered: true }), now);
    expect(verdict).toEqual({ allowed: false, reason: 'ALREADY_REGISTERED' });
  });

  it('rejects booking when the donor has an active deferral', () => {
    const verdict = canBookCampaignRegistration(context({ activeDeferral: true }), now);
    expect(verdict).toEqual({ allowed: false, reason: 'DEFERRAL_ACTIVE' });
  });

  it('allows booking before the campaign starts', () => {
    const early = new Date('2025-12-31T00:00:00Z');
    expect(canBookCampaignRegistration(context(), early)).toEqual({ allowed: true });
  });

  it('rejects check-in before the window opens', () => {
    const early = new Date('2026-01-01T07:00:00Z');
    const verdict = canCheckInToCampaign(context(), early);
    expect(verdict).toEqual({ allowed: false, reason: 'CAMPAIGN_WINDOW_CLOSED' });
  });

  it('rejects check-in outside a published campaign window', () => {
    const late = new Date('2026-01-01T21:00:00Z');
    const verdict = canCheckInToCampaign(context(), late);
    expect(verdict).toEqual({ allowed: false, reason: 'CAMPAIGN_WINDOW_CLOSED' });
  });

  it('allows check-in inside the window for an eligible donor', () => {
    expect(canCheckInToCampaign(context(), now)).toEqual({ allowed: true });
  });

  it('rejects check-in for a deferred donor', () => {
    const verdict = canCheckInToCampaign(context({ activeDeferral: true }), now);
    expect(verdict).toEqual({ allowed: false, reason: 'DEFERRAL_ACTIVE' });
  });
});