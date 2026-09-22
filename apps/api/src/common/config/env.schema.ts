import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']);

export const envSchema = z.object({
  NODE_ENV: nodeEnv.default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 3600),
  SESSION_IDLE_SECONDS: z.coerce.number().int().positive().default(3600),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().positive().default(12),
  PASSWORD_MAX_LENGTH: z.coerce.number().int().positive().default(128),
  EMAIL_VERIFY_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 3600),
  PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  COOKIE_SECURE: z.string().default('false').transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${issues.join('; ')}`);
  }
  return parsed.data;
}
