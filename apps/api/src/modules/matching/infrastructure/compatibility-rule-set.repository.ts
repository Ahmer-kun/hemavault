import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { RuleSetInput } from '../domain/matching.types';

@Injectable()
export class CompatibilityRuleSetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveCandidates(): Promise<RuleSetInput[]> {
    // Fetch a small candidate set (ACTIVE first) so the policy selector can return
    // explicit reasons (missing/inactive/ambiguous/unapproved/outside window).
    const rows = await this.prisma.compatibilityRuleSet.findMany({
      include: { rules: true },
      orderBy: [{ status: 'asc' }, { approvedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      version: r.version,
      status: r.status,
      isNonClinicalFixture: r.isNonClinicalFixture,
      approvedAt: r.approvedAt,
      approvedBy: r.approvedBy,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      rules: r.rules.map((rule) => ({
        id: rule.id,
        componentCategory: rule.componentCategory,
        componentTypeId: rule.componentTypeId,
        recipientBloodGroup: rule.recipientBloodGroup,
        donorBloodGroup: rule.donorBloodGroup,
        isCompatible: rule.isCompatible,
        priority: rule.priority,
      })),
    }));
  }
}
