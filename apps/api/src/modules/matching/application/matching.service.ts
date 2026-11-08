import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnitState } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { ExpiryService } from '../../inventory/application/expiry.service';
import { ActorContext, canAtFacility } from '../../rbac/domain/policy';
import { RequestRepository } from '../../requests/infrastructure/request.repository';
import { requestNotFoundError, matchingPolicyUnavailableError, matchingRuleSetAmbiguousError } from '../../requests/domain/request.errors';
import { selectActiveRuleSet } from '../domain/rule-set-policy';
import { matchRequestLine } from '../domain/candidate-matcher';
import { CompatibilityRuleSetRepository } from '../infrastructure/compatibility-rule-set.repository';
import { CandidateUnitInput, MatchingResult, RequestLineMatchInput } from '../domain/matching.types';

export interface MatchesQuery {
  limitPerLine?: number;
}

const DEFAULT_LIMIT_PER_LINE = 50;
const MAX_LIMIT_PER_LINE = 200;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestRepository: RequestRepository,
    private readonly ruleSetRepository: CompatibilityRuleSetRepository,
    private readonly expiryService: ExpiryService,
    private readonly config: ConfigService,
  ) {}

  private async getScopedRequest(actor: ActorContext, requestId: string) {
    const request = await this.requestRepository.findById(requestId);
    if (!request) throw requestNotFoundError();
    if (actor.globalPermissions.has('request.read')) return request;
    if (canAtFacility(actor, request.facilityId, 'request.read')) return request;
    throw requestNotFoundError(); // 404 masking
  }

  private resolveRuleSetOrThrow() {
    return this.ruleSetRepository.findActiveCandidates().then((candidates) => {
      const decision = selectActiveRuleSet(candidates, {
        allowNonClinicalFixturesInTest: this.config.get<string>('NODE_ENV') === 'test',
      });
      if (!decision.ok) {
        if (decision.reason === 'AMBIGUOUS') throw matchingRuleSetAmbiguousError();
        throw matchingPolicyUnavailableError(decision.reason);
      }
      if (decision.ruleSet.isNonClinicalFixture) {
        // Extra defense: never expose fixture-backed matching as production behavior.
        // selectActiveRuleSet only allows fixtures in test mode.
      }
      return decision.ruleSet;
    });
  }

  async getMatches(actor: ActorContext, requestId: string, query: MatchesQuery = {}): Promise<MatchingResult> {
    const request = await this.getScopedRequest(actor, requestId);
    const ruleSet = await this.resolveRuleSetOrThrow();

    const limitPerLine = Math.min(
      Math.max(query.limitPerLine ?? DEFAULT_LIMIT_PER_LINE, 1),
      MAX_LIMIT_PER_LINE,
    );

    const lines: RequestLineMatchInput[] = request.lines.map((l) => ({
      id: l.id,
      componentTypeId: l.componentTypeId,
      componentTypeCategory: l.componentType.category,
      bloodGroupRequired: l.bloodGroupRequired,
      quantityRequested: l.quantityRequested,
      quantityReserved: l.quantityReserved,
      quantityIssued: l.quantityIssued,
    }));

    const lineResults = [];
    for (const line of lines) {
      // Candidate pool is bounded and facility-scoped. We fetch enough to explain exclusions
      // and satisfy FEFO/partial matching without scanning the whole facility.
      const units = await this.prisma.bloodComponentUnit.findMany({
        where: {
          facilityId: request.facilityId,
          componentTypeId: line.componentTypeId,
        },
        select: {
          id: true,
          publicCode: true,
          componentTypeId: true,
          bloodGroup: true,
          state: true,
          expiresAt: true,
          facilityId: true,
          componentType: { select: { category: true } },
          reservationItems: {
            where: { isActive: true },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: [{ expiresAt: 'asc' }, { publicCode: 'asc' }],
        take: Math.max(limitPerLine * 4, 100),
      });

      const candidates: CandidateUnitInput[] = units.map((u) => ({
        id: u.id,
        publicCode: u.publicCode,
        componentTypeId: u.componentTypeId,
        componentTypeCategory: u.componentType.category,
        bloodGroup: u.bloodGroup,
        state: u.state as UnitState,
        expiresAt: u.expiresAt,
        facilityId: u.facilityId,
        hasActiveReservationClaim: u.reservationItems.length > 0,
      }));

      const result = matchRequestLine(line, candidates, ruleSet.rules, this.expiryService);
      result.candidates = result.candidates.slice(0, limitPerLine);
      lineResults.push(result);
    }

    return {
      requestId: request.id,
      facilityId: request.facilityId,
      matchedAt: new Date().toISOString(),
      ruleSet: {
        id: ruleSet.id,
        code: ruleSet.code,
        version: ruleSet.version,
        isNonClinicalFixture: ruleSet.isNonClinicalFixture,
      },
      advisoryNotice:
        'Operational matching only. Results are based on the configured compatibility rule set and inventory eligibility checks; they are not a clinical decision or autonomous approval.',
      lines: lineResults,
    };
  }
}
