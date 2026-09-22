import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get sessionTtlSeconds(): number {
    return this.config.getOrThrow<number>('SESSION_TTL_SECONDS');
  }

  get sessionIdleSeconds(): number {
    return this.config.getOrThrow<number>('SESSION_IDLE_SECONDS');
  }

  get passwordMinLength(): number {
    return this.config.getOrThrow<number>('PASSWORD_MIN_LENGTH');
  }

  get passwordMaxLength(): number {
    return this.config.getOrThrow<number>('PASSWORD_MAX_LENGTH');
  }

  get emailVerifyTokenTtlSeconds(): number {
    return this.config.getOrThrow<number>('EMAIL_VERIFY_TOKEN_TTL_SECONDS');
  }

  get passwordResetTokenTtlSeconds(): number {
    return this.config.getOrThrow<number>('PASSWORD_RESET_TOKEN_TTL_SECONDS');
  }

  get loginMaxAttempts(): number {
    return this.config.getOrThrow<number>('LOGIN_MAX_ATTEMPTS');
  }

  get loginLockoutSeconds(): number {
    return this.config.getOrThrow<number>('LOGIN_LOCKOUT_SECONDS');
  }

  get cookieSecure(): boolean {
    return this.config.getOrThrow<boolean>('COOKIE_SECURE');
  }

  get webOrigin(): string {
    return this.config.getOrThrow<string>('WEB_ORIGIN');
  }
}