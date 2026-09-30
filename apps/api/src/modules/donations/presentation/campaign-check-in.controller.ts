import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import type { ActorContext } from '../../rbac/domain/policy';
import {
  RequireAnywhere,
  CurrentActor,
} from '../../rbac/presentation/permissions.decorators';
import {
  CampaignCheckInView,
  DonationService,
  RequestContext,
} from '../application/donation.service';
import { CampaignCheckInBodyDto } from './donation.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('campaigns')
@Controller('api/v1/campaigns')
export class CampaignCheckInController {
  constructor(private readonly donationService: DonationService) {}

  @Post(':campaignId/check-ins')
  @RequireAnywhere('donation.update')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check in a registered donor at a campaign drive; creates the donation (staff). Idempotent.',
  })
  async checkIn(
    @CurrentActor() actor: ActorContext,
    @Param('campaignId') campaignId: string,
    @Body() body: CampaignCheckInBodyDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<CampaignCheckInView>> {
    const data = await this.donationService.campaignCheckIn(
      actor,
      campaignId,
      body.donorReference,
      this.context(req),
    );
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