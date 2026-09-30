import { MembershipStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

export interface FacilityScopeLoad {
  facilityId: string;
  permissions: string[];
}

@Injectable()
export class RbacRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadGlobalPermissions(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            rolePermissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    return userRoles.flatMap((assignment) =>
      assignment.role.rolePermissions.map((item) => item.permission.code),
    );
  }

  async loadGlobalRoleCodes(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { code: true } } },
    });
    return userRoles.map((assignment) => assignment.role.code);
  }

  async loadFacilityScopes(userId: string): Promise<FacilityScopeLoad[]> {
    const memberships = await this.prisma.facilityMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      select: {
        facilityId: true,
        role: {
          select: {
            rolePermissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    return memberships.map((membership) => ({
      facilityId: membership.facilityId,
      permissions: membership.role.rolePermissions.map((item) => item.permission.code),
    }));
  }

  async loadMemberships(userId: string): Promise<
    {
      id: string;
      facilityId: string;
      status: MembershipStatus;
      roleCode: string;
      facility: { code: string; name: string; organization: { id: string; name: string; code: string } };
    }[]
  > {
    const rows = await this.prisma.facilityMembership.findMany({
      where: { userId },
      select: {
        id: true,
        facilityId: true,
        status: true,
        role: { select: { code: true } },
        facility: {
          select: {
            code: true,
            name: true,
            organization: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      facilityId: row.facilityId,
      status: row.status,
      roleCode: row.role.code,
      facility: row.facility,
    }));
  }
}