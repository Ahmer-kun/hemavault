import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { UUIDParamPipe } from '../../../common/http/uuid-param.pipe';
import type { ActorContext } from '../../rbac/domain/policy';
import { CurrentActor, RequireAnywhere } from '../../rbac/presentation/permissions.decorators';
import { TransferService, TransferContext } from '../application/transfer.service';
import { CreateTransferDto } from '../dto/create-transfer.dto';
import { ListTransfersQueryDto } from '../dto/list-transfers.query.dto';
import { RejectTransferDto } from '../dto/reject-transfer.dto';
import { CancelTransferDto } from '../dto/cancel-transfer.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

function ctx(req: AuthenticatedRequest): TransferContext {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers?.['user-agent'] as string) ?? null,
  };
}

@Controller('api/v1/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransferService) {}

  @Post()
  @RequireAnywhere('transfer.create')
  @UseGuards(CsrfGuard)
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.create(
      actor,
      {
        sourceFacilityId: dto.sourceFacilityId,
        destinationFacilityId: dto.destinationFacilityId,
        unitIds: dto.unitIds,
        notes: dto.notes ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
      ctx(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get()
  @RequireAnywhere('transfer.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListTransfersQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.list(actor, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':transferId')
  @RequireAnywhere('transfer.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.getById(actor, transferId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/approve')
  @RequireAnywhere('transfer.approve')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async approve(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.approve(actor, transferId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/reject')
  @RequireAnywhere('transfer.approve')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async reject(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Body() dto: RejectTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.reject(actor, transferId, dto.reason, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/pack')
  @RequireAnywhere('transfer.pack')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async pack(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.pack(actor, transferId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/dispatch')
  @RequireAnywhere('transfer.dispatch')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async dispatch(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.dispatch(actor, transferId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/receive')
  @RequireAnywhere('transfer.receive')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async receive(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.receive(actor, transferId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':transferId/cancel')
  @RequireAnywhere('transfer.cancel')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param('transferId', UUIDParamPipe) transferId: string,
    @Body() dto: CancelTransferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.transfers.cancel(actor, transferId, dto?.reason ?? null, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }
}
