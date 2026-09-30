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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { HttpStatus } from '@nestjs/common';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import type { ActorContext } from '../../rbac/domain/policy';
import {
  RequireAnywhere,
  CurrentActor,
} from '../../rbac/presentation/permissions.decorators';
import {
  DonationPageResult,
  DonationService,
  DonationView,
  RequestContext,
} from '../application/donation.service';
import {
  CollectDonationDto,
  CreateDonationDto,
  ListDonationsQueryDto,
  RejectDonationDto,
  ScreenDonationDto,
} from './donation.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('donations')
@Controller('api/v1/donations')
export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  @Post()
  @RequireAnywhere('donation.create')
  @UseGuards(CsrfGuard)
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a scheduled donation for a donor (staff).' })
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateDonationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    if (!body.donorProfileId && !body.donorReference) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        'DONOR_REQUIRED',
        'Either donorProfileId or donorReference is required.',
      );
    }
    const data = await this.donationService.create(
      actor,
      {
        facilityId: body.facilityId,
        ...(body.donorProfileId !== undefined ? { donorProfileId: body.donorProfileId } : {}),
        ...(body.donorReference !== undefined ? { donorReference: body.donorReference } : {}),
        ...(body.scheduledFor !== undefined ? { scheduledFor: new Date(body.scheduledFor) } : {}),
        ...(body.volumeMl !== undefined ? { volumeMl: body.volumeMl } : {}),
        ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get()
  @RequireAnywhere('donation.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List donations visible to the caller (staff).' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListDonationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationPageResult>> {
    const data = await this.donationService.list(actor, query.state ?? null, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':donationId')
  @RequireAnywhere('donation.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single donation (staff).' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.get(actor, donationId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donationId/check-in')
  @RequireAnywhere('donation.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check in a scheduled donation (staff); idempotent.' })
  async checkIn(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.checkIn(actor, donationId, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donationId/collect')
  @RequireAnywhere('donation.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record collection volume and verified blood group (staff).' })
  async collect(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Body() body: CollectDonationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.collect(
      actor,
      donationId,
      { volumeMl: body.volumeMl, bloodGroup: body.bloodGroup },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donationId/screen')
  @RequireAnywhere('donation.screen')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open screening (COLLECTED) or record a PASS decision (SCREENING) (staff).' })
  async screen(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Body() body: ScreenDonationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.screen(
      actor,
      donationId,
      {
        ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.decision !== undefined ? { decision: body.decision } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donationId/reject')
  @RequireAnywhere('donation.reject')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a donation from SCREENING or QUARANTINED (staff).' })
  async reject(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Body() body: RejectDonationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.reject(
      actor,
      donationId,
      {
        reasonCode: body.reasonCode,
        ...(body.reasonNote !== undefined ? { reasonNote: body.reasonNote } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donationId/release')
  @RequireAnywhere('donation.release')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Release a quarantined donation (staff).' })
  async release(
    @CurrentActor() actor: ActorContext,
    @Param('donationId') donationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonationView>> {
    const data = await this.donationService.release(actor, donationId, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  private context(req: AuthenticatedRequest): RequestContext {
    return {
      requestId: req.requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }
}