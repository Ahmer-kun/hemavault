import { Injectable } from '@nestjs/common';
import { Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface OrgPagination {
  items: Organization[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.OrganizationCreateInput): Promise<Organization> {
    return this.prisma.organization.create({ data });
  }

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { code } });
  }

  async findPage(
    facilityScope: string[] | null,
    limit: number,
    offset: number,
  ): Promise<OrgPagination> {
    const where = this.scopeWhere(facilityScope);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async findFacilityIds(organizationId: string): Promise<string[]> {
    const facilities = await this.prisma.facility.findMany({
      where: { organizationId },
      select: { id: true },
    });
    return facilities.map((facility) => facility.id);
  }

  async update(id: string, data: Prisma.OrganizationUpdateInput): Promise<Organization | null> {
    const existing = await this.prisma.organization.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    return this.prisma.organization.update({ where: { id }, data });
  }

  private scopeWhere(facilityScope: string[] | null): Prisma.OrganizationWhereInput {
    if (facilityScope === null) {
      return {};
    }
    return { facilities: { some: { id: { in: facilityScope } } } };
  }
}