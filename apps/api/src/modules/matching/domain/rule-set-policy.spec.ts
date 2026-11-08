import { describe, expect, it } from 'vitest';
import { selectActiveRuleSet } from './rule-set-policy';
import { RuleSetInput } from './matching.types';

function rs(overrides: Partial<RuleSetInput> = {}): RuleSetInput {
  return {
    id: 'rs-1',
    code: 'TEST-RS',
    version: '1.0.0',
    status: 'ACTIVE',
    isNonClinicalFixture: false,
    approvedAt: new Date('2026-01-01T00:00:00Z'),
    approvedBy: 'reviewer',
    effectiveFrom: null,
    effectiveTo: null,
    rules: [],
    ...overrides,
  };
}

describe('selectActiveRuleSet (ADR-018/ADR-040)', () => {
  it('returns MISSING when no candidates exist', () => {
    expect(selectActiveRuleSet([], { allowNonClinicalFixturesInTest: true })).toEqual({
      ok: false,
      reason: 'MISSING',
    });
  });

  it('rejects inactive rule sets', () => {
    expect(selectActiveRuleSet([rs({ status: 'DRAFT' })], { allowNonClinicalFixturesInTest: true })).toEqual({
      ok: false,
      reason: 'INACTIVE',
    });
    expect(selectActiveRuleSet([rs({ status: 'RETIRED' })], { allowNonClinicalFixturesInTest: true })).toEqual({
      ok: false,
      reason: 'INACTIVE',
    });
  });

  it('rejects ambiguous active rule sets', () => {
    const result = selectActiveRuleSet([rs({ id: 'a' }), rs({ id: 'b' })], {
      allowNonClinicalFixturesInTest: true,
    });
    expect(result).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });

  it('rejects unapproved production rule sets', () => {
    const result = selectActiveRuleSet([rs({ approvedAt: null, approvedBy: null })], {
      allowNonClinicalFixturesInTest: true,
    });
    expect(result).toEqual({ ok: false, reason: 'UNAPPROVED' });
  });

  it('rejects rule sets outside effective window', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(
      selectActiveRuleSet([rs({ effectiveFrom: new Date('2026-07-01T00:00:00Z') })], {
        allowNonClinicalFixturesInTest: true,
        now,
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_EFFECTIVE_WINDOW' });
    expect(
      selectActiveRuleSet([rs({ effectiveTo: new Date('2026-05-01T00:00:00Z') })], {
        allowNonClinicalFixturesInTest: true,
        now,
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_EFFECTIVE_WINDOW' });
  });

  it('NEVER allows non-clinical fixtures as production policy', () => {
    const fixture = rs({ isNonClinicalFixture: true, approvedAt: null, approvedBy: null });
    expect(selectActiveRuleSet([fixture], { allowNonClinicalFixturesInTest: false })).toEqual({
      ok: false,
      reason: 'UNAPPROVED',
    });
  });

  it('allows clearly-marked non-clinical fixtures only in isolated test mode', () => {
    const fixture = rs({ isNonClinicalFixture: true, approvedAt: null, approvedBy: null });
    const result = selectActiveRuleSet([fixture], { allowNonClinicalFixturesInTest: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productionEligible).toBe(false);
      expect(result.ruleSet.isNonClinicalFixture).toBe(true);
    }
  });

  it('selects an approved active production rule set with version metadata', () => {
    const result = selectActiveRuleSet([rs({ code: 'PROD-REF', version: '2026.1' })], {
      allowNonClinicalFixturesInTest: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productionEligible).toBe(true);
      expect(result.ruleSet.version).toBe('2026.1');
    }
  });
});
