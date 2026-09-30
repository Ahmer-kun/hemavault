import { Injectable } from '@nestjs/common';
import {
  Facility,
  FacilityStatus,
  FacilityType,
  MembershipStatus,
  OrganizationStatus,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { RbacService } from '../../rbac/application/rbac.service';
import { facilityRoles } from '../../rbac/domain/permission-catalogue';
import { FACILITY_ACTIONS } from '../domain/facility.constants';
import {
  facilityCodeConflictError,
  facilityNotFoundError,
  invalidMembershipRoleError,
  membershipConflictError,
  membershipNotFoundError,
  organizationInactiveError,
  organizationNotFoundError,
  targetUserInactiveError,
  targetUserNotFoundError,
} from '../domain/facility.errors';
import { FacilityMembershipView, FacilityRepository } from '../infrastructure/facility.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface FacilityView {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  createdAt: Date;
  updatedAt: Date;
  organization: { id: string; name: string; code: string; status: string };
}

export interface FacilityListResult {
  items: FacilityView[];
  total: number;
  limit: number;
  offset: number;
}

export interface MembershipListResult {
  items: FacilityMembershipView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class FacilityService {
  constructor(
    private readonly repository: FacilityRepository,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
  ) {}

  async createFacility(
    actor: ActorContext,
    input: {
      organizationId: string;
      code: string;
      name: string;
      type: FacilityType;
      contactEmail?: string;
      contactPhone?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: string;
    },
    context: RequestContext,
  ): Promise<FacilityView> {
    const organization = await this.repository.findOrganizationState(input.organizationId);
    if (!organization) {
      throw organizationNotFoundError();
    }
    if (organization.status !== OrganizationStatus.ACTIVE) {
      throw organizationInactiveError();
    }
    try {
      const created = await this.repository.create({
        organization: { connect: { id: input.organizationId } },
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        type: input.type,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
        region: input.region || null,
        postalCode: input.postalCode || null,
        country: input.country || null,
      });
      const view = (await this.repository.findById(created.id)) ?? created;
      await this.auditService.record({
        actorUserId: actor.userId,
        action: FACILITY_ACTIONS.FACILITY_CREATED,
        targetType: 'facility',
        targetId: created.id,
        organizationId: created.organizationId,
        facilityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { code: created.code },
      });
      return this.toView(view);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw facilityCodeConflictError();
      }
      throw error;
    }
  }

  async listFacilities(
    actor: ActorContext,
    limit: number,
    offset: number,
  ): Promise<FacilityListResult> {
    const scope = this.rbacService.authorizeGlobal(actor, { permissions: ['facility.read'] })
      ? null
      : [...actor.facilityPermissions.keys()];
    const page = await this.repository.findPage(scope, limit, offset);
    return {
      items: page.items.map((facility) => this.toView(facility)),
      total: page.total,
      limit,
      offset,
    };
  }

  async getFacility(actor: ActorContext, facilityId: string): Promise<FacilityView> {
    const facility = await this.repository.findById(facilityId);
    if (!facility) {
      throw facilityNotFoundError();
    }
    const inScope =
      this.rbacService.authorizeGlobal(actor, { permissions: ['facility.read'] }) ||
      actor.facilityPermissions.has(facilityId);
    if (!inScope) {
      throw facilityNotFoundError();
    }
    return this.toView(facility);
  }

  async updateFacility(
    actor: ActorContext,
    facilityId: string,
    input: {
      name?: string;
      type?: FacilityType;
      status?: FacilityStatus;
      contactEmail?: string | null;
      contactPhone?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      region?: string | null;
      postalCode?: string | null;
      country?: string | null;
    },
    context: RequestContext,
  ): Promise<FacilityView> {
    const before = await this.repository.findById(facilityId);
    if (!before) {
      throw facilityNotFoundError();
    }
    const updated = await this.repository.update(facilityId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
      ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
    });
    if (!updated) {
      throw facilityNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: FACILITY_ACTIONS.FACILITY_UPDATED,
      targetType: 'facility',
      targetId: facilityId,
      organizationId: updated.organizationId,
      facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        before: { name: before.name, status: before.status, type: before.type },
        after: { name: updated.name, status: updated.status, type: updated.type },
      },
    });
    return this.toView(updated);
  }

  async listMembers(
    actor: ActorContext,
    facilityId: string,
    limit: number,
    offset: number,
  ): Promise<MembershipListResult> {
    const facility = await this.repository.findById(facilityId);
    if (!facility) {
      throw facilityNotFoundError();
    }
    const canView = this.rbacService.authorizeAtFacility(actor, facilityId, {
      permissions: ['facility.manage_members', 'facility.read'],
      anyOf: true,
    });
    if (!canView) {
      throw facilityNotFoundError();
    }
    const page = await this.repository.listMemberships(facilityId, limit, offset);
    return { items: page.items, total: page.total, limit, offset };
  }

  async addMember(
    actor: ActorContext,
    facilityId: string,
    userId: string,
    roleCode: string,
    context: RequestContext,
  ): Promise<{ membership: FacilityMembershipView }> {
    const facility = await this.repository.findById(facilityId);
    if (!facility) {
      throw facilityNotFoundError();
    }
    const userStatus = await this.repository.findUserStatus(userId);
    if (userStatus === null) {
      throw targetUserNotFoundError();
    }
    if (userStatus !== UserStatus.ACTIVE) {
      throw targetUserInactiveError();
    }
    const scopedRoles = facilityRoles();
    if (!scopedRoles.includes(roleCode as (typeof scopedRoles)[number])) {
      throw invalidMembershipRoleError(roleCode);
    }
    const role = await this.repository.findRoleByCode(roleCode);
    if (!role) {
      throw invalidMembershipRoleError(roleCode);
    }
    const existing = await this.repository.findMembership(facilityId, userId, role.id);
    if (existing) {
      throw membershipConflictError();
    }
    const created = await this.repository.createMembership({
      userId,
      facilityId,
      roleId: role.id,
      status: MembershipStatus.ACTIVE,
      assignedById: actor.userId,
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: FACILITY_ACTIONS.MEMBER_ADDED,
      targetType: 'membership',
      targetId: created.id,
      organizationId: facility.organizationId,
      facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { userId, roleCode },
    });
    return {
      membership: {
        id: created.id,
        userId: created.user.id,
        email: created.user.email,
        name: created.user.name,
        status: created.status,
        roleCode: created.role.code,
        roleName: created.role.name,
        assignedAt: created.assignedAt,
      },
    };
  }

  async removeMember(
    actor: ActorContext,
    facilityId: string,
    membershipId: string,
    context: RequestContext,
  ): Promise<{ removed: boolean }> {
    const membership = await this.repository.findMembershipById(facilityId, membershipId);
    if (!membership) {
      throw membershipNotFoundError();
    }
    await this.repository.deleteMembership(membershipId);
    await this.auditService.record({
      actorUserId: actor.userId,
      action: FACILITY_ACTIONS.MEMBER_REMOVED,
      targetType: 'membership',
      targetId: membershipId,
      organizationId: membership.facility.organizationId,
      facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        userId: membership.user.id,
        email: membership.user.email,
        roleCode: membership.role.code,
      },
    });
    return { removed: true };
  }

  private toView(facility: Facility & { organization?: { id: string; name: string; code: string; status: string } }): FacilityView {
    return {
      id: facility.id,
      organizationId: facility.organizationId,
      code: facility.code,
      name: facility.name,
      type: facility.type,
      status: facility.status,
      contactEmail: facility.contactEmail,
      contactPhone: facility.contactPhone,
      addressLine1: facility.addressLine1,
      addressLine2: facility.addressLine2,
      city: facility.city,
      region: facility.region,
      postalCode: facility.postalCode,
      country: facility.country,
      createdAt: facility.createdAt,
      updatedAt: facility.updatedAt,
      organization: facility.organization ?? {
        id: facility.organizationId,
        name: '',
        code: '',
        status: '',
      },
    };
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