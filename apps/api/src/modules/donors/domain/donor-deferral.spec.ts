import { describe, expect, it } from 'vitest';
import { isDeferralActive } from './donor-deferral';

const now = new Date('2026-05-01T12:00:00Z');

describe('donor deferral', () => {
  it('is active for an open-ended deferral in effect', () => {
    expect(
      isDeferralActive(
        { effectiveAt: new Date('2026-04-01T00:00:00Z'), expiresAt: null, resolvedAt: null },
        now,
      ),
    ).toBe(true);
  });

  it('is inactive before the effective date', () => {
    expect(
      isDeferralActive(
        { effectiveAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null, resolvedAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('is inactive after the expiry date', () => {
    expect(
      isDeferralActive(
        { effectiveAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-04-01T00:00:00Z'), resolvedAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('is inactive once resolved', () => {
    expect(
      isDeferralActive(
        {
          effectiveAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: null,
          resolvedAt: new Date('2026-04-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('is active while the expiry date is still ahead', () => {
    expect(
      isDeferralActive(
        { effectiveAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-05-01T12:00:01Z'), resolvedAt: null },
        now,
      ),
    ).toBe(true);
  });
});