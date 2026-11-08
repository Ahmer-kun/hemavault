import { UnitState } from '@prisma/client';
import { ExpiryService } from '../../inventory/application/expiry.service';
import { evaluateCompatibility } from './compatibility-evaluator';
import {
  CandidateUnitInput,
  CompatibilityRuleInput,
  EvaluatedCandidate,
  LineMatchResult,
  MatchingExclusionReason,
  RequestLineMatchInput,
} from './matching.types';

const EXCLUDED_STATES: Partial<Record<UnitState, MatchingExclusionReason>> = {
  [UnitState.QUARANTINED]: 'STATE_QUARANTINED',
  [UnitState.RECALLED]: 'STATE_RECALLED',
  [UnitState.DISCARDED]: 'STATE_DISCARDED',
  [UnitState.EXPIRED]: 'STATE_EXPIRED',
  [UnitState.ISSUED]: 'STATE_ISSUED',
  [UnitState.CLOSED]: 'STATE_CLOSED',
  [UnitState.USED]: 'STATE_USED',
  [UnitState.TRANSFER_PENDING]: 'STATE_TRANSFER_PENDING',
  [UnitState.IN_TRANSIT]: 'STATE_IN_TRANSIT',
  [UnitState.RECEIVED]: 'STATE_RECEIVED',
  [UnitState.COLLECTED]: 'STATE_COLLECTED',
};

function exclusionReasons(
  unit: CandidateUnitInput,
  effectiveState: UnitState,
  rules: CompatibilityRuleInput[],
  line: RequestLineMatchInput,
): MatchingExclusionReason[] {
  const reasons: MatchingExclusionReason[] = [];
  if (unit.hasActiveReservationClaim) reasons.push('RESERVED_OR_ACTIVELY_CLAIMED');

  const stateReason = EXCLUDED_STATES[unit.state];
  if (stateReason) reasons.push(stateReason);

  if (effectiveState === UnitState.EXPIRED && !reasons.includes('STATE_EXPIRED')) {
    reasons.push('EFFECTIVELY_EXPIRED');
  }

  // Only evaluate compatibility for units not already excluded by hard inventory state/claim.
  if (reasons.length === 0) {
    if (effectiveState !== UnitState.AVAILABLE) {
      reasons.push('STATE_NOT_AVAILABLE');
    } else {
      const decision = evaluateCompatibility(rules, line, {
        componentTypeId: unit.componentTypeId,
        componentTypeCategory: unit.componentTypeCategory,
        bloodGroup: unit.bloodGroup,
      });
      if (decision.status === 'INCOMPATIBLE') reasons.push('INCOMPATIBLE');
      if (decision.status === 'AMBIGUOUS') reasons.push('COMPATIBILITY_RULE_AMBIGUOUS');
    }
  }
  return [...new Set(reasons)];
}

/**
 * Pure/read-only matching for one request line. No DB writes, no reservation side effects.
 */
export function matchRequestLine(
  line: RequestLineMatchInput,
  candidates: CandidateUnitInput[],
  rules: CompatibilityRuleInput[],
  expiryService: Pick<ExpiryService, 'getEffectiveState'>,
): LineMatchResult {
  const quantityNeeded = Math.max(0, line.quantityRequested - line.quantityReserved - line.quantityIssued);

  const evaluated = candidates.map((unit) => {
    const effectiveState = expiryService.getEffectiveState({ state: unit.state, expiresAt: unit.expiresAt });
    const reasons = exclusionReasons(unit, effectiveState, rules, line);
    return {
      unitId: unit.id,
      publicCode: unit.publicCode,
      componentTypeId: unit.componentTypeId,
      bloodGroup: unit.bloodGroup,
      expiresAt: unit.expiresAt.toISOString(),
      state: unit.state,
      effectiveState,
      eligible: reasons.length === 0,
      exclusionReasons: reasons,
      fefoRank: null as number | null,
      _expiresAtMs: unit.expiresAt.getTime(),
    };
  });

  // FEFO among eligible candidates (policy-permitted default; deterministic).
  const eligible = evaluated
    .filter((c) => c.eligible)
    .sort((a, b) => a._expiresAtMs - b._expiresAtMs || a.publicCode.localeCompare(b.publicCode));
  eligible.forEach((c, idx) => {
    c.fefoRank = idx + 1;
  });
  // Keep ineligible after eligible for operator visibility, preserving deterministic order.
  const ineligible = evaluated
    .filter((c) => !c.eligible)
    .sort((a, b) => a._expiresAtMs - b._expiresAtMs || a.publicCode.localeCompare(b.publicCode));
  const ordered: EvaluatedCandidate[] = [...eligible, ...ineligible].map(({ _expiresAtMs, ...rest }) => rest);

  const quantityEligible = eligible.length;
  return {
    requestLineId: line.id,
    componentTypeId: line.componentTypeId,
    componentTypeCategory: line.componentTypeCategory,
    bloodGroupRequired: line.bloodGroupRequired,
    quantityRequested: line.quantityRequested,
    quantityReserved: line.quantityReserved,
    quantityIssued: line.quantityIssued,
    quantityNeeded,
    quantityEligible,
    shortfall: Math.max(0, quantityNeeded - quantityEligible),
    candidates: ordered,
  };
}
