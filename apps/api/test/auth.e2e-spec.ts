import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../src/modules/auth/infrastructure/email-provider';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/domain/auth.constants';
import { DevConsoleEmailProvider } from '../src/modules/auth/infrastructure/dev-email-provider';

const PASSWORD = 'correct-horse-battery-staple';
const EMAIL_DOMAIN = 'e2e-blood-ops.invalid';
const stamp = Date.now().toString(36);
const makeEmail = (label: string): string => `${label}-${stamp}@${EMAIL_DOMAIN}`;

function sessionCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const pair = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) throw new Error('session cookie not set');
  const separator = pair.indexOf(';');
  return separator >= 0 ? pair.slice(0, separator) : pair;
}

function csrfOf(res: request.Response): string {
  return res.body.data.csrfToken as string;
}

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: DevConsoleEmailProvider;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    provider = app.get<EmailProvider>(EMAIL_PROVIDER) as DevConsoleEmailProvider;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent" WHERE "actorUserId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@${EMAIL_DOMAIN}');`,
    );
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
    await app.close();
  });

  const lastToken = (): string => {
    const last = provider.outbox[provider.outbox.length - 1];
    if (!last?.tokenValue) throw new Error('no email captured');
    return last.tokenValue;
  };

  async function registerUser(email: string): Promise<{ token: string }> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { token: lastToken() };
  }

  async function verifiedUser(email: string): Promise<void> {
    const { token } = await registerUser(email);
    await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
  }

  describe('registration + verification', () => {
    it('creates a PENDING user and stores a real password hash', async () => {
      const email = makeEmail('reg');
      await registerUser(email);
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).toBeTruthy();
      expect(user?.status).toBe(UserStatus.PENDING_VERIFICATION);
      expect(user?.passwordHash).not.toBe(PASSWORD);
      expect(user?.passwordHash.startsWith('$argon2id')).toBe(true);
    });

    it('activates the account after token verification', async () => {
      const email = makeEmail('verify');
      await verifiedUser(email);
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.status).toBe(UserStatus.ACTIVE);
      expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('returns the generic message for duplicate registration (anti-enumeration)', async () => {
      const email = makeEmail('dup');
      await registerUser(email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.body.data.message).toContain('verification email');
    });
  });

  describe('login + sessions', () => {
    it('signs in a verified user, sets an httpOnly cookie and returns a csrf token', async () => {
      const email = makeEmail('login');
      await verifiedUser(email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.csrfToken).toBeTruthy();
      const pair = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('blood_ops_session='),
      );
      expect(pair).toContain('HttpOnly');
      expect(pair).toContain('SameSite=Lax');
    }, 20000);

    it('rejects wrong and unknown credentials with the identical generic error', async () => {
      const email = makeEmail('enum');
      await verifiedUser(email);
      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'totally-wrong-password!' })
        .expect(401);
      const unknown = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: makeEmail('ghost'), password: PASSWORD })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    }, 20000);

    it('returns the current user when authenticated and 401 without a session', async () => {
      const email = makeEmail('me');
      await verifiedUser(email);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = sessionCookie(login);
      const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.body.data.user.email).toBe(email);
      expect(me.body.data.user.passwordHash).toBeUndefined();
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('locks the account after 5 failed attempts even with the correct password', async () => {
      const email = makeEmail('lock');
      await verifiedUser(email);
      for (let i = 0; i < 5; i += 1) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'definitely-not-right!' })
          .expect(401);
      }
      const locked = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      expect(locked.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('CSRF and logout', () => {
    it('rejects a state-changing call without the csrf header', async () => {
      const email = makeEmail('csrf');
      await verifiedUser(email);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = sessionCookie(login);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_VIOLATION');
    });

    it('logs out with a valid csrf token and revokes the session', async () => {
      const email = makeEmail('logout');
      await verifiedUser(email);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = sessionCookie(login);
      const csrf = csrfOf(login);
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .expect(200);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('password reset', () => {
    it('resets the password, revokes sessions, and consumes the token', async () => {
      const email = makeEmail('reset');
      await verifiedUser(email);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = sessionCookie(login);

      const forgot = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email });
      expect(forgot.status).toBe(200);
      expect(forgot.body.data.message).toContain('If an account exists');
      const token = lastToken();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'new-horse-battery-staple' })
        .expect(200);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);

      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'again-horse-battery-staple' })
        .expect(400);
      expect(replay.body.error.code).toBe('INVALID_RESET_TOKEN');
    });
  });

  describe('audit trail', () => {
    it('records hashed audit events for register and login', async () => {
      const email = makeEmail('audit');
      await verifiedUser(email);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const actionsForUser = await prisma.auditEvent.findMany({
        where: { actorUser: { email } },
        orderBy: { occurredAt: 'asc' },
      });
      const actions = actionsForUser.map((e) => e.action);
      expect(actions).toContain('auth.register');
      expect(actions).toContain('auth.email_verified');
      expect(actions).toContain('auth.login_success');
      for (const event of actionsForUser) {
        expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe('rate limiting', () => {
    it('returns 429 after exceeding the per-account register limit', async () => {
      const email = makeEmail('rl');
      let status = 0;
      for (let i = 0; i < 12; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: PASSWORD });
        status = res.status;
      }
      expect(status).toBe(429);
    });
  });
});