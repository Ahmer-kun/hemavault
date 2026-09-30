import { describe, expect, it } from 'vitest';
import { computeAuditHash } from './audit.service';

describe('audit.service hash chain', () => {
  it('produces a stable digest for a given event and previous hash', () => {
    const event = {
      action: 'auth.login_success',
      actorUserId: 'user-1',
      targetType: 'user',
      targetId: 'user-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      metadataSerialized: '{"a":1}',
      occurredAtIso: '2026-01-01T00:00:00.000Z',
    };
    const one = computeAuditHash(null, event);
    const two = computeAuditHash('prev-hash', event);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toBe(two);
    expect(two).toBe(computeAuditHash('prev-hash', event));
  });

  it('changes when any tamperable field changes (chaining catches tampering)', () => {
    const base = {
      action: 'auth.login_success',
      actorUserId: 'user-1',
      targetType: 'user',
      targetId: 'user-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      metadataSerialized: null,
      occurredAtIso: '2026-01-01T00:00:00.000Z',
    };
    const baseline = computeAuditHash('abc', base);
    const tampered = computeAuditHash('abc', { ...base, actorUserId: 'user-2' });
    expect(tampered).not.toBe(baseline);
  });

  it('includes organization and facility context in the digest', () => {
    const base = {
      action: 'facility.member_added',
      actorUserId: 'user-1',
      targetType: 'membership',
      targetId: 'membership-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      requestId: 'req-1',
      ipAddress: null,
      userAgent: null,
      metadataSerialized: '{"roleCode":"LAB_STAFF"}',
      occurredAtIso: '2026-01-01T00:00:00.000Z',
    };
    const digest = computeAuditHash('prev', base);
    const orphaned = computeAuditHash('prev', { ...base, facilityId: '' });
    const wrongOrg = computeAuditHash('prev', { ...base, organizationId: 'org-2' });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(orphaned);
    expect(digest).not.toBe(wrongOrg);
  });
});