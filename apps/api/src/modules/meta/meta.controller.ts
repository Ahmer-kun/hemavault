import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/presentation/auth.guard';

interface MetaEnvelope {
  data: {
    name: string;
    version: string;
    environment: string;
  };
  meta: {
    requestId: string;
  };
}

@ApiTags('system')
@Public()
@Controller('api/v1')
export class MetaController {
  @Get('meta')
  @ApiOkResponse({ description: 'Platform identification and current environment.' })
  meta(@Req() req: Request): MetaEnvelope {
    return {
      data: {
        name: 'blood-ops',
        version: process.env['npm_package_version'] ?? '0.1.0',
        environment: process.env['NODE_ENV'] ?? 'development',
      },
      meta: {
        requestId: req.requestId,
      },
    };
  }
}
