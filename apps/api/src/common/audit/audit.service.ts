import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  organizationId?: string | null;
  facilityId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

function canonicalize(metadata: Record<string, unknown> | null | undefined): string | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const sorted = Object.keys(metadata)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = metadata[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

export function computeAuditHash(
  prevHash: string | null,
  event: Omit<AuditEventInput, 'metadata'> & {
    metadataSerialized: string | null;
    occurredAtIso: string;
  },
): string {
  const payload = [
    prevHash ?? '',
    event.action,
    event.actorUserId ?? '',
    event.targetType ?? '',
    event.targetId ?? '',
    event.organizationId ?? '',
    event.facilityId ?? '',
    event.requestId ?? '',
    event.ipAddress ?? '',
    event.userAgent ?? '',
    event.metadataSerialized ?? '',
    event.occurredAtIso,
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditEventInput): Promise<void> {
    const occurredAt = new Date();
    const metadataSerialized = canonicalize(input.metadata);
    const previous = await this.findLatest();
    const prevHash = previous ? previous.hash : null;
    const hash = computeAuditHash(prevHash, {
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      organizationId: input.organizationId ?? null,
      facilityId: input.facilityId ?? null,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadataSerialized,
      occurredAtIso: occurredAt.toISOString(),
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        organizationId: input.organizationId ?? null,
        facilityId: input.facilityId ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: metadataSerialized as Prisma.InputJsonValue | undefined,
        occurredAt,
        prevHash,
        hash,
      },
    });
  }

  private async findLatest(): Promise<{ hash: string } | null> {
    const latest = await this.prisma.auditEvent.findFirst({
      orderBy: { occurredAt: 'desc' },
      select: { id: true, hash: true },
    });
    if (!latest) {
      return null;
    }
    return { hash: latest.hash };
  }
}