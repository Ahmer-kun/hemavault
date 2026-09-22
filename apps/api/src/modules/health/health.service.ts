import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

export interface HealthStatus {
  status: 'ok' | 'error';
  checks: {
    database: 'up' | 'down';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  live(): Pick<HealthStatus, 'status'> {
    return { status: 'ok' };
  }

  async ready(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'up' } };
    } catch (error) {
      this.logger.error(
        'Readiness probe failed: database unreachable',
        error instanceof Error ? error.stack : undefined,
      );
      return { status: 'error', checks: { database: 'down' } };
    }
  }
}

export function readinessHttpStatus(status: HealthStatus): HttpStatus {
  return status.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
}
