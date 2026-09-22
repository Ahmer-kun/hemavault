import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/presentation/auth.guard';
import { HealthService, HealthStatus, readinessHttpStatus } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'Process is alive.' })
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Dependencies are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is unreachable.' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    const result = await this.health.ready();
    res.status(readinessHttpStatus(result));
    return result;
  }
}
