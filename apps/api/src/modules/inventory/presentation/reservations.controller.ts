import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { UUIDParamPipe } from '../../../common/http/uuid-param.pipe';
import type { ActorContext } from '../../rbac/domain/policy';
import { CurrentActor, RequireAnywhere } from '../../rbac/presentation/permissions.decorators';
import { RequestReservationService } from '../application/request-reservation.service';
import { ReleaseReservationDto } from '../dto/release-reservation.dto';

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

@Controller('api/v1/reservations')
export class ReservationsController {
  constructor(private readonly reservations: RequestReservationService) {}

  @Get(':reservationId')
  @RequireAnywhere(['request.read', 'inventory.read'], true)
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('reservationId', UUIDParamPipe) reservationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.getById(actor, reservationId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':reservationId/release')
  @RequireAnywhere(['inventory.release_reservation', 'inventory.reserve'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async release(
    @CurrentActor() actor: ActorContext,
    @Param('reservationId', UUIDParamPipe) reservationId: string,
    @Body() body: ReleaseReservationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.release(actor, reservationId, body?.reason?.trim() || null, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':reservationId/confirm')
  @RequireAnywhere(['inventory.reserve', 'inventory.release_reservation'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async confirm(
    @CurrentActor() actor: ActorContext,
    @Param('reservationId', UUIDParamPipe) reservationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.confirm(actor, reservationId, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':reservationId/cancel')
  @RequireAnywhere(['inventory.release_reservation', 'inventory.reserve'], true)
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param('reservationId', UUIDParamPipe) reservationId: string,
    @Body() body: ReleaseReservationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.reservations.cancel(actor, reservationId, body?.reason?.trim() || null, ctx(req));
    return { data, meta: { requestId: req.requestId } };
  }
}
