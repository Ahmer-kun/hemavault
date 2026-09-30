import { HttpStatus, Injectable } from '@nestjs/common';
import { BloodGroup, DonationState } from '@prisma/client';
import { generatePublicCode } from '../../../common/identifiers/public-code';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { RbacService } from '../../rbac/application/rbac.service';
import { DonorService } from '../../donors/application/donor.service';
import { deferralActiveError, donorNotFoundError } from '../../donors/domain/donor.errors';
import {
  campaignNotFoundError,
  campaignNotPublishedError,
  campaignWindowClosedError,
  registrationNotFoundError,
} from '../../campaigns/domain/campaign.errors';
import { CampaignRepository } from '../../campaigns/infrastructure/campaign.repository';
import { CAMPAIGN_ACTIONS } from '../../campaigns/domain/campaign.constants';
import { DONATION_ACTIONS, DONATION_PUBLIC_CODE_PREFIX } from '../domain/donation.constants';
import {
  donationBloodGroupRequiredError,
  donationFacilityInactiveError,
  donationFacilityNotFoundError,
  donationNotFoundError,
  donationRejectReasonRequiredError,
  donationVolumeRequiredError,
  invalidDonationStateError,
} from '../domain/donation.errors';
import { DonationRepository, DonationWithDetails } from '../infrastructure/donation.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DonationView {
  id: string;
  publicCode: string;
  donor: { id: string; publicCode: string; name: string } | null;
  facility: { id: string; name: string; code: string };
  campaign: { id: string; name: string } | null;
  state: DonationState;
  scheduledFor: Date;
  checkedInAt: Date | null;
  collectedAt: Date | null;
  volumeMl: number | null;
  bloodGroup: BloodGroup | null;
  screening: {
    result: string;
    bloodGroup: BloodGroup;
    notes: string | null;
    completedAt: Date | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DonationPageResult {
  items: DonationView[];
  total: number;
  limit: number;
  offset: number;
}

export interface CampaignCheckInView {
  donor: { id: string; publicCode: string; name: string };
  registrationStatus: string;
  registrationCheckedInAt: Date | null;
  donation: DonationView;
}

@Injectable()
export class DonationService {
  constructor(
    private readonly repository: DonationRepository,
    private readonly campaignRepository: CampaignRepository,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly donorService: DonorService,
  ) {}

  async create(
    actor: ActorContext,
    input: {
      facilityId: string;
      donorProfileId?: string;
      donorReference?: string;
      scheduledFor?: Date;
      volumeMl?: number;
      bloodGroup?: BloodGroup;
    },
    context: RequestContext,
  ): Promise<DonationView> {
    const facility = await this.repository.findActiveFacility(input.facilityId);
    if (!facility) {
      throw donationFacilityNotFoundError();
    }
    if (facility.status !== 'ACTIVE') {
      throw donationFacilityInactiveError();
    }
    this.rbacService.assertAtFacility(actor, input.facilityId, { permissions: ['donation.create'] });
    const donor =
      (input.donorReference ? await this.donorService.findProfileByPublicCode(input.donorReference) : null) ??
      (input.donorProfileId ? await this.donorService.getProfileById(input.donorProfileId) : null);
    if (!donor) {
      throw donorNotFoundError();
    }
    const scheduledFor = input.scheduledFor ?? new Date();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicCode = generatePublicCode(DONATION_PUBLIC_CODE_PREFIX);
      try {
        const row = await this.repository.create({
          donorProfileId: donor.id,
          facilityId: input.facilityId,
          publicCode,
          scheduledFor,
          createdById: actor.userId,
        });
        await this.auditService.record({
          actorUserId: actor.userId,
          action: DONATION_ACTIONS.DONATION_CREATED,
          targetType: 'donation',
          targetId: row.id,
          organizationId: facility.organizationId,
          facilityId: input.facilityId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { publicCode, donorProfileId: donor.id, scheduledFor: scheduledFor.toISOString() },
        });
        const view = await this.reloadView(row.id);
        if (!view) {
          throw donationNotFoundError();
        }
        return view;
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a unique donation reference');
  }

  async list(
    actor: ActorContext,
    state: DonationState | null,
    limit: number,
    offset: number,
  ): Promise<DonationPageResult> {
    const scope = this.rbacService.authorizeGlobal(actor, { permissions: ['donation.read'] })
      ? null
      : this.facilityIdsWith(actor, 'donation.read');
    const page = await this.repository.findPage({ facilityScope: scope, state, limit, offset });
    return {
      items: page.items.map((row) => this.toView(row)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  async get(actor: ActorContext, donationId: string): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.read');
    return this.toView(row);
  }

  async checkIn(actor: ActorContext, donationId: string, context: RequestContext): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.update');
    if (row.state === 'CHECKED_IN') {
      return this.toView(row);
    }
    if (row.state !== 'SCHEDULED') {
      throw invalidDonationStateError();
    }
    const moved = await this.repository.transitionState(donationId, 'SCHEDULED', 'CHECKED_IN', {
      checkedInAt: new Date(),
    });
    if (!moved) {
      throw invalidDonationStateError();
    }
    await this.auditAction(actor, context, DONATION_ACTIONS.DONATION_CHECKED_IN, donationId, row);
    return this.requireView(donationId);
  }

  async collect(
    actor: ActorContext,
    donationId: string,
    input: { volumeMl?: number; bloodGroup?: BloodGroup },
    context: RequestContext,
  ): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.update');
    if (input.volumeMl === undefined) {
      throw donationVolumeRequiredError();
    }
    if (!input.bloodGroup) {
      throw donationBloodGroupRequiredError();
    }
    if (row.state !== 'CHECKED_IN') {
      throw invalidDonationStateError();
    }
    const moved = await this.repository.transitionState(donationId, 'CHECKED_IN', 'COLLECTED', {
      collectedAt: new Date(),
      volumeMl: input.volumeMl,
      bloodGroup: input.bloodGroup,
    });
    if (!moved) {
      throw invalidDonationStateError();
    }
    await this.auditAction(actor, context, DONATION_ACTIONS.DONATION_COLLECTED, donationId, row);
    return this.requireView(donationId);
  }

  async screen(
    actor: ActorContext,
    donationId: string,
    input: { bloodGroup?: BloodGroup; notes?: string | null; decision?: 'PASS' },
    context: RequestContext,
  ): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.screen');
    if (row.state === 'COLLECTED') {
      if (!input.bloodGroup) {
        throw donationBloodGroupRequiredError();
      }
      const started = await this.repository.startScreening({
        donationId,
        screenedById: actor.userId,
        bloodGroup: input.bloodGroup,
        notes: input.notes ?? null,
      });
      if (!started) {
        throw invalidDonationStateError();
      }
      await this.auditAction(actor, context, DONATION_ACTIONS.DONATION_SCREENING_STARTED, donationId, row);
      return this.requireView(donationId);
    }
    if (row.state === 'SCREENING') {
      if (input.decision !== 'PASS') {
        throw new AppHttpException(
          HttpStatus.BAD_REQUEST,
          'SCREEN_DECISION_REQUIRED',
          'Passing screening requires decision=PASS.',
        );
      }
      const passed = await this.repository.passScreening({ donationId, completedAt: new Date() });
      if (!passed) {
        throw invalidDonationStateError();
      }
      await this.auditAction(actor, context, DONATION_ACTIONS.DONATION_QUARANTINED, donationId, row);
      return this.requireView(donationId);
    }
    throw invalidDonationStateError();
  }

  async reject(
    actor: ActorContext,
    donationId: string,
    input: { reasonCode?: string; reasonNote?: string | null },
    context: RequestContext,
  ): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.reject');
    if (!input.reasonCode) {
      throw donationRejectReasonRequiredError();
    }
    if (row.state !== 'SCREENING' && row.state !== 'QUARANTINED') {
      throw invalidDonationStateError();
    }
    const rejected = await this.repository.rejectDonation({ donationId, completedAt: new Date() });
    if (!rejected) {
      throw invalidDonationStateError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: DONATION_ACTIONS.DONATION_REJECTED,
      targetType: 'donation',
      targetId: donationId,
      organizationId: undefined,
      facilityId: row.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reasonCode: input.reasonCode.trim().toUpperCase(), reasonNote: input.reasonNote ?? null },
    });
    return this.requireView(donationId);
  }

  async release(actor: ActorContext, donationId: string, context: RequestContext): Promise<DonationView> {
    const row = await this.visibleDonation(actor, donationId, 'donation.release');
    if (row.state !== 'QUARANTINED') {
      throw invalidDonationStateError();
    }
    const moved = await this.repository.transitionState(donationId, 'QUARANTINED', 'RELEASED');
    if (!moved) {
      throw invalidDonationStateError();
    }
    await this.auditAction(actor, context, DONATION_ACTIONS.DONATION_RELEASED, donationId, row);
    return this.requireView(donationId);
  }

  async campaignCheckIn(
    actor: ActorContext,
    campaignId: string,
    donorReference: string,
    context: RequestContext,
  ): Promise<CampaignCheckInView> {
    const campaign = await this.campaignRepository.findByIdWithFacility(campaignId);
    if (!campaign) {
      throw campaignNotFoundError();
    }
    if (!this.rbacService.authorizeAtFacility(actor, campaign.facilityId, { permissions: ['donation.update'] })) {
      throw campaignNotFoundError();
    }
    const donor = await this.donorService.findProfileByPublicCode(donorReference);
    if (!donor) {
      throw donorNotFoundError();
    }
    if (await this.donorService.hasActiveDeferral(donor.id)) {
      throw deferralActiveError();
    }
    const registration = await this.campaignRepository.findRegistration(campaign.id, donor.id);
    if (!registration) {
      throw registrationNotFoundError();
    }
    const now = new Date();
    if (campaign.status !== 'PUBLISHED') {
      throw campaignNotPublishedError();
    }
    if (now.getTime() < campaign.startsAt.getTime() || now.getTime() > campaign.endsAt.getTime()) {
      throw campaignWindowClosedError();
    }
    const result = await this.repository.performCampaignCheckIn({
      registrationId: registration.id,
      donorProfileId: donor.id,
      facilityId: campaign.facilityId,
      campaignId: campaign.id,
      publicCode: generatePublicCode(DONATION_PUBLIC_CODE_PREFIX),
      checkedInAt: now,
      createdById: actor.userId,
    });
    if (result.created) {
      await this.auditService.record({
        actorUserId: actor.userId,
        action: CAMPAIGN_ACTIONS.REGISTRATION_CHECKED_IN,
        targetType: 'campaign',
        targetId: campaign.id,
        organizationId: campaign.facility.organizationId,
        facilityId: campaign.facilityId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { registrationId: registration.id, donorProfileId: donor.id },
      });
      await this.auditService.record({
        actorUserId: actor.userId,
        action: DONATION_ACTIONS.DONATION_CHECKED_IN,
        targetType: 'donation',
        targetId: result.donation.id,
        organizationId: campaign.facility.organizationId,
        facilityId: campaign.facilityId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { donorProfileId: donor.id, campaignId: campaign.id },
      });
    }
    const donation = await this.repository.findById(result.donation.id);
    if (!donation) {
      throw donationNotFoundError();
    }
    return {
      donor: { id: donor.id, publicCode: donor.publicCode, name: donor.name },
      registrationStatus: result.created ? 'CHECKED_IN' : 'CHECKED_IN',
      registrationCheckedInAt: donation.checkedInAt,
      donation: this.toView(donation),
    };
  }

  private async visibleDonation(
    actor: ActorContext,
    donationId: string,
    permission: string,
  ): Promise<DonationWithDetails> {
    const row = await this.repository.findById(donationId);
    if (!row) {
      throw donationNotFoundError();
    }
    if (!this.rbacService.authorizeAtFacility(actor, row.facilityId, { permissions: [permission] })) {
      throw donationNotFoundError();
    }
    return row;
  }

  private async auditAction(
    actor: ActorContext,
    context: RequestContext,
    action: string,
    donationId: string,
    row: DonationWithDetails,
  ): Promise<void> {
    await this.auditService.record({
      actorUserId: actor.userId,
      action,
      targetType: 'donation',
      targetId: donationId,
      facilityId: row.facilityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async reloadView(donationId: string): Promise<DonationView | null> {
    const row = await this.repository.findById(donationId);
    return row ? this.toView(row) : null;
  }

  private async requireView(donationId: string): Promise<DonationView> {
    const view = await this.reloadView(donationId);
    if (!view) {
      throw donationNotFoundError();
    }
    return view;
  }

  private toView(row: DonationWithDetails): DonationView {
    return {
      id: row.id,
      publicCode: row.publicCode,
      donor: row.donorProfile,
      facility: row.facility,
      campaign: row.campaignRegistration?.campaign ?? null,
      state: row.state,
      scheduledFor: row.scheduledFor,
      checkedInAt: row.checkedInAt,
      collectedAt: row.collectedAt,
      volumeMl: row.volumeMl,
      bloodGroup: row.bloodGroup,
      screening: row.screening
        ? {
            result: row.screening.result,
            bloodGroup: row.screening.bloodGroup,
            notes: row.screening.notes,
            completedAt: row.screening.completedAt,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}