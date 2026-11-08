import { RuleSetInput } from './matching.types';

export type RuleSetPolicyDecision =
  | { ok: true; ruleSet: RuleSetInput; productionEligible: boolean }
  | { ok: false; reason: 'MISSING' | 'INACTIVE' | 'AMBIGUOUS' | 'UNAPPROVED' | 'OUTSIDE_EFFECTIVE_WINDOW' };

export interface RuleSetPolicyOptions {
  /** Only true in test execution. Non-clinical fixtures must never be usable in production. */
  allowNonClinicalFixturesInTest: boolean;
  now?: Date;
}

function isWithinEffectiveWindow(ruleSet: RuleSetInput, now: Date): boolean {
  if (ruleSet.effectiveFrom && ruleSet.effectiveFrom.getTime() > now.getTime()) return false;
  if (ruleSet.effectiveTo && ruleSet.effectiveTo.getTime() < now.getTime()) return false;
  return true;
}

/**
 * Selects an active rule set and enforces ADR-018/ADR-040 safety boundaries.
 * - Missing/inactive/ambiguous/out-of-window => unavailable.
 * - Non-clinical fixtures are usable ONLY in isolated tests when explicitly allowed.
 * - Production matching is never enabled for fixtures or unapproved datasets.
 */
export function selectActiveRuleSet(
  candidates: RuleSetInput[],
  options: RuleSetPolicyOptions,
): RuleSetPolicyDecision {
  const now = options.now ?? new Date();
  const active = candidates.filter((c) => c.status === 'ACTIVE' && isWithinEffectiveWindow(c, now));
  if (active.length === 0) {
    const any = candidates[0];
    if (!any) return { ok: false, reason: 'MISSING' };
    if (any.status !== 'ACTIVE') return { ok: false, reason: 'INACTIVE' };
    return { ok: false, reason: 'OUTSIDE_EFFECTIVE_WINDOW' };
  }
  if (active.length > 1) {
    // Deterministic tie-breaker: prefer most recently approved/updated production sets only when unambiguous;
    // but ambiguity is safer to reject.
    return { ok: false, reason: 'AMBIGUOUS' };
  }
  const ruleSet = active[0]!;
  const productionEligible = !ruleSet.isNonClinicalFixture && !!(ruleSet.approvedAt || ruleSet.approvedBy);
  if (ruleSet.isNonClinicalFixture) {
    if (!options.allowNonClinicalFixturesInTest) return { ok: false, reason: 'UNAPPROVED' };
    return { ok: true, ruleSet, productionEligible: false };
  }
  if (!productionEligible) return { ok: false, reason: 'UNAPPROVED' };
  return { ok: true, ruleSet, productionEligible: true };
}
