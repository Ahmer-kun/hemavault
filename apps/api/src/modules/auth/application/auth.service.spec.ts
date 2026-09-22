import { HttpStatus } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, RequestContext } from './auth.service';
import { AUTH_ACTIONS } from '../domain/auth.constants';

const context: RequestContext = { requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'staff@blood-ops.example',
    passwordHash: 'hashed-password',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginCount: 0,
    lockedUntilAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  const mockRepository = {
    findUserByEmail: vi.fn(),
    createUserWithVerification: vi.fn(),
    findUserById: vi.fn(),
    applyLoginFailure: vi.fn(),
    resetLoginFailure: vi.fn(),
    completeEmailVerification: vi.fn(),
    findEmailVerificationByTokenHash: vi.fn(),
    markEmailVerificationUsed: vi.fn(),
    createPasswordResetToken: vi.fn(),
    findPasswordResetByTokenHash: vi.fn(),
    markPasswordResetUsed: vi.fn(),
    resetPasswordAndRevokeSessions: vi.fn(),
  };
  const mockSessionRepo = {
    create: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
    revokeAllForUser: vi.fn(),
    findByTokenHash: vi.fn(),
  };
  const mockHasher = { hash: vi.fn(), verify: vi.fn() };
  const mockEmailProvider = { sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() };
  const mockAudit = { record: vi.fn() };
  const appConfigStub = {
    sessionTtlSeconds: 7 * 24 * 3600,
    sessionIdleSeconds: 3600,
    passwordMinLength: 12,
    passwordMaxLength: 128,
    emailVerifyTokenTtlSeconds: 24 * 3600,
    passwordResetTokenTtlSeconds: 3600,
    loginMaxAttempts: 5,
    loginLockoutSeconds: 900,
    cookieSecure: false,
    webOrigin: 'http://localhost:5173',
  };
  const mockConfig = appConfigStub;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasher.hash.mockResolvedValue('hashed-password');
    mockHasher.verify.mockImplementation(async (_pw: string, encoded: string) => encoded === 'hashed-password');
    mockAudit.record.mockResolvedValue(undefined);
    mockEmailProvider.sendVerificationEmail.mockResolvedValue(undefined);
    mockEmailProvider.sendPasswordResetEmail.mockResolvedValue(undefined);
    mockSessionRepo.create.mockResolvedValue({ id: 'session-1' });
    service = new AuthService(
      mockRepository as never,
      mockSessionRepo as never,
      mockHasher as never,
      mockEmailProvider as never,
      mockAudit as never,
      mockConfig as never,
    );
  });

  describe('register', () => {
    it('creates a pending user, an email token, audits, and emails the token', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);
      mockRepository.createUserWithVerification.mockResolvedValue({ user: makeUser({ status: UserStatus.PENDING_VERIFICATION }) });

      const result = await service.register('  STAFF@Blood-Ops.Example  ', 'correct-horse-battery');
      expect(result.message).toContain('verification email');
      expect(mockRepository.createUserWithVerification).toHaveBeenCalledWith(
        { email: 'staff@blood-ops.example', passwordHash: 'hashed-password' },
        expect.objectContaining({ tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      );
      expect(mockEmailProvider.sendVerificationEmail).toHaveBeenCalledOnce();
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_ACTIONS.REGISTER, actorUserId: 'user-1' }),
      );
    });

    it('returns a generic response and does not send email for an existing account', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(makeUser());
      const result = await service.register('staff@blood-ops.example', 'correct-horse-battery');
      expect(result.message).toContain('verification email');
      expect(mockRepository.createUserWithVerification).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('signs in an active user, creating a session and auditing success', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(makeUser());
      const result = await service.login('staff@blood-ops.example', 'correct-horse-battery', context);
      expect(mockSessionRepo.create).toHaveBeenCalledOnce();
      expect(result.user.email).toBe('staff@blood-ops.example');
      expect(result.csrfToken).toBeTruthy();
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.LOGIN_SUCCESS }));
    });

    it('rejects unknown users with a generic error (no enumeration)', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@blood-ops.example', 'wrong-password!', context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.LOGIN_FAILED }));
    });

    it('locks the account after repeated failures', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(makeUser({ failedLoginCount: 4 }));
      mockHasher.verify.mockResolvedValue(false);
      await expect(service.login('staff@blood-ops.example', 'bad-password!', context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
      expect(mockRepository.applyLoginFailure).toHaveBeenCalledWith('user-1', expect.any(Date), 5);
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.LOGIN_BLOCKED }));
    });

    it('refuses PENDING_VERIFICATION accounts', async () => {
      const user = makeUser({ status: UserStatus.PENDING_VERIFICATION, emailVerifiedAt: null });
      mockRepository.findUserByEmail.mockResolvedValue(user);
      mockHasher.verify.mockResolvedValue(true);
      await expect(service.login('staff@blood-ops.example', 'correct-horse-battery', context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('activates the account when the token is valid and unused', async () => {
      mockRepository.findEmailVerificationByTokenHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null,
      });
      mockRepository.findUserById.mockResolvedValue(makeUser({ status: UserStatus.PENDING_VERIFICATION }));
      const result = await service.verifyEmail('the-token');
      expect(result.message).toContain('verified');
      expect(mockRepository.completeEmailVerification).toHaveBeenCalledWith('user-1');
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.EMAIL_VERIFIED }));
    });

    it('rejects expired or used tokens', async () => {
      mockRepository.findEmailVerificationByTokenHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });
      await expect(service.verifyEmail('expired-token')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('forgotPassword & resetPassword', () => {
    it('sends a reset email for an existing account', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(makeUser());
      await service.forgotPassword('staff@blood-ops.example', context);
      expect(mockEmailProvider.sendPasswordResetEmail).toHaveBeenCalledOnce();
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.FORGOT_PASSWORD }));
    });

    it('returns generic response without sending email for an unknown account', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);
      const result = await service.forgotPassword('nobody@blood-ops.example', context);
      expect(result.message).toContain('If an account exists');
      expect(mockEmailProvider.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('resets the password and revokes all sessions', async () => {
      mockRepository.findPasswordResetByTokenHash.mockResolvedValue({
        id: 'token-r',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null,
      });
      mockRepository.findUserById.mockResolvedValue(makeUser());
      const result = await service.resetPassword('reset-token', 'new-horse-battery');
      expect(result.message).toContain('reset');
      expect(mockRepository.markPasswordResetUsed).toHaveBeenCalledWith('token-r');
      expect(mockRepository.resetPasswordAndRevokeSessions).toHaveBeenCalledWith('user-1', expect.any(String));
    });
  });

  describe('logoutAll', () => {
    it('revokes all sessions for the user and audits logout_all', async () => {
      await service.logoutAll('user-1', context);
      expect(mockSessionRepo.revokeAllForUser).toHaveBeenCalledWith('user-1', expect.any(Date));
      expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUTH_ACTIONS.LOGOUT_ALL }));
    });
  });

  describe('me', () => {
    it('returns a safe user shape without hashes', async () => {
      mockRepository.findUserById.mockResolvedValue(makeUser({ passwordHash: 'secret-hash' }));
      const result = await service.me('user-1');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.email).toBe('staff@blood-ops.example');
    });
  });
});