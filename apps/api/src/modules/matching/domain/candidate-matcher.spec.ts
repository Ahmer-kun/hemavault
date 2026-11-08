import { describe, expect, it } from 'vitest';
import { BloodGroup, ComponentCategory, UnitState } from '@prisma/client';
import { matchRequestLine } from './candidate-matcher';
import { CandidateUnitInput, CompatibilityRuleInput, RequestLineMatchInput } from './matching.types';

const expiry = {
  getEffectiveState: (unit: { state: UnitState; expiresAt: Date }) => {
    if (unit.state !== UnitState.AVAILABLE && unit.state !== UnitState.RESERVED) return unit.state;
    return unit.expiresAt.getTime() <= Date.now() ? UnitState.EXPIRED : unit.state;
  },
};

const line: RequestLineMatchInput = {
  id: 'line-1',
  componentTypeId: 'ct-1',
  componentTypeCategory: ComponentCategory.RED_CELLS,
  bloodGroupRequired: BloodGroup.A_POS,
  quantityRequested: 2,
  quantityReserved: 0,
  quantityIssued: 0,
};

// NON-CLINICAL fixture rule: same donor group marked compatible for this test component/recipient context.
const allowSameGroupRule: CompatibilityRuleInput = {
  id: 'fixture-allow-same',
  componentCategory: null,
  componentTypeId: 'ct-1',
  recipientBloodGroup: BloodGroup.A_POS,
  donorBloodGroup: BloodGroup.A_POS,
  isCompatible: true,
  priority: 1,
};

function unit(overrides: Partial<CandidateUnitInput> = {}): CandidateUnitInput {
  return {
    id: overrides.id ?? 'u1',
    publicCode: overrides.publicCode ?? 'UNIT-1',
    componentTypeId: 'ct-1',
    componentTypeCategory: ComponentCategory.RED_CELLS,
    bloodGroup: BloodGroup.A_POS,
    state: UnitState.AVAILABLE,
    expiresAt: new Date(Date.now() + 10 * 86400000),
    facilityId: 'fac-1',
    hasActiveReservationClaim: false,
    ...overrides,
  };
}

describe('matchRequestLine (NON-CLINICAL fixture rules)', () => {
  it('excludes quarantined, recalled, discarded, expired, issued, closed, used, transfer/in-transit, and reserved units', () => {
    const cases: Array<[Partial<CandidateUnitInput>, string]> = [
      [{ state: UnitState.QUARANTINED }, 'STATE_QUARANTINED'],
      [{ state: UnitState.RECALLED }, 'STATE_RECALLED'],
      [{ state: UnitState.DISCARDED }, 'STATE_DISCARDED'],
      [{ state: UnitState.EXPIRED }, 'STATE_EXPIRED'],
      [{ state: UnitState.ISSUED }, 'STATE_ISSUED'],
      [{ state: UnitState.CLOSED }, 'STATE_CLOSED'],
      [{ state: UnitState.USED }, 'STATE_USED'],
      [{ state: UnitState.TRANSFER_PENDING }, 'STATE_TRANSFER_PENDING'],
      [{ state: UnitState.IN_TRANSIT }, 'STATE_IN_TRANSIT'],
      [{ hasActiveReservationClaim: true }, 'RESERVED_OR_ACTIVELY_CLAIMED'],
    ];
    for (const [override, reason] of cases) {
      const result = matchRequestLine(line, [unit({ id: reason, ...override })], [allowSameGroupRule], expiry);
      expect(result.candidates[0]?.eligible).toBe(false);
      expect(result.candidates[0]?.exclusionReasons).toContain(reason);
    }
  });

  it('excludes effectively expired AVAILABLE units via expiry classification', () => {
    const result = matchRequestLine(
      line,
      [unit({ id: 'old', expiresAt: new Date(Date.now() - 60000) })],
      [allowSameGroupRule],
      expiry,
    );
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.effectiveState).toBe(UnitState.EXPIRED);
    expect(result.candidates[0]?.exclusionReasons).toContain('EFFECTIVELY_EXPIRED');
  });

  it('applies FEFO ordering to eligible candidates', () => {
    const result = matchRequestLine(
      line,
      [
        unit({ id: 'later', publicCode: 'B', expiresAt: new Date(Date.now() + 20 * 86400000) }),
        unit({ id: 'sooner', publicCode: 'A', expiresAt: new Date(Date.now() + 5 * 86400000) }),
        unit({ id: 'middle', publicCode: 'C', expiresAt: new Date(Date.now() + 10 * 86400000) }),
      ],
      [allowSameGroupRule],
      expiry,
    );
    expect(result.candidates.filter((c) => c.eligible).map((c) => c.unitId)).toEqual(['sooner', 'middle', 'later']);
    expect(result.candidates.find((c) => c.unitId === 'sooner')?.fefoRank).toBe(1);
  });

  it('computes partial matching and shortfall', () => {
    const result = matchRequestLine(
      { ...line, quantityRequested: 5, quantityReserved: 1, quantityIssued: 1 },
      [unit({ id: 'u1' }), unit({ id: 'u2', publicCode: 'UNIT-2' })],
      [allowSameGroupRule],
      expiry,
    );
    expect(result.quantityNeeded).toBe(3);
    expect(result.quantityEligible).toBe(2);
    expect(result.shortfall).toBe(1);
  });

  it('is read-only/pure and does not mutate inputs', () => {
    const candidates = [unit({ id: 'u1' })];
    const rules = [allowSameGroupRule];
    const before = JSON.stringify({ candidates, rules, line });
    matchRequestLine(line, candidates, rules, expiry);
    expect(JSON.stringify({ candidates, rules, line })).toBe(before);
  });

  it('marks incompatible units with operational reason', () => {
    const result = matchRequestLine(
      line,
      [unit({ id: 'u1', bloodGroup: BloodGroup.B_POS })],
      [allowSameGroupRule],
      expiry,
    );
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.exclusionReasons).toContain('INCOMPATIBLE');
  });
});
