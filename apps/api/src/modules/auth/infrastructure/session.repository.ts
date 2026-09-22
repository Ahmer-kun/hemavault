import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

export interface NewSessionInput {
  userId: string;
  tokenHash: string;
  csrfTokenHash: string;
  rotatedFromId?: string | null;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfTokenHash: string;
  rotatedFromId: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NewSessionInput): Promise<SessionRecord> {
    const created = await this.prisma.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        csrfTokenHash: input.csrfTokenHash,
        rotatedFromId: input.rotatedFromId ?? null,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return this.toRecord(created);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const found = await this.prisma.session.findUnique({
      where: { tokenHash },
    });
    return found ? this.toRecord(found) : null;
  }

  async touch(sessionId: string, lastUsedAt: Date): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastUsedAt },
    });
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt },
    });
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async rotate(sessionId: string, userId: string, revokedAt: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  private toRecord(row: SessionRecord): SessionRecord {
    return { ...row };
  }
}