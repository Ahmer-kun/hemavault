import { Injectable } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { constantTimeEqual, hashToken } from '../../../common/crypto/token.utils';
import { AppConfigService } from '../../../common/config/app-config.service';
import { isSessionLive } from '../domain/session-policy';
import { AuthRepository } from './auth.repository';
import { SessionRecord, SessionRepository } from './session.repository';

const LAST_USED_TOUCH_INTERVAL_MS = 60_000;

export interface AuthenticatedSession {
  user: User;
  sessionId: string;
  csrfValid: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly authRepository: AuthRepository,
    private readonly config: AppConfigService,
  ) {}

  async validate(sessionToken: string, csrfToken: string | null): Promise<AuthenticatedSession | null> {
    const record = await this.sessionRepository.findByTokenHash(hashToken(sessionToken));
    if (!record) {
      return null;
    }
    const now = new Date();
    if (!isSessionLive({ ...record, now, idleSeconds: this.config.sessionIdleSeconds })) {
      return null;
    }
    const user = await this.authRepository.findUserById(record.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      return null;
    }
    const csrfValid = csrfToken !== null && constantTimeEqual(hashToken(csrfToken), record.csrfTokenHash);
    await this.touchIfStale(record);
    return { user, sessionId: record.id, csrfValid };
  }

  private async touchIfStale(record: SessionRecord): Promise<void> {
    if (Date.now() - record.lastUsedAt.getTime() >= LAST_USED_TOUCH_INTERVAL_MS) {
      await this.sessionRepository.touch(record.id, new Date());
    }
  }
}