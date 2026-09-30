import { Injectable } from '@nestjs/common';
import {
  BloodDrive,
  CampaignRegistration,
  CampaignStatus,
  Prisma,
  RegistrationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface CampaignPageInput {
  facilityScope: string[] | null;
  publishedOnly: boolean;
  limit: number;
  offset: number;
}

export interface CampaignPage {
  items: Array<
    BloodDrive & {
      facility: { id: string; name: string; code: string; organizationId: string };
      _count: { registrations: number };
    }
  >;
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class CampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveFacility(
    facilityId: string,
  ): Promise<{ id: string; organizationId: string; status: string; name: string; code: string } | null> {
    return this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true, organizationId: true, status: true, name: true, code: true },
    });
  }

  async create(data: {
    facilityId: string;
    name: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    targetUnits: number | null;
    capacity: number | null;
    createdById: string;
  }): Promise<BloodDrive> {
    return this.prisma.bloodDrive.create({
      data: {
        facilityId: data.facilityId,
        name: data.name,
        description: data.description,
        location: data.location,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        targetUnits: data.targetUnits,
        capacity: data.capacity,
        createdById: data.createdById,
      },
    });
  }

  async findById(id: string): Promise<BloodDrive | null> {
    return this.prisma.bloodDrive.findUnique({ where: { id } });
  }

  async findByIdWithFacility(
    id: string,
  ): Promise<
    | (BloodDrive & {
        facility: { id: string; name: string; code: string; organizationId: string };
        _count: { registrations: number };
      })
    | null
  > {
    return this.prisma.bloodDrive.findUnique({
      where: { id },
      include: {
        facility: { select: { id: true, name: true, code: true, organizationId: true } },
        _count: { select: { registrations: true } },
      },
    });
  }

  async listRegistrations(campaignId: string): Promise<CampaignRegistration[]> {
    return this.prisma.campaignRegistration.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPage(input: CampaignPageInput): Promise<CampaignPage> {
    const where: Prisma.BloodDriveWhereInput = {
      ...(input.facilityScope !== null ? { facilityId: { in: input.facilityScope } } : {}),
      ...(input.publishedOnly ? { status: CampaignStatus.PUBLISHED } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bloodDrive.findMany({
        where,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
        skip: input.offset,
        include: {
          facility: { select: { id: true, name: true, code: true, organizationId: true } },
          _count: { select: { registrations: true } },
        },
      }),
      this.prisma.bloodDrive.count({ where }),
    ]);
    return { items: rows, total, limit: input.limit, offset: input.offset };
  }

  async update(id: string, data: Prisma.BloodDriveUpdateInput): Promise<BloodDrive | null> {
    const existing = await this.prisma.bloodDrive.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    return this.prisma.bloodDrive.update({ where: { id }, data });
  }

  async transitionStatus(id: string, from: CampaignStatus, to: CampaignStatus): Promise<boolean> {
    const result = await this.prisma.bloodDrive.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return result.count > 0;
  }

  async countActiveRegistrations(campaignId: string): Promise<number> {
    return this.prisma.campaignRegistration.count({
      where: { campaignId, status: { not: 'CANCELLED' } },
    });
  }

  async findRegistration(campaignId: string, donorProfileId: string): Promise<CampaignRegistration | null> {
    return this.prisma.campaignRegistration.findUnique({
      where: { campaignId_donorProfileId: { campaignId, donorProfileId } },
    });
  }

  async findRegistrationById(id: string): Promise<CampaignRegistration | null> {
    return this.prisma.campaignRegistration.findUnique({ where: { id } });
  }

  async createRegistration(data: {
    campaignId: string;
    donorProfileId: string;
    registeredById: string;
  }): Promise<CampaignRegistration> {
    return this.prisma.campaignRegistration.create({
      data: {
        campaignId: data.campaignId,
        donorProfileId: data.donorProfileId,
        registeredById: data.registeredById,
      },
    });
  }

  async transitionRegistration(
    id: string,
    from: RegistrationStatus,
    to: RegistrationStatus,
    extra: Prisma.CampaignRegistrationUpdateManyMutationInput = {},
  ): Promise<boolean> {
    const result = await this.prisma.campaignRegistration.updateMany({
      where: { id, status: from },
      data: { status: to, ...extra },
    });
    return result.count > 0;
  }
}