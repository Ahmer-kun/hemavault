import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { UUIDParamPipe } from '../../../common/http/uuid-param.pipe';
import type { ActorContext } from '../../rbac/domain/policy';
import { CurrentActor, RequireAnywhere } from '../../rbac/presentation/permissions.decorators';
import { IssuanceService } from '../application/issuance.service';
import { CreateIssuanceDto } from '../dto/create-issuance.dto';
import { CancelIssuanceDto } from '../dto/cancel-issuance.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

function ctx(req: AuthenticatedRequest) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers?.['user-agent'] as string) ?? null,
  };
}

@Controller('api/v1')
export class IssuancesController {
  constructor(private readonly issuance: IssuanceService) {}

  @Post('requests/:requestId/issuances')
  @RequireAnywhere(['inventory.issue', 'request.fulfill'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(201)
  async create(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Body() dto: CreateIssuanceDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.issuance.create(
      actor,
      requestId,
      {
        items: dto.items,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
      ctx(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('requests/:requestId/issuances')
  @RequireAnywhere(['request.read', 'inventory.read'], true)
  async listForRequest(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.issuance.listForRequest(actor, requestId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('issuances/:issuanceId')
  @RequireAnywhere(['request.read', 'inventory.read'], true)
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('issuanceId', UUIDParamPipe) issuanceId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.issuance.getById(actor, issuanceId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('issuances/:issuanceId/confirm')
  @RequireAnywhere(['inventory.issue', 'request.fulfill'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async confirm(
    @CurrentActor() actor: ActorContext,
    @Param('issuanceId', UUIDParamPipe) issuanceId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.issuance.confirm(actor, issuanceId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('issuances/:issuanceId/cancel')
  @RequireAnywhere(['inventory.issue', 'request.fulfill'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param('issuanceId', UUIDParamPipe) issuanceId: string,
    @Body() dto: CancelIssuanceDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.issuance.cancel(actor, issuanceId, dto?.reason?.trim() || null, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }
}
