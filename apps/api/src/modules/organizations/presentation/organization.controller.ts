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
import { CurrentActor, RequireAnywhere, RequireGlobal } from '../../rbac/presentation/permissions.decorators';
import type { ActorContext } from '../../rbac/domain/policy';
import {
  OrganizationService,
  OrganizationView,
  OrganizationListResult,
  RequestContext,
} from '../application/organization.service';
import {
  CreateOrganizationDto,
  ListOrganizationsQueryDto,
  UpdateOrganizationDto,
} from './organization.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('organizations')
@Controller('api/v1/organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  @RequireAnywhere('organization.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List organizations visible to the caller.' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListOrganizationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<OrganizationListResult>> {
    const data = await this.organizationService.listOrganizations(actor, query.limit, query.offset);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post()
  @RequireGlobal('organization.manage')
  @UseGuards(CsrfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an organization.' })
  async create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<OrganizationView>> {
    const data = await this.organizationService.createOrganization(actor, body, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Get(':organizationId')
  @RequireAnywhere('organization.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single organization.' })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('organizationId') organizationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<OrganizationView>> {
    const data = await this.organizationService.getOrganization(actor, organizationId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch(':organizationId')
  @RequireGlobal('organization.manage')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an organization.' })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param('organizationId') organizationId: string,
    @Body() body: UpdateOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<OrganizationView>> {
    const data = await this.organizationService.updateOrganization(
      actor,
      organizationId,
      body,
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