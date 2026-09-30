import { Injectable } from '@nestjs/common';
import {
  BloodGroup,
  Donation,
  DonationScreening,
  DonationState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export type DonationWithDetails = Donation & {
  donorProfile: { id: string; publicCode: string; name: string } | null;
  facility: { id: string; name: string; code: string };
  campaignRegistration: { campaign: { id: string; name: string } } | null;
  screening: DonationScreening | null;
};

export interface DonationPageInput {
  facilityScope: string[] | null;
  state: DonationState | null;
  limit: number;
  offset: number;
}

export interface DonationPage {
  items: DonationWithDetails[];
  total: number;
  limit: number;
  offset: number;
}

export interface CampaignCheckInResult {
  created: boolean;
  donation: Donation;
}

@Injectable()
export class DonationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveFacility(facilityId: string): Promise<{ organizationId: string; status: string } | null> {
    return this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { organizationId: true, status: true },
    });
  }

  async create(data: {
    donorProfileId: string;
    facilityId: string;
    publicCode: string;
    scheduledFor: Date;
    createdById: string;
  }): Promise<Donation> {
    return this.prisma.donation.create({ data });
  }

  async findById(id: string): Promise<DonationWithDetails | null> {
    return this.prisma.donation.findUnique({
      where: { id },
      include: {
        donorProfile: { select: { id: true, publicCode: true, name: true } },
        facility: { select: { id: true, name: true, code: true } },
        campaignRegistration: { select: { campaign: { select: { id: true, name: true } } } },
        screening: true,
      },
    });
  }

  async findPage(input: DonationPageInput): Promise<DonationPage> {
    const where: Prisma.DonationWhereInput = {
      ...(input.facilityScope !== null ? { facilityId: { in: input.facilityScope } } : {}),
      ...(input.state !== null ? { state: input.state } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.donation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
        skip: input.offset,
        include: {
          donorProfile: { select: { id: true, publicCode: true, name: true } },
          facility: { select: { id: true, name: true, code: true } },
          campaignRegistration: { select: { campaign: { select: { id: true, name: true } } } },
          screening: true,
        },
      }),
      this.prisma.donation.count({ where }),
    ]);
    return { items: rows, total, limit: input.limit, offset: input.offset };
  }

  async transitionState(
    id: string,
    from: DonationState,
    to: DonationState,
    data: Prisma.DonationUpdateManyMutationInput = {},
  ): Promise<boolean> {
    const result = await this.prisma.donation.updateMany({
      where: { id, state: from },
      data: { state: to, ...data },
    });
    return result.count > 0;
  }

  async startScreening(data: {
    donationId: string;
    screenedById: string;
    bloodGroup: BloodGroup;
    notes: string | null;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.donation.updateMany({
        where: { id: data.donationId, state: 'COLLECTED' },
        data: { state: 'SCREENING' },
      });
      if (moved.count === 0) {
        return false;
      }
      await tx.donationScreening.create({
        data: {
          donationId: data.donationId,
          screenedById: data.screenedById,
          bloodGroup: data.bloodGroup,
          notes: data.notes,
        },
      });
      return true;
    });
  }

  async passScreening(data: { donationId: string; completedAt: Date }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.donation.updateMany({
        where: { id: data.donationId, state: 'SCREENING' },
        data: { state: 'QUARANTINED' },
      });
      if (moved.count === 0) {
        return false;
      }
      await tx.donationScreening.updateMany({
        where: { donationId: data.donationId },
        data: { result: 'PASS', completedAt: data.completedAt },
      });
      return true;
    });
  }

  async rejectDonation(data: { donationId: string; completedAt: Date }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.donation.updateMany({
        where: { id: data.donationId, state: { in: ['SCREENING', 'QUARANTINED'] } },
        data: { state: 'REJECTED' },
      });
      if (moved.count === 0) {
        return false;
      }
      await tx.donationScreening.updateMany({
        where: { donationId: data.donationId },
        data: { result: 'REJECT', completedAt: data.completedAt },
      });
      return true;
    });
  }

  async performCampaignCheckIn(data: {
    registrationId: string;
    donorProfileId: string;
    facilityId: string;
    campaignId: string;
    publicCode: string;
    checkedInAt: Date;
    createdById: string;
  }): Promise<CampaignCheckInResult> {
    return this.prisma.$transaction(async (tx) => {
      const registration = await tx.campaignRegistration.updateMany({
        where: { id: data.registrationId, status: 'CONFIRMED' },
        data: { status: 'CHECKED_IN', checkedInAt: data.checkedInAt },
      });
      if (registration.count === 0) {
        const existing = await tx.donation.findUnique({
          where: { campaignRegistrationId: data.registrationId },
        });
        if (existing) {
          return { created: false, donation: existing };
        }
        throw new Error('CAMPAIGN_REGISTRATION_NOT_CHECKINABLE');
      }
      const donation = await tx.donation.create({
        data: {
          donorProfileId: data.donorProfileId,
          facilityId: data.facilityId,
          campaignRegistrationId: data.registrationId,
          publicCode: data.publicCode,
          scheduledFor: data.checkedInAt,
          checkedInAt: data.checkedInAt,
          state: DonationState.CHECKED_IN,
          createdById: data.createdById,
        },
      });
      return { created: true, donation };
    });
  }
}