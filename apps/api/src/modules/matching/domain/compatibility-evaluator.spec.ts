import { describe, expect, it } from 'vitest';
import { BloodGroup, ComponentCategory } from '@prisma/client';
import { evaluateCompatibility } from './compatibility-evaluator';
import { CompatibilityRuleInput } from './matching.types';

const line = {
  componentTypeId: 'ct-rbc',
  componentTypeCategory: ComponentCategory.RED_CELLS,
  bloodGroupRequired: BloodGroup.A_POS,
};
const donor = {
  componentTypeId: 'ct-rbc',
  componentTypeCategory: ComponentCategory.RED_CELLS,
  bloodGroup: BloodGroup.A_POS,
};

function rule(overrides: Partial<CompatibilityRuleInput>): CompatibilityRuleInput {
  return {
    id: 'r1',
    componentCategory: null,
    componentTypeId: null,
    recipientBloodGroup: null,
    donorBloodGroup: null,
    isCompatible: true,
    priority: 0,
    ...overrides,
  };
}

describe('evaluateCompatibility (technical rule evaluation, NON-CLINICAL fixture data)', () => {
  it('returns INCOMPATIBLE when no rule matches', () => {
    expect(evaluateCompatibility([], line, donor)).toEqual({ status: 'INCOMPATIBLE', ruleId: null });
  });

  it('matches a specific compatible rule', () => {
    const result = evaluateCompatibility(
      [rule({ id: 'ok', recipientBloodGroup: BloodGroup.A_POS, donorBloodGroup: BloodGroup.A_POS, isCompatible: true })],
      line,
      donor,
    );
    expect(result).toEqual({ status: 'COMPATIBLE', ruleId: 'ok' });
  });

  it('respects component type/category constraints', () => {
    const result = evaluateCompatibility(
      [rule({ id: 'wrong-ct', componentTypeId: 'ct-plasma', isCompatible: true })],
      line,
      donor,
    );
    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('uses priority then specificity', () => {
    const result = evaluateCompatibility(
      [
        rule({ id: 'low', priority: 1, isCompatible: false }),
        rule({ id: 'high', priority: 10, donorBloodGroup: BloodGroup.A_POS, isCompatible: true }),
      ],
      line,
      donor,
    );
    expect(result).toEqual({ status: 'COMPATIBLE', ruleId: 'high' });
  });

  it('returns AMBIGUOUS for conflicting top-precedence rules', () => {
    const result = evaluateCompatibility(
      [
        rule({ id: 'a', priority: 5, isCompatible: true }),
        rule({ id: 'b', priority: 5, isCompatible: false }),
      ],
      line,
      donor,
    );
    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') expect(result.ruleIds.sort()).toEqual(['a', 'b']);
  });

  it('does not apply recipient-constrained rules when line has no required group', () => {
    const result = evaluateCompatibility(
      [rule({ id: 'r', recipientBloodGroup: BloodGroup.A_POS, isCompatible: true })],
      { ...line, bloodGroupRequired: null },
      donor,
    );
    expect(result.status).toBe('INCOMPATIBLE');
  });
});
