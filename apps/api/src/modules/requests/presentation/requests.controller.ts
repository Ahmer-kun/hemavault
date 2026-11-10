import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { RequestService, RequestContext } from '../application/request.service';
import { MatchingService } from '../../matching/application/matching.service';
import { RequestMatchesQueryDto } from '../../matching/dto/request-matches.query.dto';
import { RequestReservationService } from '../../inventory/application/request-reservation.service';
import { CreateRequestReservationDto } from '../../inventory/dto/create-request-reservation.dto';
import { CreateRequestDto } from '../dto/create-request.dto';
import { UpdateRequestDto } from '../dto/update-request.dto';
import { RejectRequestDto } from '../dto/reject-request.dto';
import { CancelRequestDto } from '../dto/cancel-request.dto';
import { ListRequestsQueryDto } from '../dto/list-requests.query.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

function ctx(req: AuthenticatedRequest): RequestContext {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

@Controller('api/v1/requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestService,
    private readonly matching: MatchingService,
    private readonly reservations: RequestReservationService,
  ) {}

  @Post()
  @RequireAnywhere('request.self.create')
  @UseGuards(CsrfGuard)
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.create(actor, dto, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Get()
  @RequireAnywhere('request.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListRequestsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.list(actor, {
      status: query.status,
      urgency: query.urgency,
      limit: query.limit,
      offset: query.offset,
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':requestId')
  @RequireAnywhere('request.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.get(actor, requestId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':requestId/matches')
  @RequireAnywhere('request.read')
  async matches(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Query() query: RequestMatchesQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.matching.getMatches(actor, requestId, {
      limitPerLine: query.limitPerLine,
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':requestId/reservations')
  @RequireAnywhere(['inventory.reserve', 'request.fulfill'], true)
  @UseGuards(CsrfGuard)
  async createReservation(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Body() dto: CreateRequestReservationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.createForRequest(
      actor,
      { requestId, items: dto.items, idempotencyKey: dto.idempotencyKey ?? null },
      { requestId: req.requestId, ipAddress: req.ip ?? null, userAgent: (req.headers?.['user-agent'] as string) ?? null },
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':requestId/reservations')
  @RequireAnywhere(['request.read', 'inventory.read'], true)
  async listReservations(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.listForRequest(actor, requestId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch(':requestId')
  @RequireAnywhere(['request.self.create', 'request.approve'], true)
  @UseGuards(CsrfGuard)
  async update(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Body() dto: UpdateRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.update(actor, requestId, dto, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':requestId/submit')
  @RequireAnywhere(['request.self.create', 'request.approve', 'request.review'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async submit(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.submit(actor, requestId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':requestId/approve')
  @RequireAnywhere('request.approve')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async approve(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.approve(actor, requestId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':requestId/reject')
  @RequireAnywhere('request.reject')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async reject(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Body() dto: RejectRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.reject(actor, requestId, dto, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':requestId/cancel')
  @RequireAnywhere(['request.cancel', 'request.self.create'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param('requestId', UUIDParamPipe) requestId: string,
    @Body() dto: CancelRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.requests.cancel(actor, requestId, dto ?? {}, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }
}
