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
  CurrentActor,
  RequireAnywhere,
  RequireFacilityScope,
  RequireGlobal,
} from '../../rbac/presentation/permissions.decorators';
import {
  FacilityListResult,
  FacilityService,
  FacilityView,
  MembershipListResult,
  RequestContext,
} from '../application/facility.service';
import {
  AddMemberDto,
  CreateFacilityDto,
  PageQueryDto,
  UpdateFacilityDto,
} from './facility.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('facilities')
@Controller('api/v1/facilities')
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Get()
  @RequireAnywhere('facility.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List facilities visible to the caller.' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: PageQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<FacilityListResult>> {
    const data = await this.facilityService.listFacilities(actor, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post()
  @RequireGlobal(['organization.manage', 'facility.manage'], true)
  @UseGuards(CsrfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a facility under an organization.' })
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateFacilityDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<FacilityView>> {
    const data = await this.facilityService.createFacility(actor, body, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':facilityId')
  @RequireFacilityScope('facility.read', 'facilityId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single facility.' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('facilityId') facilityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<FacilityView>> {
    const data = await this.facilityService.getFacility(actor, facilityId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch(':facilityId')
  @RequireFacilityScope('facility.manage', 'facilityId')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a facility.' })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param('facilityId') facilityId: string,
    @Body() body: UpdateFacilityDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<FacilityView>> {
    const data = await this.facilityService.updateFacility(
      actor,
      facilityId,
      body,
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':facilityId/members')
  @RequireFacilityScope(['facility.manage_members', 'facility.read'], 'facilityId', true)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List memberships for a facility.' })
  async members(
    @CurrentActor() actor: ActorContext,
    @Param('facilityId') facilityId: string,
    @Query() query: PageQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<MembershipListResult>> {
    const data = await this.facilityService.listMembers(actor, facilityId, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':facilityId/members')
  @RequireFacilityScope('facility.manage_members', 'facilityId')
  @UseGuards(CsrfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a member to a facility.' })
  async addMember(
    @CurrentActor() actor: ActorContext,
    @Param('facilityId') facilityId: string,
    @Body() body: AddMemberDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ membership: MembershipListResult['items'][number] }>> {
    const data = await this.facilityService.addMember(
      actor,
      facilityId,
      body.userId,
      body.role,
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Delete(':facilityId/members/:memberId')
  @RequireFacilityScope('facility.manage_members', 'facilityId')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a member from a facility.' })
  async removeMember(
    @CurrentActor() actor: ActorContext,
    @Param('facilityId') facilityId: string,
    @Param('memberId') memberId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ removed: boolean }>> {
    const data = await this.facilityService.removeMember(
      actor,
      facilityId,
      memberId,
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