import { BloodGroup, ComponentCategory } from '@prisma/client';
import { CompatibilityRuleInput, RequestLineMatchInput } from './matching.types';

export type CompatibilityDecision =
  | { status: 'COMPATIBLE'; ruleId: string }
  | { status: 'INCOMPATIBLE'; ruleId: string | null }
  | { status: 'AMBIGUOUS'; ruleIds: string[] };

function specificity(rule: CompatibilityRuleInput): number {
  let s = 0;
  if (rule.componentTypeId !== null) s += 8;
  if (rule.componentCategory !== null) s += 4;
  if (rule.recipientBloodGroup !== null) s += 2;
  if (rule.donorBloodGroup !== null) s += 1;
  return s;
}

function applies(
  rule: CompatibilityRuleInput,
  line: Pick<RequestLineMatchInput, 'componentTypeId' | 'componentTypeCategory' | 'bloodGroupRequired'>,
  donor: { componentTypeId: string; componentTypeCategory: ComponentCategory; bloodGroup: BloodGroup },
): boolean {
  if (rule.componentTypeId !== null && rule.componentTypeId !== line.componentTypeId) return false;
  if (
    rule.componentCategory !== null &&
    rule.componentCategory !== line.componentTypeCategory &&
    rule.componentCategory !== donor.componentTypeCategory
  ) {
    return false;
  }
  if (rule.recipientBloodGroup !== null) {
    // Only apply recipient-constrained rules when the request line specifies that recipient group.
    if (line.bloodGroupRequired === null) return false;
    if (rule.recipientBloodGroup !== line.bloodGroupRequired) return false;
  }
  if (rule.donorBloodGroup !== null && rule.donorBloodGroup !== donor.bloodGroup) return false;
  return true;
}

/**
 * Evaluates compatibility using ONLY rules provided by the resolved rule set.
 * This is technical policy evaluation; it does not invent clinical values.
 * Rule data must come from an approved/versioned source (ADR-018/ADR-040).
 */
export function evaluateCompatibility(
  rules: CompatibilityRuleInput[],
  line: Pick<RequestLineMatchInput, 'componentTypeId' | 'componentTypeCategory' | 'bloodGroupRequired'>,
  donor: { componentTypeId: string; componentTypeCategory: ComponentCategory; bloodGroup: BloodGroup },
): CompatibilityDecision {
  const matching = rules.filter((r) => applies(r, line, donor));
  if (matching.length === 0) {
    return { status: 'INCOMPATIBLE', ruleId: null };
  }

  const ranked = [...matching].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return specificity(b) - specificity(a);
  });
  const top = ranked[0]!;
  const topGroup = ranked.filter(
    (r) => r.priority === top.priority && specificity(r) === specificity(top),
  );
  const compatible = topGroup.filter((r) => r.isCompatible);
  const incompatible = topGroup.filter((r) => !r.isCompatible);
  if (compatible.length > 0 && incompatible.length > 0) {
    return { status: 'AMBIGUOUS', ruleIds: topGroup.map((r) => r.id) };
  }
  if (top.isCompatible) return { status: 'COMPATIBLE', ruleId: top.id };
  return { status: 'INCOMPATIBLE', ruleId: top.id };
}
