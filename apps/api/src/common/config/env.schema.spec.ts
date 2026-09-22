import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('accepts a complete configuration and coerces values', () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      API_PORT: '3100',
      API_HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      WEB_ORIGIN: 'http://localhost:5173',
      SESSION_TTL_SECONDS: '7200',
      COOKIE_SECURE: 'true',
    });
    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(3100);
    expect(env.API_HOST).toBe('127.0.0.1');
    expect(env.DATABASE_URL).toContain('5432');
    expect(env.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(env.SESSION_TTL_SECONDS).toBe(7200);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(env.SESSION_TTL_SECONDS).toBe(604800);
    expect(env.SESSION_IDLE_SECONDS).toBe(3600);
    expect(env.PASSWORD_MIN_LENGTH).toBe(12);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric port', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', API_PORT: 'abc' }),
    ).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });
});
