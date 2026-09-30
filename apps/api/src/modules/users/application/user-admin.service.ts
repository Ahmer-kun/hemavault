import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { globalRoles } from '../../rbac/domain/permission-catalogue';
import {
  RbacRepository,
  FacilityScopeLoad,
} from '../../rbac/infrastructure/rbac.repository';
import { USER_ACTIONS } from '../domain/user-admin.constants';
import {
  invalidRoleScopeError,
  lastSuperAdminError,
  roleAlreadyAssignedError,
  roleAssignmentNotFoundError,
  roleNotFoundError,
  userNotFoundError,
} from '../domain/user-admin.errors';
import { UserAdminRepository, UserListItem } from '../infrastructure/user-admin.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface MeView {
  user: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    createdAt: Date;
  };
  globalRoles: string[];
  memberships: {
    id: string;
    facilityId: string;
    facilityCode: string;
    facilityName: string;
    organizationId: string;
    organizationName: string;
    organizationCode: string;
    status: string;
    role: string;
  }[];
  effectivePermissions: string[];
}

export interface UserListResult {
  items: UserListItem[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class UserAdminService {
  constructor(
    private readonly repository: UserAdminRepository,
    private readonly rbacRepository: RbacRepository,
    private readonly auditService: AuditService,
  ) {}

  async me(userId: string): Promise<MeView> {
    const user = await this.repository.findById(userId);
    if (!user) {
      throw userNotFoundError();
    }
    const [globalRoleCodes, globalPermissions, memberships, facilityScopes] = await Promise.all([
      this.rbacRepository.loadGlobalRoleCodes(userId),
      this.rbacRepository.loadGlobalPermissions(userId),
      this.rbacRepository.loadMemberships(userId),
      this.rbacRepository.loadFacilityScopes(userId),
    ]);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt,
      },
      globalRoles: globalRoleCodes,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        facilityId: membership.facilityId,
        facilityCode: membership.facility.code,
        facilityName: membership.facility.name,
        organizationId: membership.facility.organization.id,
        organizationName: membership.facility.organization.name,
        organizationCode: membership.facility.organization.code,
        status: membership.status,
        role: membership.roleCode,
      })),
      effectivePermissions: this.effectivePermissions(globalPermissions, facilityScopes),
    };
  }

  async updateProfile(
    actor: ActorContext,
    input: { name?: string },
    context: RequestContext,
  ): Promise<MeView> {
    const user = await this.repository.findById(actor.userId);
    if (!user) {
      throw userNotFoundError();
    }
    const normalizedName = input.name !== undefined ? input.name.trim() || null : user.name;
    const updated = await this.repository.updateProfile(actor.userId, normalizedName);
    if (!updated) {
      throw userNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: USER_ACTIONS.PROFILE_UPDATED,
      targetType: 'user',
      targetId: actor.userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { before: { name: user.name }, after: { name: updated.name } },
    });
    return this.me(actor.userId);
  }

  async listUsers(
    actor: ActorContext,
    search: string | null,
    limit: number,
    offset: number,
  ): Promise<UserListResult> {
    void actor;
    const page = await this.repository.findUserPage(search, limit, offset);
    return { items: page.items, total: page.total, limit, offset };
  }

  async assignRole(
    actor: ActorContext,
    targetUserId: string,
    roleCode: string,
    context: RequestContext,
  ): Promise<{ role: string }> {
    const target = await this.repository.findById(targetUserId);
    if (!target) {
      throw userNotFoundError();
    }
    const candidateScopes = globalRoles();
    if (!candidateScopes.includes(roleCode as (typeof candidateScopes)[number])) {
      throw invalidRoleScopeError();
    }
    const role = await this.repository.findRoleByCode(roleCode);
    if (!role) {
      throw roleNotFoundError();
    }
    const existing = await this.repository.findUserRole(targetUserId, role.id);
    if (existing) {
      throw roleAlreadyAssignedError();
    }
    try {
      const assignment = await this.repository.createUserRole(targetUserId, role.id, actor.userId);
      await this.auditService.record({
        actorUserId: actor.userId,
        action: USER_ACTIONS.ROLE_ASSIGNED,
        targetType: 'user',
        targetId: targetUserId,
        organizationId: null,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { roleCode, assignmentId: assignment.id },
      });
      return { role: roleCode };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw roleAlreadyAssignedError();
      }
      throw error;
    }
  }

  async removeRole(
    actor: ActorContext,
    targetUserId: string,
    roleCode: string,
    context: RequestContext,
  ): Promise<{ removed: boolean }> {
    const candidateScopes = globalRoles();
    if (!candidateScopes.includes(roleCode as (typeof candidateScopes)[number])) {
      throw invalidRoleScopeError();
    }
    const role = await this.repository.findRoleByCode(roleCode);
    if (!role) {
      throw roleNotFoundError();
    }
    const assignment = await this.repository.findUserRole(targetUserId, role.id);
    if (!assignment) {
      throw roleAssignmentNotFoundError();
    }
    if (role.code === 'PLATFORM_SUPER_ADMIN') {
      const remaining = await this.repository.countsSuperAdmin(targetUserId);
      if (remaining === 0) {
        throw lastSuperAdminError();
      }
    }
    await this.repository.deleteUserRole(assignment.id);
    await this.auditService.record({
      actorUserId: actor.userId,
      action: USER_ACTIONS.ROLE_REMOVED,
      targetType: 'user',
      targetId: targetUserId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { roleCode, assignmentId: assignment.id },
    });
    return { removed: true };
  }

  private effectivePermissions(
    globalPermissions: string[],
    facilityScopes: FacilityScopeLoad[],
  ): string[] {
    const permissions = new Set(globalPermissions);
    for (const scope of facilityScopes) {
      for (const permission of scope.permissions) {
        permissions.add(permission);
      }
    }
    return [...permissions].sort();
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}