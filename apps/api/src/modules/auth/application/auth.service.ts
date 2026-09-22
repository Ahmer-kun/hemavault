import { Inject, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { generateOpaqueToken, hashToken } from '../../../common/crypto/token.utils';
import { AppConfigService } from '../../../common/config/app-config.service';
import { AUTH_ACTIONS } from '../domain/auth.constants';
import {
  invalidCredentialsError,
  resetTokenInvalidError,
  verificationTokenInvalidError,
} from '../domain/auth.errors';
import { Argon2PasswordHasher } from '../domain/password-hasher';
import {
  applyLoginFailure,
  computeSessionExpiry,
  isAllowedLoginStatus,
  isUserLocked,
} from '../domain/session-policy';
import { AuthRepository } from '../infrastructure/auth.repository';
import { EMAIL_PROVIDER, EmailProvider } from '../infrastructure/email-provider';
import { SessionRepository } from '../infrastructure/session.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RegisterResult {
  message: string;
}

export interface VerifyEmailResult {
  message: string;
}

export interface LoginResult {
  user: SafeUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  rotated: boolean;
}

export interface SafeUser {
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface ForgotPasswordResult {
  message: string;
}

export interface ResetPasswordResult {
  message: string;
}

export interface LogoutResult {
  message: string;
}

export interface MeResult {
  user: SafeUser;
}

const GENERIC_REGISTER_MESSAGE =
  'Registration accepted. If you are a new user, a verification email has been sent.';
const GENERIC_FORGOT_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly passwordHasher: Argon2PasswordHasher,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly auditService: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async register(email: string, password: string): Promise<RegisterResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await this.passwordHasher.hash(password);
    const tokenValue = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.emailVerifyTokenTtlSeconds * 1000,
    );

    const existing = await this.repository.findUserByEmail(normalizedEmail);
    if (existing) {
      return { message: GENERIC_REGISTER_MESSAGE };
    }

    try {
      const { user } = await this.repository.createUserWithVerification(
        { email: normalizedEmail, passwordHash },
        {
          tokenHash: hashToken(tokenValue),
          expiresAt,
        },
      );
      await this.auditService.record({
        actorUserId: user.id,
        action: AUTH_ACTIONS.REGISTER,
        targetType: 'user',
        targetId: user.id,
      });
    } catch (error) {
      const isUniqueViolation =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002';
      if (!isUniqueViolation) {
        throw error;
      }
      return { message: GENERIC_REGISTER_MESSAGE };
    }

    await this.emailProvider.sendVerificationEmail({
      to: normalizedEmail,
      subject: 'Verify your email address',
      body: `Your verification token is: ${tokenValue}. It expires at ${expiresAt.toISOString()}.`,
      tokenValue,
      expiresAt,
    });

    return { message: GENERIC_REGISTER_MESSAGE };
  }

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    const tokenHash = hashToken(token);
    const record = await this.repository.findEmailVerificationByTokenHash(tokenHash);
    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw verificationTokenInvalidError();
    }
    const user = await this.repository.findUserById(record.userId);
    if (!user) {
      throw verificationTokenInvalidError();
    }
    await this.repository.completeEmailVerification(user.id);

    await this.auditService.record({
      actorUserId: user.id,
      action: AUTH_ACTIONS.EMAIL_VERIFIED,
      targetType: 'user',
      targetId: user.id,
    });

    return { message: 'Email verified. You can now sign in.' };
  }

  async login(
    email: string,
    password: string,
    context: RequestContext,
    currentSessionToken?: string | null,
  ): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    const now = new Date();

    if (!user || !isAllowedLoginStatus(user.status) || isUserLocked(user.lockedUntilAt, now)) {
      await this.auditLoginResult(context, user?.id ?? null, false, null, user?.status ?? null);
      throw invalidCredentialsError();
    }

    const passwordOk = await this.passwordHasher.verify(password, user.passwordHash);
    if (!passwordOk) {
      const lockout = applyLoginFailure(
        user.failedLoginCount,
        now,
        this.config.loginMaxAttempts,
        this.config.loginLockoutSeconds,
      );
      await this.repository.applyLoginFailure(user.id, lockout.lockedUntilAt, lockout.attempts);
      await this.auditLoginResult(context, user.id, false, lockout.lockedUntilAt, user.status);
      throw invalidCredentialsError();
    }

    await this.repository.resetLoginFailure(user.id);

    let rotated = false;
    let rotatedFrom: string | null = null;
    if (currentSessionToken) {
      const existing = await this.sessionRepository.findByTokenHash(hashToken(currentSessionToken));
      if (existing && existing.userId === user.id && existing.revokedAt === null) {
        await this.sessionRepository.rotate(existing.id, user.id, now);
        rotatedFrom = existing.id;
        rotated = true;
      }
    }

    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = computeSessionExpiry(now, this.config.sessionTtlSeconds);
    await this.sessionRepository.create({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      rotatedFromId: rotatedFrom,
      expiresAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    await this.auditService.record({
      actorUserId: user.id,
      action: AUTH_ACTIONS.LOGIN_SUCCESS,
      targetType: 'user',
      targetId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { rotated },
    });

    return {
      user: this.toSafeUser(user),
      sessionToken,
      csrfToken,
      expiresAt,
      rotated,
    };
  }

  async logout(userId: string, sessionId: string, context: RequestContext): Promise<LogoutResult> {
    await this.sessionRepository.revoke(sessionId, new Date());
    await this.auditService.record({
      actorUserId: userId,
      action: AUTH_ACTIONS.LOGOUT,
      targetType: 'session',
      targetId: sessionId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { message: 'Signed out.' };
  }

  async logoutAll(userId: string, context: RequestContext): Promise<LogoutResult> {
    await this.sessionRepository.revokeAllForUser(userId, new Date());
    await this.auditService.record({
      actorUserId: userId,
      action: AUTH_ACTIONS.LOGOUT_ALL,
      targetType: 'user',
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { message: 'All sessions have been signed out.' };
  }

  async forgotPassword(email: string, context: RequestContext): Promise<ForgotPasswordResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (user) {
      const tokenValue = generateOpaqueToken();
      const expiresAt = new Date(
        Date.now() + this.config.passwordResetTokenTtlSeconds * 1000,
      );
      await this.repository.createPasswordResetToken({
        userId: user.id,
        tokenHash: hashToken(tokenValue),
        expiresAt,
      });
      await this.auditService.record({
        action: AUTH_ACTIONS.FORGOT_PASSWORD,
        targetType: 'user',
        targetId: user.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      await this.emailProvider.sendPasswordResetEmail({
        to: normalizedEmail,
        subject: 'Reset your password',
        body: `Your password reset token is: ${tokenValue}. It expires at ${expiresAt.toISOString()}.`,
        tokenValue,
        expiresAt,
      });
    }
    return { message: GENERIC_FORGOT_MESSAGE };
  }

  async resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
    const tokenHash = hashToken(token);
    const record = await this.repository.findPasswordResetByTokenHash(tokenHash);
    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw resetTokenInvalidError();
    }
    const user = await this.repository.findUserById(record.userId);
    if (!user) {
      throw resetTokenInvalidError();
    }
    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.repository.markPasswordResetUsed(record.id);
    await this.repository.resetPasswordAndRevokeSessions(user.id, passwordHash);

    await this.auditService.record({
      actorUserId: user.id,
      action: AUTH_ACTIONS.PASSWORD_RESET,
      targetType: 'user',
      targetId: user.id,
    });

    return { message: 'Password reset. You can now sign in.' };
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw invalidCredentialsError();
    }
    return { user: this.toSafeUser(user) };
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
  }

  private async auditLoginResult(
    context: RequestContext,
    userId: string | null,
    success: boolean,
    lockedUntilAt: Date | null,
    userStatus: string | null,
  ): Promise<void> {
    const action = isUserLocked(lockedUntilAt, new Date())
      ? AUTH_ACTIONS.LOGIN_BLOCKED
      : success
        ? AUTH_ACTIONS.LOGIN_SUCCESS
        : AUTH_ACTIONS.LOGIN_FAILED;
    await this.auditService.record({
      actorUserId: userId,
      action,
      targetType: userId ? 'user' : null,
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { status: userStatus },
    });
  }
}