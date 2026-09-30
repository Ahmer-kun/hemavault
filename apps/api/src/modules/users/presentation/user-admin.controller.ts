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
import { CurrentActor, RequireGlobal } from '../../rbac/presentation/permissions.decorators';
import { MeView, RequestContext, UserAdminService } from '../application/user-admin.service';
import { UserListResult } from '../application/user-admin.service';
import {
  AssignRoleDto,
  ListUsersQueryDto,
  UpdateProfileDto,
} from './user-admin.dto';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@ApiTags('users')
@Controller('api/v1/users')
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile with roles and memberships.' })
  async me(
    @CurrentActor() actor: ActorContext,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<MeView>> {
    const data = await this.userAdminService.me(actor.userId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Patch('me')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the authenticated user profile.' })
  async updateMe(
    @CurrentActor() actor: ActorContext,
    @Body() body: UpdateProfileDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<MeView>> {
    const data = await this.userAdminService.updateProfile(actor, body, this.context(req));
    return { data, meta: { requestId: req.requestId } };
  }

  @Get()
  @RequireGlobal('user.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List platform users (platform admin).' })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListUsersQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<UserListResult>> {
    const data = await this.userAdminService.listUsers(
      actor,
      query.search?.trim() || null,
      query.limit,
      query.offset,
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':userId/roles')
  @RequireGlobal('user.manage_roles')
  @UseGuards(CsrfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a global role to a user (platform admin).' })
  async assignRole(
    @CurrentActor() actor: ActorContext,
    @Param('userId') userId: string,
    @Body() body: AssignRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ role: string }>> {
    const data = await this.userAdminService.assignRole(
      actor,
      userId,
      body.role.trim().toUpperCase(),
      this.context(req),
    );
    return { data, meta: { requestId: req.requestId } };
  }

  @Delete(':userId/roles/:roleCode')
  @RequireGlobal('user.manage_roles')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a global role from a user (platform admin).' })
  async removeRole(
    @CurrentActor() actor: ActorContext,
    @Param('userId') userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ removed: boolean }>> {
    const data = await this.userAdminService.removeRole(
      actor,
      userId,
      roleCode.trim().toUpperCase(),
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