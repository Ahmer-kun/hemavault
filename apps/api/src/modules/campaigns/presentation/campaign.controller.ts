import {
  Body,
  Controller,
  Delete,
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
  CampaignPageResult,
  CampaignService,
  CampaignView,
  RegistrationView,
  RequestContext,
} from '../application/campaign.service';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  RegisterCampaignDto,
  UpdateCampaignDto,
} from './campaign.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('campaigns')
@Controller('api/v1/campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List campaigns (staff see scoped/all; donors see published only).' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListCampaignsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignPageResult>> {
    const data = await this.campaignService.listCampaigns(actor, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':campaignId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single campaign.' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignView>> {
    const data = await this.campaignService.getCampaign(actor, campaignId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post()
  @RequireAnywhere('campaign.create')
  @UseGuards(CsrfGuard)
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a campaign (staff).' })
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignView>> {
    const data = await this.campaignService.createCampaign(
      actor,
      {
        facilityId: body.facilityId,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        ...(body.targetUnits !== undefined ? { targetUnits: body.targetUnits } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch(':campaignId')
  @RequireAnywhere('campaign.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a campaign or transition its status (staff).' })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Body() body: UpdateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignView>> {
    const data = await this.campaignService.updateCampaign(
      actor,
      campaignId,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description === '' ? null : body.description } : {}),
        ...(body.location !== undefined ? { location: body.location === '' ? null : body.location } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.targetUnits !== undefined ? { targetUnits: body.targetUnits } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':campaignId/publish')
  @RequireAnywhere('campaign.publish')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a campaign (staff).' })
  async publish(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignView>> {
    const data = await this.campaignService.publishCampaign(actor, campaignId, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':campaignId/cancel')
  @RequireAnywhere('campaign.cancel')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a campaign (staff).' })
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignView>> {
    const data = await this.campaignService.cancelCampaign(actor, campaignId, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':campaignId/registrations')
  @UseGuards(CsrfGuard)
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Book a registration for the signed-in donor.' })
  async register(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Body() body: RegisterCampaignDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<RegistrationView>> {
    // donorReference is reserved for staff-assisted check-in-era flows; self-service always books for the acting donor.
    void body;
    const data = await this.campaignService.registerForCampaign(actor, campaignId, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Delete(':campaignId/registrations/:registrationId')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a registration (owner or staff with manage_registrations).' })
  async cancelRegistration(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Param('registrationId') registrationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<RegistrationView>> {
    const data = await this.campaignService.cancelRegistration(
      actor,
      campaignId,
      registrationId,
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':campaignId/registrations')
  @RequireAnywhere('campaign.manage_registrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List registrations for a campaign (staff).' })
  async listRegistrations(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<RegistrationView[]>> {
    const data = await this.campaignService.listRegistrations(actor, campaignId);
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