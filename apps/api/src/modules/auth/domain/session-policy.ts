import { UserStatus } from '@prisma/client';

export interface SessionPolicyInput {
  now: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  idleSeconds: number;
}

export function isSessionLive(input: SessionPolicyInput): boolean {
  if (input.revokedAt !== null) {
    return false;
  }
  if (input.expiresAt.getTime() <= input.now.getTime()) {
    return false;
  }
  const idleMs = input.now.getTime() - input.lastUsedAt.getTime();
  return idleMs < input.idleSeconds * 1000;
}

export function computeSessionExpiry(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

export interface LockoutResult {
  lockedUntilAt: Date | null;
  attempts: number;
}

export function applyLoginFailure(
  currentAttempts: number,
  now: Date,
  maxAttempts: number,
  lockoutSeconds: number,
): LockoutResult {
  const next = currentAttempts + 1;
  if (next >= maxAttempts) {
    return { lockedUntilAt: new Date(now.getTime() + lockoutSeconds * 1000), attempts: next };
  }
  return { lockedUntilAt: null, attempts: next };
}

export function isUserLocked(lockedUntilAt: Date | null, now: Date): boolean {
  return lockedUntilAt !== null && lockedUntilAt.getTime() > now.getTime();
}

export type UserStatusTransition = `${UserStatus}->${UserStatus}`;

const ALLOWED_TRANSITIONS: readonly UserStatusTransition[] = [
  'PENDING_VERIFICATION->ACTIVE',
  'ACTIVE->DISABLED',
  'DISABLED->ACTIVE',
];

export function canTransition(from: UserStatus, to: UserStatus): boolean {
  const key: UserStatusTransition = `${from}->${to}`;
  return ALLOWED_TRANSITIONS.includes(key);
}

export function isAllowedLoginStatus(status: UserStatus): boolean {
  return status === UserStatus.ACTIVE;
}