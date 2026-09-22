import { UserStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  applyLoginFailure,
  canTransition,
  computeSessionExpiry,
  isAllowedLoginStatus,
  isSessionLive,
  isUserLocked,
} from './session-policy';

describe('session-policy', () => {
  describe('isSessionLive', () => {
    const base = {
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastUsedAt: new Date('2026-01-01T00:20:00Z'),
      expiresAt: new Date('2026-01-08T00:00:00Z'),
      revokedAt: null,
      idleSeconds: 3600,
    };

    it('accepts an active, non-expired, non-idle session', () => {
      expect(isSessionLive({ ...base, now: new Date('2026-01-01T01:00:00Z') })).toBe(true);
    });

    it('rejects when the absolute TTL has passed', () => {
      expect(isSessionLive({ ...base, now: new Date('2026-01-08T00:00:01Z') })).toBe(false);
    });

    it('rejects when the idle window has passed', () => {
      expect(isSessionLive({ ...base, now: new Date('2026-01-01T01:21:00Z') })).toBe(false);
    });

    it('rejects a revoked session even when otherwise live', () => {
      expect(isSessionLive({ ...base, revokedAt: new Date('2026-01-01T00:10:00Z'), now: new Date('2026-01-01T01:00:00Z') })).toBe(false);
    });
  });

  describe('computeSessionExpiry', () => {
    it('adds the ttl to the current time', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      expect(computeSessionExpiry(now, 3600)).toEqual(new Date('2026-01-01T01:00:00Z'));
    });
  });

  describe('applyLoginFailure', () => {
    it('increments attempts below the threshold without locking', () => {
      expect(applyLoginFailure(1, new Date(), 5, 900)).toEqual({ lockedUntilAt: null, attempts: 2 });
    });

    it('locks the account at the threshold', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const result = applyLoginFailure(4, now, 5, 900);
      expect(result.attempts).toBe(5);
      expect(result.lockedUntilAt).toEqual(new Date('2026-01-01T00:15:00Z'));
    });
  });

  describe('isUserLocked', () => {
    it('unlocks when the lock window has passed', () => {
      expect(isUserLocked(new Date('2026-01-01T00:15:00Z'), new Date('2026-01-01T00:15:01Z'))).toBe(false);
    });

    it('locks while inside the window', () => {
      expect(isUserLocked(new Date('2026-01-01T00:15:00Z'), new Date('2026-01-01T00:05:00Z'))).toBe(true);
    });
  });

  describe('canTransition', () => {
    it('allows email-verified activation and toggling disabled', () => {
      expect(canTransition(UserStatus.PENDING_VERIFICATION, UserStatus.ACTIVE)).toBe(true);
      expect(canTransition(UserStatus.ACTIVE, UserStatus.DISABLED)).toBe(true);
      expect(canTransition(UserStatus.DISABLED, UserStatus.ACTIVE)).toBe(true);
    });

    it('rejects impossible transitions', () => {
      expect(canTransition(UserStatus.DISABLED, UserStatus.PENDING_VERIFICATION)).toBe(false);
      expect(canTransition(UserStatus.PENDING_VERIFICATION, UserStatus.DISABLED)).toBe(false);
    });
  });

  describe('isAllowedLoginStatus', () => {
    it('only allows active accounts to sign in', () => {
      expect(isAllowedLoginStatus(UserStatus.ACTIVE)).toBe(true);
      expect(isAllowedLoginStatus(UserStatus.PENDING_VERIFICATION)).toBe(false);
      expect(isAllowedLoginStatus(UserStatus.DISABLED)).toBe(false);
    });
  });
});