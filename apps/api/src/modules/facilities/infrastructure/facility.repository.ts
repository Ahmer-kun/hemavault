import { Injectable } from '@nestjs/common';
import {
  Facility,
  MembershipStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface FacilityMembershipView {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  status: MembershipStatus;
  roleCode: string;
  roleName: string;
  assignedAt: Date;
}

@Injectable()
export class FacilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.FacilityCreateInput): Promise<Facility> {
    return this.prisma.facility.create({ data });
  }

  async findById(id: string) {
    return this.prisma.facility.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, code: true, status: true } },
      },
    });
  }

  async findByCode(code: string): Promise<Facility | null> {
    return this.prisma.facility.findUnique({ where: { code } });
  }

  async findOrganizationState(id: string): Promise<{ status: string } | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      select: { status: true },
    });
    return organization ?? null;
  }

  async findPage(
    facilityScope: string[] | null,
    limit: number,
    offset: number,
  ): Promise<{ items: Facility[]; total: number }> {
    const where: Prisma.FacilityWhereInput =
      facilityScope === null ? {} : { id: { in: facilityScope } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.facility.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: { organization: { select: { id: true, name: true, code: true, status: true } } },
      }),
      this.prisma.facility.count({ where }),
    ]);
    return { items, total };
  }

  async update(id: string, data: Prisma.FacilityUpdateInput) {
    const existing = await this.prisma.facility.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    return this.prisma.facility.update({
      where: { id },
      data,
      include: {
        organization: { select: { id: true, name: true, code: true, status: true } },
      },
    });
  }

  async findUserStatus(userId: string): Promise<UserStatus | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status ?? null;
  }

  async findRoleByCode(code: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { code } });
  }

  async findMembership(facilityId: string, userId: string, roleId: string) {
    return this.prisma.facilityMembership.findUnique({
      where: {
        userId_facilityId_roleId: { userId, facilityId, roleId },
      },
    });
  }

  async createMembership(data: Prisma.FacilityMembershipUncheckedCreateInput) {
    return this.prisma.facilityMembership.create({
      data,
      include: {
        user: { select: { id: true, email: true, name: true } },
        role: { select: { code: true, name: true } },
      },
    });
  }

  async findMembershipById(facilityId: string, membershipId: string) {
    return this.prisma.facilityMembership.findFirst({
      where: { id: membershipId, facilityId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        role: { select: { code: true, name: true } },
        facility: { select: { organizationId: true } },
      },
    });
  }

  async listMemberships(
    facilityId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FacilityMembershipView[]; total: number }> {
    const where: Prisma.FacilityMembershipWhereInput = { facilityId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.facilityMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        include: {
          user: { select: { id: true, email: true, name: true } },
          role: { select: { code: true, name: true } },
        },
      }),
      this.prisma.facilityMembership.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        status: row.status,
        roleCode: row.role.code,
        roleName: row.role.name,
        assignedAt: row.assignedAt,
      })),
      total,
    };
  }

  async deleteMembership(membershipId: string): Promise<void> {
    await this.prisma.facilityMembership.delete({ where: { id: membershipId } });
  }
}