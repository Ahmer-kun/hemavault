import { describe, expect, it } from 'vitest';
import { decodeNotificationEventId, encodeNotificationEventId } from './notification.types';

describe('notification event identifiers', () => {
  it('round-trips timestamps through the event id', () => {
    const createdAt = new Date('2026-11-11T10:00:00.000Z');
    const id = '00000000-0000-4000-8000-000000000001';
    const encoded = encodeNotificationEventId({ id, createdAt });
    expect(encoded.startsWith(String(createdAt.getTime()))).toBe(true);
    expect(decodeNotificationEventId(encoded)?.getTime()).toBe(createdAt.getTime());
  });

  it('returns null for missing or malformed event ids', () => {
    expect(decodeNotificationEventId(undefined)).toBeNull();
    expect(decodeNotificationEventId('')).toBeNull();
    expect(decodeNotificationEventId('not-a-number')).toBeNull();
    expect(decodeNotificationEventId('-5')).toBeNull();
    expect(decodeNotificationEventId('0')).toBeNull();
  });
});
