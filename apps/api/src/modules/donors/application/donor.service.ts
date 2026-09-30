import { Injectable } from '@nestjs/common';
import { BloodGroup, DonorProfile } from '@prisma/client';
import { generatePublicCode } from '../../../common/identifiers/public-code';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext } from '../../rbac/domain/policy';
import { RbacService } from '../../rbac/application/rbac.service';
import { DONOR_ACTIONS, DONOR_PUBLIC_CODE_PREFIX } from '../domain/donor.constants';
import {
  deferralAlreadyResolvedError,
  deferralNotFoundError,
  donorNotFoundError,
} from '../domain/donor.errors';
import {
  DonationHistoryRow,
  DonorRepository,
} from '../infrastructure/donor.repository';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DonorProfileView {
  id: string;
  publicCode: string;
  name: string;
  dateOfBirth: string | null;
  bloodGroup: BloodGroup | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DonorListResult {
  items: DonorProfileView[];
  total: number;
  limit: number;
  offset: number;
}

export interface DonorDonationView {
  id: string;
  publicCode: string;
  state: string;
  scheduledFor: Date;
  checkedInAt: Date | null;
  collectedAt: Date | null;
  volumeMl: number | null;
  bloodGroup: BloodGroup | null;
  createdAt: Date;
  facility: { id: string; name: string; code: string } | null;
  campaignName: string | null;
}

export interface DeferralView {
  id: string;
  reasonCode: string;
  reasonNote: string | null;
  effectiveAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  active: boolean;
}

@Injectable()
export class DonorService {
  constructor(
    private readonly repository: DonorRepository,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
  ) {}

  async getSelfProfile(actor: ActorContext, context: RequestContext): Promise<DonorProfileView> {
    const profile = await this.ensureProfile(actor, context);
    return this.toProfileView(profile);
  }

  async updateSelfProfile(
    actor: ActorContext,
    input: { name?: string; dateOfBirth?: Date | null; bloodGroup?: BloodGroup | null },
    context: RequestContext,
  ): Promise<DonorProfileView> {
    const profile = await this.ensureProfile(actor, context);
    const before = this.toProfileView(profile);
    const updated = await this.repository.updateProfile(profile.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
    });
    if (!updated) {
      throw donorNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: DONOR_ACTIONS.PROFILE_UPDATED,
      targetType: 'donor',
      targetId: profile.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        before: { name: before.name, bloodGroup: before.bloodGroup },
        after: { name: updated.name, bloodGroup: updated.bloodGroup },
      },
    });
    return this.toProfileView(updated);
  }

  async listSelfDonations(
    actor: ActorContext,
    limit: number,
    offset: number,
  ): Promise<{ items: DonorDonationView[]; total: number }> {
    const profile = await this.repository.findProfileByUserId(actor.userId);
    if (!profile) {
      return { items: [], total: 0 };
    }
    return this.listDonationsForProfile(profile.id, null, limit, offset);
  }

  async searchDonors(
    actor: ActorContext,
    search: string | null,
    limit: number,
    offset: number,
  ): Promise<DonorListResult> {
    const scope = this.rbacService.authorizeGlobal(actor, { permissions: ['donor.search'] })
      ? null
      : this.facilityIdsWith(actor, 'donor.search');
    const page = await this.repository.findDonorPage({ search, facilityScope: scope, limit, offset });
    return {
      items: page.items.map((profile) => this.toProfileView(profile)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  async getDonor(actor: ActorContext, donorId: string): Promise<DonorProfileView> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    await this.assertDonorVisible(actor, profile.id, 'donor.read');
    return this.toProfileView(profile);
  }

  async getDonorDonations(
    actor: ActorContext,
    donorId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: DonorDonationView[]; total: number }> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    if (!this.rbacService.authorizeGlobal(actor, { permissions: ['donation.read'] })) {
      const scopeIds = this.facilityIdsWith(actor, 'donation.read');
      const linked = await this.repository.hasDonationInFacilities(profile.id, scopeIds);
      if (!linked) {
        throw donorNotFoundError();
      }
    }
    const scope = this.rbacService.authorizeGlobal(actor, { permissions: ['donation.read'] })
      ? null
      : this.facilityIdsWith(actor, 'donation.read');
    return this.listDonationsForProfile(profile.id, scope, limit, offset);
  }

  async updateDonor(
    actor: ActorContext,
    donorId: string,
    input: { name?: string; dateOfBirth?: Date | null; bloodGroup?: BloodGroup | null },
    context: RequestContext,
  ): Promise<DonorProfileView> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    await this.assertDonorVisible(actor, profile.id, 'donor.update');
    const before = this.toProfileView(profile);
    const updated = await this.repository.updateProfile(profile.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
    });
    if (!updated) {
      throw donorNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: DONOR_ACTIONS.PROFILE_UPDATED,
      targetType: 'donor',
      targetId: profile.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        before: { name: before.name },
        after: { name: updated.name },
      },
    });
    return this.toProfileView(updated);
  }

  async createDeferral(
    actor: ActorContext,
    donorId: string,
    input: { reasonCode: string; reasonNote?: string | null; expiresAt?: Date | null },
    context: RequestContext,
  ): Promise<DeferralView> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    await this.assertDonorVisible(actor, profile.id, 'donor.update');
    const deferral = await this.repository.createDeferral({
      donorProfileId: profile.id,
      reasonCode: input.reasonCode.trim().toUpperCase(),
      reasonNote: input.reasonNote || null,
      expiresAt: input.expiresAt ?? null,
      createdById: actor.userId,
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: DONOR_ACTIONS.DEFERRAL_CREATED,
      targetType: 'donor',
      targetId: profile.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reasonCode: deferral.reasonCode, expiresAt: deferral.expiresAt?.toISOString() ?? null },
    });
    return this.toDeferralView(deferral);
  }

  async resolveDeferral(
    actor: ActorContext,
    donorId: string,
    deferralId: string,
    input: { resolutionNote?: string | null },
    context: RequestContext,
  ): Promise<DeferralView> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    await this.assertDonorVisible(actor, profile.id, 'donor.update');
    const deferral = await this.repository.findDeferralById(deferralId);
    if (!deferral || deferral.donorProfileId !== profile.id) {
      throw deferralNotFoundError();
    }
    if (deferral.resolvedAt) {
      throw deferralAlreadyResolvedError();
    }
    await this.repository.resolveDeferral(deferral.id, actor.userId, input.resolutionNote ?? null);
    const resolved = await this.repository.findDeferralById(deferral.id);
    if (!resolved) {
      throw deferralNotFoundError();
    }
    await this.auditService.record({
      actorUserId: actor.userId,
      action: DONOR_ACTIONS.DEFERRAL_RESOLVED,
      targetType: 'donor',
      targetId: profile.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { deferralId: deferral.id, reasonCode: deferral.reasonCode },
    });
    return this.toDeferralView(resolved);
  }

  async listDeferrals(actor: ActorContext, donorId: string): Promise<DeferralView[]> {
    const profile = await this.repository.findProfileById(donorId);
    if (!profile) {
      throw donorNotFoundError();
    }
    await this.assertDonorVisible(actor, profile.id, 'donor.read');
    const deferrals = await this.repository.listDeferrals(profile.id);
    return deferrals.map((deferral) => this.toDeferralView(deferral));
  }

  async hasActiveDeferral(profileId: string): Promise<boolean> {
    return this.repository.hasActiveDeferral(profileId);
  }

  async findProfileByPublicCode(publicCode: string): Promise<DonorProfile | null> {
    return this.repository.findProfileByPublicCode(publicCode.trim().toUpperCase());
  }

  async getProfileForUser(userId: string): Promise<DonorProfile | null> {
    return this.repository.findProfileByUserId(userId);
  }

  async getProfileById(profileId: string): Promise<DonorProfile | null> {
    return this.repository.findProfileById(profileId);
  }

  async ensureProfile(actor: ActorContext, context: RequestContext | null): Promise<DonorProfile> {
    const existing = await this.repository.findProfileByUserId(actor.userId);
    if (existing) {
      return existing;
    }
    const name = (await this.repository.findUserName(actor.userId)) ?? 'Donor';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicCode = generatePublicCode(DONOR_PUBLIC_CODE_PREFIX);
      try {
        const created = await this.repository.createProfile({ userId: actor.userId, publicCode, name });
        if (context) {
          await this.auditService.record({
            actorUserId: actor.userId,
            action: DONOR_ACTIONS.PROFILE_CREATED,
            targetType: 'donor',
            targetId: created.id,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: { publicCode },
          });
        }
        return created;
      } catch (error) {
        const existingAfterRace = await this.repository.findProfileByUserId(actor.userId);
        if (existingAfterRace) {
          return existingAfterRace;
        }
        if (this.isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a unique donor reference');
  }

  private async assertDonorVisible(actor: ActorContext, profileId: string, permission: string): Promise<void> {
    if (this.rbacService.authorizeGlobal(actor, { permissions: [permission] })) {
      return;
    }
    const scopeIds = this.facilityIdsWith(actor, permission);
    const linked = await this.repository.hasDonationInFacilities(profileId, scopeIds);
    if (!linked) {
      throw donorNotFoundError();
    }
  }

  private async listDonationsForProfile(
    profileId: string,
    facilityScope: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ items: DonorDonationView[]; total: number }> {
    const page = await this.repository.listDonorDonations(profileId, facilityScope, limit, offset);
    return {
      items: page.items.map((row) => this.toDonationView(row)),
      total: page.total,
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

  private toProfileView(profile: DonorProfile): DonorProfileView {
    return {
      id: profile.id,
      publicCode: profile.publicCode,
      name: profile.name,
      dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.toISOString() : null,
      bloodGroup: profile.bloodGroup,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private toDonationView(row: DonationHistoryRow): DonorDonationView {
    return {
      id: row.id,
      publicCode: row.publicCode,
      state: row.state,
      scheduledFor: row.scheduledFor,
      checkedInAt: row.checkedInAt,
      collectedAt: row.collectedAt,
      volumeMl: row.volumeMl,
      bloodGroup: row.bloodGroup,
      createdAt: row.createdAt,
      facility: row.facility,
      campaignName: row.campaignRegistration?.campaign.name ?? null,
    };
  }

  private toDeferralView(deferral: {
    id: string;
    reasonCode: string;
    reasonNote: string | null;
    effectiveAt: Date;
    expiresAt: Date | null;
    resolvedAt: Date | null;
  }): DeferralView {
    const now = new Date();
    const active =
      deferral.resolvedAt === null &&
      deferral.effectiveAt.getTime() <= now.getTime() &&
      (deferral.expiresAt === null || deferral.expiresAt.getTime() > now.getTime());
    return {
      id: deferral.id,
      reasonCode: deferral.reasonCode,
      reasonNote: deferral.reasonNote,
      effectiveAt: deferral.effectiveAt,
      expiresAt: deferral.expiresAt,
      resolvedAt: deferral.resolvedAt,
      active,
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