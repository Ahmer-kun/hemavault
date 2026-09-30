import { Injectable } from '@nestjs/common';
import { BloodDrive, CampaignRegistration, CampaignStatus } from '@prisma/client';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { RbacService } from '../../rbac/application/rbac.service';
import { DonorService } from '../../donors/application/donor.service';
import { deferralActiveError } from '../../donors/domain/donor.errors';
import { CAMPAIGN_ACTIONS } from '../domain/campaign.constants';
import {
  campaignFacilityInactiveError,
  campaignFacilityNotFoundError,
  campaignFullError,
  campaignInvalidStateError,
  campaignNotFoundError,
  campaignNotPublishedError,
  campaignTimeRangeInvalidError,
  campaignWindowClosedError,
  duplicateRegistrationError,
  registrationAlreadyCheckedInError,
  registrationNotFoundError,
} from '../domain/campaign.errors';
import { canBookCampaignRegistration } from '../domain/booking-rules';
import { canTransitionCampaign } from '../domain/campaign-state-machine';
import { canTransitionRegistration } from '../domain/registration-state-machine';
import { CampaignRepository } from '../infrastructure/campaign.repository';
import type { CampaignGateContext } from '../domain/booking-rules';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface CampaignView {
  id: string;
  facilityId: string;
  facility: { id: string; name: string; code: string };
  name: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  targetUnits: number | null;
  capacity: number | null;
  status: CampaignStatus;
  registrationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPageResult {
  items: CampaignView[];
  total: number;
  limit: number;
  offset: number;
}

export interface RegistrationView {
  id: string;
  campaignId: string;
  donor: { id: string; publicCode: string; name: string };
  status: string;
  checkedInAt: Date | null;
  createdAt: Date;
}

type CampaignRow = BloodDrive & {
  facility: { id: string; name: string; code: string; organizationId: string };
  _count?: { registrations: number };
};

@Injectable()
export class CampaignService {
  constructor(
    private readonly repository: CampaignRepository,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly donorService: DonorService,
  ) {}

  async listCampaigns(actor: ActorContext, limit: number, offset: number): Promise<CampaignPageResult> {
    const staffScope = this.rbacService.authorizeAnywhere(actor, { permissions: ['campaign.read'] });
    let facilityScope: string[] | null = null;
    let publishedOnly = false;
    if (staffScope) {
      facilityScope = this.rbacService.authorizeGlobal(actor, { permissions: ['campaign.read'] })
        ? null
        : this.facilityIdsWith(actor, 'campaign.read');
    } else {
      publishedOnly = true;
    }
    const page = await this.repository.findPage({ facilityScope, publishedOnly, limit, offset });
    return {
      items: page.items.map((row) => this.toView(row)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  async getCampaign(actor: ActorContext, campaignId: string): Promise<CampaignView> {
    const row = await this.repository.findByIdWithFacility(campaignId);
    if (!row) {
      throw campaignNotFoundError();
    }
    const canRead = this.rbacService.authorizeAnywhere(actor, { permissions: ['campaign.read'] });
    if (!canRead) {
      if (row.status !== CampaignStatus.PUBLISHED) {
        throw campaignNotFoundError();
      }
      return this.toView(row);
    }
    if (!this.rbacService.authorizeAtFacility(actor, row.facilityId, { permissions: ['campaign.read'] })) {
      throw campaignNotFoundError();
    }
    return this.toView(row);
  }

  async createCampaign(
    actor: ActorContext,
    input: {
      facilityId: string;
      name: string;
      description?: string;
      location?: string;
      startsAt: Date;
      endsAt: Date;
      targetUnits?: number;
      capacity?: number;
    },
    context: RequestContext,
  ): Promise<CampaignView> {
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw campaignTimeRangeInvalidError();
    }
    const facility = await this.repository.findActiveFacility(input.facilityId);
    if (!facility) {
      throw campaignFacilityNotFoundError();
    }
    if (facility.status !== 'ACTIVE') {
      throw campaignFacilityInactiveError();
    }
    this.rbacService.assertAtFacility(actor, input.facilityId, { permissions: ['campaign.create'] });
    const created = await this.repository.create({
      facilityId: input.facilityId,
      name: input.name.trim(),
      description: input.description || null,
      location: input.location || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      targetUnits: input.targetUnits ?? null,
      capacity: input.capacity ?? null,
      createdById: actor.userId,
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: CAMPAIGN_ACTIONS.CAMPAIGN_CREATED,
      targetType: 'campaign',
      targetId: created.id,
      organizationId: facility.organizationId,
      facilityId: input.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { name: created.name },
    });
    return this.toView({
      ...created,
      facility: { id: facility.id, name: facility.name, code: facility.code, organizationId: facility.organizationId },
    });
  }

  async updateCampaign(
    actor: ActorContext,
    campaignId: string,
    input: {
      name?: string;
      description?: string | null;
      location?: string | null;
      startsAt?: Date;
      endsAt?: Date;
      targetUnits?: number | null;
      capacity?: number | null;
      status?: CampaignStatus;
    },
    context: RequestContext,
  ): Promise<CampaignView> {
    const before = await this.repository.findByIdWithFacility(campaignId);
    if (!before) {
      throw campaignNotFoundError();
    }
    if (!this.rbacService.authorizeAtFacility(actor, before.facilityId, { permissions: ['campaign.update'] })) {
      throw campaignNotFoundError();
    }
    const startsAt = input.startsAt ?? before.startsAt;
    const endsAt = input.endsAt ?? before.endsAt;
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw campaignTimeRangeInvalidError();
    }
    let nextStatus: CampaignStatus | null = null;
    if (input.status !== undefined) {
      const to = input.status;
      if (!canTransitionCampaign(before.status, to)) {
        throw campaignInvalidStateError();
      }
      const moved = await this.repository.transitionStatus(campaignId, before.status, to);
      if (!moved) {
        throw campaignInvalidStateError();
      }
      nextStatus = to;
    }
    const updated = await this.repository.update(campaignId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.targetUnits !== undefined ? { targetUnits: input.targetUnits } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    });
    if (!updated) {
      throw campaignNotFoundError();
    }
    if (nextStatus !== null) {
      expectedStatusAudit(actor, context, this.auditService, campaignId, updated, before, nextStatus);
    } else {
      await this.auditService.record({
        actorUserId: actor.userId,
        action: CAMPAIGN_ACTIONS.CAMPAIGN_UPDATED,
        targetType: 'campaign',
        targetId: campaignId,
        organizationId: before.facility.organizationId,
        facilityId: before.facilityId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          before: { name: before.name, status: before.status },
          after: { name: updated.name, status: updated.status },
        },
      });
    }
    return this.toView({ ...updated, facility: before.facility });
  }

  async publishCampaign(actor: ActorContext, campaignId: string, context: RequestContext): Promise<CampaignView> {
    const before = await this.requireCampaignScoped(actor, campaignId, 'campaign.publish');
    const moved = await this.repository.transitionStatus(campaignId, CampaignStatus.DRAFT, CampaignStatus.PUBLISHED);
    if (!moved && before.status !== CampaignStatus.PUBLISHED) {
      throw campaignInvalidStateError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: CAMPAIGN_ACTIONS.CAMPAIGN_PUBLISHED,
      targetType: 'campaign',
      targetId: campaignId,
      organizationId: before.facility.organizationId,
      facilityId: before.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { name: before.name },
    });
    return this.reloadView(campaignId);
  }

  async cancelCampaign(actor: ActorContext, campaignId: string, context: RequestContext): Promise<CampaignView> {
    const before = await this.requireCampaignScoped(actor, campaignId, 'campaign.cancel');
    if (before.status !== CampaignStatus.CANCELLED) {
      if (!canTransitionCampaign(before.status, CampaignStatus.CANCELLED)) {
        throw campaignInvalidStateError();
      }
      const moved = await this.repository.transitionStatus(campaignId, before.status, CampaignStatus.CANCELLED);
      if (!moved) {
        throw campaignInvalidStateError();
      }
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: CAMPAIGN_ACTIONS.CAMPAIGN_CANCELLED,
      targetType: 'campaign',
      targetId: campaignId,
      organizationId: before.facility.organizationId,
      facilityId: before.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { name: before.name },
    });
    return this.reloadView(campaignId);
  }

  async registerForCampaign(actor: ActorContext, campaignId: string, context: RequestContext): Promise<RegistrationView> {
    const profile = await this.donorService.ensureProfile(actor, context);
    const campaign = await this.repository.findById(campaignId);
    if (!campaign) {
      throw campaignNotFoundError();
    }
    const gate = await this.buildBookingGate(campaign, profile.id);
    const verdict = canBookCampaignRegistration(gate, new Date());
    if (!verdict.allowed) {
      throw this.bookingError(verdict.reason);
    }
    try {
      const registration = await this.repository.createRegistration({
        campaignId: campaign.id,
        donorProfileId: profile.id,
        registeredById: actor.userId,
      });
      await this.auditService.record({
        actorUserId: actor.userId,
        action: CAMPAIGN_ACTIONS.REGISTRATION_CREATED,
        targetType: 'campaign',
        targetId: campaign.id,
        facilityId: campaign.facilityId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { donorProfileId: profile.id },
      });
      return this.toRegistrationView(registration, {
        id: profile.id,
        publicCode: profile.publicCode,
        name: profile.name,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw duplicateRegistrationError();
      }
      throw error;
    }
  }

  async cancelRegistration(
    actor: ActorContext,
    campaignId: string,
    registrationId: string,
    context: RequestContext,
  ): Promise<RegistrationView> {
    const registration = await this.repository.findRegistrationById(registrationId);
    if (!registration || registration.campaignId !== campaignId) {
      throw registrationNotFoundError();
    }
    const campaign = await this.repository.findById(campaignId);
    if (!campaign) {
      throw registrationNotFoundError();
    }
    const ownProfile = await this.donorService.getProfileForUser(actor.userId);
    const isOwner = ownProfile !== null && registration.donorProfileId === ownProfile.id;
    const isStaff = this.rbacService.authorizeAtFacility(actor, campaign.facilityId, {
      permissions: ['campaign.manage_registrations'],
    });
    if (!isOwner && !isStaff) {
      throw registrationNotFoundError();
    }
    if (registration.status === 'CANCELLED') {
      return this.toRegistrationView(registration, await this.loadDonor(registration.donorProfileId));
    }
    if (!canTransitionRegistration(registration.status, 'CANCELLED')) {
      if (registration.status === 'CHECKED_IN') {
        throw registrationAlreadyCheckedInError();
      }
      throw registrationNotFoundError();
    }
    const moved = await this.repository.transitionRegistration(registration.id, registration.status, 'CANCELLED');
    if (!moved) {
      throw registrationNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: CAMPAIGN_ACTIONS.REGISTRATION_CANCELLED,
      targetType: 'campaign',
      targetId: campaignId,
      facilityId: campaign.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { registrationId: registration.id },
    });
    return this.toRegistrationView({ ...registration, status: 'CANCELLED' }, await this.loadDonor(registration.donorProfileId));
  }

  async listRegistrations(actor: ActorContext, campaignId: string): Promise<RegistrationView[]> {
    const before = await this.requireCampaignScoped(actor, campaignId, 'campaign.manage_registrations');
    const rows = await this.repository.listRegistrations(before.id);
    const donors = new Map<string, { id: string; publicCode: string; name: string }>();
    for (const row of rows) {
      donors.set(row.donorProfileId, await this.loadDonor(row.donorProfileId));
    }
    return rows.map((row) => this.toRegistrationView(row, donors.get(row.donorProfileId)!));
  }

  private async requireCampaignScoped(
    actor: ActorContext,
    campaignId: string,
    permission: string,
  ): Promise<BloodDrive & { facility: { id: string; name: string; code: string; organizationId: string } }> {
    const campaign = await this.repository.findByIdWithFacility(campaignId);
    if (!campaign) {
      throw campaignNotFoundError();
    }
    if (!this.rbacService.authorizeAtFacility(actor, campaign.facilityId, { permissions: [permission] })) {
      throw campaignNotFoundError();
    }
    return campaign;
  }

  private async buildBookingGate(campaign: BloodDrive, profileId: string): Promise<CampaignGateContext> {
    const [alreadyRegistered, activeDeferral, registeredCount] = await Promise.all([
      this.repository.findRegistration(campaign.id, profileId),
      this.donorService.hasActiveDeferral(profileId),
      this.repository.countActiveRegistrations(campaign.id),
    ]);
    return {
      status: campaign.status,
      capacity: campaign.capacity,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      registeredCount,
      alreadyRegistered: alreadyRegistered !== null,
      activeDeferral,
    };
  }

  private async reloadView(campaignId: string): Promise<CampaignView> {
    const fresh = await this.repository.findByIdWithFacility(campaignId);
    if (!fresh) {
      throw campaignNotFoundError();
    }
    return this.toView(fresh);
  }

  private async loadDonor(profileId: string): Promise<{ id: string; publicCode: string; name: string }> {
    const profile = await this.donorService.getProfileById(profileId);
    return {
      id: profile?.id ?? profileId,
      publicCode: profile?.publicCode ?? 'UNKNOWN',
      name: profile?.name ?? 'Unknown donor',
    };
  }

  private toView(row: {
    id: string;
    facilityId: string;
    facility: { id: string; name: string; code: string; organizationId: string };
    name: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    targetUnits: number | null;
    capacity: number | null;
    status: CampaignStatus;
    _count?: { registrations: number };
    createdAt: Date;
    updatedAt: Date;
  }): CampaignView {
    return {
      id: row.id,
      facilityId: row.facilityId,
      facility: row.facility,
      name: row.name,
      description: row.description,
      location: row.location,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      targetUnits: row.targetUnits,
      capacity: row.capacity,
      status: row.status,
      registrationCount: row._count?.registrations ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRegistrationView(
    registration: CampaignRegistration & { status?: string },
    donor: { id: string; publicCode: string; name: string },
  ): RegistrationView {
    return {
      id: registration.id,
      campaignId: registration.campaignId,
      donor,
      status: registration.status,
      checkedInAt: registration.checkedInAt,
      createdAt: registration.createdAt,
    };
  }

  private facilityIdsWith(actor: ActorContext, permission: string): string[] {
    const ids: string[] = [];
    for (const [facilityId, permissions] of actor.facilityPermissions) {
      if (permissions.has(permission)) {
        ids.push(facilityId);
      }
    }
    return ids;
  }

  private bookingError(reason: string): AppHttpException {
    switch (reason) {
      case 'CAMPAIGN_NOT_PUBLISHED':
        return campaignNotPublishedError();
      case 'CAMPAIGN_FULL':
        return campaignFullError();
      case 'CAMPAIGN_WINDOW_CLOSED':
        return campaignWindowClosedError();
      case 'DEFERRAL_ACTIVE':
        return deferralActiveError();
      case 'ALREADY_REGISTERED':
        return duplicateRegistrationError();
      default:
        return campaignInvalidStateError();
    }
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

function expectedStatusAudit(
  actor: ActorContext,
  context: RequestContext,
  auditService: AuditService,
  campaignId: string,
  updated: BloodDrive,
  before: CampaignRow,
  selected: CampaignStatus,
): Promise<void> {
  const action =
    selected === CampaignStatus.PUBLISHED
      ? CAMPAIGN_ACTIONS.CAMPAIGN_PUBLISHED
      : selected === CampaignStatus.COMPLETED
        ? CAMPAIGN_ACTIONS.CAMPAIGN_COMPLETED
        : selected === CampaignStatus.CANCELLED
          ? CAMPAIGN_ACTIONS.CAMPAIGN_CANCELLED
          : CAMPAIGN_ACTIONS.CAMPAIGN_UPDATED;
  return auditService.record({
    actorUserId: actor.userId,
    action,
    targetType: 'campaign',
    targetId: campaignId,
    organizationId: before.facility.organizationId,
    facilityId: before.facilityId,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    metadata: { before: before.status, after: updated.status },
  });
}