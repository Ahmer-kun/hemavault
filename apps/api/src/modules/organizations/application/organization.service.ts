import { Injectable } from '@nestjs/common';
import { Organization, OrganizationStatus } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { RbacService } from '../../rbac/application/rbac.service';
import { ORGANIZATION_ACTIONS } from '../domain/organization.constants';
import {
  organizationCodeConflictError,
  organizationNotFoundError,
} from '../domain/organization.errors';
import { OrganizationRepository } from '../infrastructure/organization.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface OrganizationView {
  id: string;
  code: string;
  name: string;
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
}

export interface OrganizationListResult {
  items: OrganizationView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
  ) {}

  async createOrganization(
    actor: ActorContext,
    input: {
      name: string;
      code: string;
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
  ): Promise<OrganizationView> {
    const code = input.code.trim().toUpperCase();
    const existing = await this.repository.findByCode(code);
    if (existing) {
      throw organizationCodeConflictError();
    }
    try {
      const created = await this.repository.create({
        name: input.name.trim(),
        code,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
        region: input.region || null,
        postalCode: input.postalCode || null,
        country: input.country || null,
      });
      await this.auditService.record({
        actorUserId: actor.userId,
        action: ORGANIZATION_ACTIONS.ORGANIZATION_CREATED,
        targetType: 'organization',
        targetId: created.id,
        organizationId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { code: created.code },
      });
      return this.toView(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw organizationCodeConflictError();
      }
      throw error;
    }
  }

  async listOrganizations(
    actor: ActorContext,
    limit: number,
    offset: number,
  ): Promise<OrganizationListResult> {
    const scope = this.rbacService.authorizeGlobal(actor, {
      permissions: ['organization.read'],
    })
      ? null
      : [...actor.facilityPermissions.keys()];
    const page = await this.repository.findPage(scope, limit, offset);
    return {
      items: page.items.map((org) => this.toView(org)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  async getOrganization(actor: ActorContext, organizationId: string): Promise<OrganizationView> {
    const organization = await this.repository.findById(organizationId);
    if (!organization) {
      throw organizationNotFoundError();
    }
    const canAccess = this.rbacService.authorizeGlobal(actor, {
      permissions: ['organization.read'],
    });
    if (!canAccess) {
      const facilityIds = await this.repository.findFacilityIds(organizationId);
      const scoped = facilityIds.some((id) => actor.facilityPermissions.has(id));
      if (!scoped) {
        throw organizationNotFoundError();
      }
    }
    return this.toView(organization);
  }

  async updateOrganization(
    actor: ActorContext,
    organizationId: string,
    input: {
      name?: string;
      status?: string;
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
  ): Promise<OrganizationView> {
    const before = await this.repository.findById(organizationId);
    if (!before) {
      throw organizationNotFoundError();
    }
    const updated = await this.repository.update(organizationId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.status !== undefined
        ? { status: input.status as OrganizationStatus }
        : {}),
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
      throw organizationNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: ORGANIZATION_ACTIONS.ORGANIZATION_UPDATED,
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        before: { name: before.name, status: before.status },
        after: { name: updated.name, status: updated.status },
      },
    });
    return this.toView(updated);
  }

  private toView(organization: Organization): OrganizationView {
    return {
      id: organization.id,
      code: organization.code,
      name: organization.name,
      status: organization.status,
      contactEmail: organization.contactEmail,
      contactPhone: organization.contactPhone,
      addressLine1: organization.addressLine1,
      addressLine2: organization.addressLine2,
      city: organization.city,
      region: organization.region,
      postalCode: organization.postalCode,
      country: organization.country,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
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