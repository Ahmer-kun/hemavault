import { Injectable } from '@nestjs/common';
import { BloodGroup, DonorDeferral, DonorProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface DonorPageInput {
  search: string | null;
  facilityScope: string[] | null;
  limit: number;
  offset: number;
}

export interface DonorPage {
  items: DonorProfile[];
  total: number;
  limit: number;
  offset: number;
}

export interface DonationHistoryRow {
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
  campaignRegistration: { campaign: { name: string } } | null;
}

@Injectable()
export class DonorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileByUserId(userId: string): Promise<DonorProfile | null> {
    return this.prisma.donorProfile.findUnique({ where: { userId } });
  }

  async findUserName(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) {
      return null;
    }
    return user.name ?? user.email.split('@')[0] ?? user.email;
  }

  async findProfileByPublicCode(publicCode: string): Promise<DonorProfile | null> {
    return this.prisma.donorProfile.findUnique({ where: { publicCode } });
  }

  async findProfileById(id: string): Promise<DonorProfile | null> {
    return this.prisma.donorProfile.findUnique({ where: { id } });
  }

  async createProfile(data: {
    userId: string;
    publicCode: string;
    name: string;
    dateOfBirth?: Date | null;
    bloodGroup?: BloodGroup | null;
  }): Promise<DonorProfile> {
    return this.prisma.donorProfile.create({
      data: {
        userId: data.userId,
        publicCode: data.publicCode,
        name: data.name,
        dateOfBirth: data.dateOfBirth ?? null,
        bloodGroup: data.bloodGroup ?? null,
      },
    });
  }

  async updateProfile(
    id: string,
    data: { name?: string; dateOfBirth?: Date | null; bloodGroup?: BloodGroup | null },
  ): Promise<DonorProfile | null> {
    const existing = await this.prisma.donorProfile.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    return this.prisma.donorProfile.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
        ...(data.bloodGroup !== undefined ? { bloodGroup: data.bloodGroup } : {}),
      },
    });
  }

  async findDonorPage(input: DonorPageInput): Promise<DonorPage> {
    const where: Prisma.DonorProfileWhereInput = this.donorWhere(input.search, input.facilityScope);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.donorProfile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }),
      this.prisma.donorProfile.count({ where }),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  }

  async hasDonationInFacilities(profileId: string, facilityIds: string[]): Promise<boolean> {
    if (facilityIds.length === 0) {
      return false;
    }
    const count = await this.prisma.donation.count({
      where: { donorProfileId: profileId, facilityId: { in: facilityIds } },
    });
    return count > 0;
  }

  async listDonorDonations(
    profileId: string,
    facilityScope: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ items: DonationHistoryRow[]; total: number }> {
    const where: Prisma.DonationWhereInput = {
      donorProfileId: profileId,
      ...(facilityScope ? { facilityId: { in: facilityScope } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.donation.findMany({
        where,
        orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          facility: { select: { id: true, name: true, code: true } },
          campaignRegistration: { select: { campaign: { select: { name: true } } } },
        },
      }),
      this.prisma.donation.count({ where }),
    ]);
    return { items: rows, total };
  }

  async hasActiveDeferral(profileId: string, now = new Date()): Promise<boolean> {
    const count = await this.prisma.donorDeferral.count({
      where: {
        donorProfileId: profileId,
        resolvedAt: null,
        effectiveAt: { lte: now },
        OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
      },
    });
    return count > 0;
  }

  async createDeferral(data: {
    donorProfileId: string;
    reasonCode: string;
    reasonNote: string | null;
    expiresAt: Date | null;
    createdById: string;
  }): Promise<DonorDeferral> {
    return this.prisma.donorDeferral.create({
      data: {
        donorProfileId: data.donorProfileId,
        reasonCode: data.reasonCode,
        reasonNote: data.reasonNote,
        expiresAt: data.expiresAt,
        createdById: data.createdById,
      },
    });
  }

  async findDeferralById(id: string): Promise<DonorDeferral | null> {
    return this.prisma.donorDeferral.findUnique({ where: { id } });
  }

  async resolveDeferral(id: string, resolvedById: string, resolutionNote: string | null): Promise<void> {
    await this.prisma.donorDeferral.update({
      where: { id },
      data: { resolvedById, resolvedAt: new Date(), resolutionNote },
    });
  }

  async listDeferrals(profileId: string): Promise<DonorDeferral[]> {
    return this.prisma.donorDeferral.findMany({
      where: { donorProfileId: profileId },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
    });
  }

  private donorWhere(
    search: string | null,
    facilityScope: string[] | null,
  ): Prisma.DonorProfileWhereInput {
    const clauses: Prisma.DonorProfileWhereInput[] = [];
    if (search) {
      clauses.push({
        OR: [
          { publicCode: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (facilityScope !== null) {
      clauses.push({ donations: { some: { facilityId: { in: facilityScope } } } });
    }
    if (clauses.length === 0) {
      return {};
    }
    return clauses.length === 1 ? (clauses[0] ?? {}) : { AND: clauses };
  }
}