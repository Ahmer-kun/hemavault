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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import type { ActorContext } from '../../rbac/domain/policy';
import {
  RequireAnywhere,
  CurrentActor,
} from '../../rbac/presentation/permissions.decorators';
import {
  DeferralView,
  DonorDonationView,
  DonorListResult,
  DonorProfileView,
  DonorService,
  RequestContext,
} from '../application/donor.service';
import {
  CreateDeferralDto,
  ListDonorDonationsQueryDto,
  ListDonorsQueryDto,
  ResolveDeferralDto,
  UpdateDonorDto,
  UpdateOwnProfileDto,
} from './donor.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('donors')
@Controller('api/v1/donors')
export class DonorController {
  constructor(private readonly donorService: DonorService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get your own donor profile (created on first access).' })
  async me(
    @CurrentActor() actor: ActorContext,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonorProfileView>> {
    const data = await this.donorService.getSelfProfile(actor, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch('me')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own donor profile.' })
  async updateMe(
    @CurrentActor() actor: ActorContext,
    @Body() body: UpdateOwnProfileDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonorProfileView>> {
    const dateOfBirth = body.dateOfBirth === null ? null : body.dateOfBirth ? new Date(body.dateOfBirth) : undefined;
    const data = await this.donorService.updateSelfProfile(
      actor,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
        ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('me/donations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List your own donation history.' })
  async myDonations(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListDonorDonationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ items: DonorDonationView[]; total: number }>> {
    const data = await this.donorService.listSelfDonations(actor, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get()
  @RequireAnywhere('donor.search')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search donors visible to the caller (facility-aware).' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListDonorsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonorListResult>> {
    const data = await this.donorService.searchDonors(
      actor,
      query.search?.trim() || null,
      query.limit,
      query.offset,
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':donorId')
  @RequireAnywhere('donor.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single donor record (staff).' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonorProfileView>> {
    const data = await this.donorService.getDonor(actor, donorId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':donorId/donations')
  @RequireAnywhere('donation.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List a donor\u2019s donation history (staff).' })
  async donorDonations(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Query() query: ListDonorDonationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ items: DonorDonationView[]; total: number }>> {
    const data = await this.donorService.getDonorDonations(actor, donorId, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch(':donorId')
  @RequireAnywhere('donor.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a donor record (staff).' })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Body() body: UpdateDonorDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DonorProfileView>> {
    const dateOfBirth = body.dateOfBirth === null ? null : body.dateOfBirth ? new Date(body.dateOfBirth) : undefined;
    const data = await this.donorService.updateDonor(
      actor,
      donorId,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
        ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donorId/deferrals')
  @RequireAnywhere('donor.update')
  @UseGuards(CsrfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a donor deferral (staff).' })
  async createDeferral(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Body() body: CreateDeferralDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DeferralView>> {
    const data = await this.donorService.createDeferral(
      actor,
      donorId,
      {
        reasonCode: body.reasonCode,
        ...(body.reasonNote !== undefined ? { reasonNote: body.reasonNote } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':donorId/deferrals/:deferralId/resolve')
  @RequireAnywhere('donor.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve a donor deferral (staff).' })
  async resolveDeferral(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Param('deferralId') deferralId: string,
    @Body() body: ResolveDeferralDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DeferralView>> {
    const data = await this.donorService.resolveDeferral(
      actor,
      donorId,
      deferralId,
      { ...(body.resolutionNote !== undefined ? { resolutionNote: body.resolutionNote } : {}) },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':donorId/deferrals')
  @RequireAnywhere('donor.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List a donor\u2019s deferrals (staff).' })
  async listDeferrals(
    @CurrentActor() actor: ActorContext,
    @Param('donorId') donorId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<DeferralView[]>> {
    const data = await this.donorService.listDeferrals(actor, donorId);
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