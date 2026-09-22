import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateOpaqueToken,
  hashAndCompare,
  hashToken,
} from './token.utils';

describe('token.utils', () => {
  it('generates unique, suitably long opaque tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('hashes tokens deterministically to hex', () => {
    const token = 'some-raw-token';
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('compares strings in constant time semantics', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('verifies a candidate token against a stored digest', () => {
    const token = generateOpaqueToken();
    expect(hashAndCompare(token, hashToken(token))).toBe(true);
    expect(hashAndCompare('wrong-token', hashToken(token))).toBe(false);
  });
});