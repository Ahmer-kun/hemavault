import { BloodGroup, ComponentCategory, UnitState } from '@prisma/client';

export type MatchingExclusionReason =
  | 'STATE_QUARANTINED'
  | 'STATE_RECALLED'
  | 'STATE_DISCARDED'
  | 'STATE_EXPIRED'
  | 'STATE_ISSUED'
  | 'STATE_CLOSED'
  | 'STATE_USED'
  | 'STATE_TRANSFER_PENDING'
  | 'STATE_IN_TRANSIT'
  | 'STATE_RECEIVED'
  | 'STATE_COLLECTED'
  | 'STATE_NOT_AVAILABLE'
  | 'RESERVED_OR_ACTIVELY_CLAIMED'
  | 'EFFECTIVELY_EXPIRED'
  | 'INCOMPATIBLE'
  | 'COMPATIBILITY_RULE_AMBIGUOUS';

export interface CompatibilityRuleInput {
  id: string;
  componentCategory: ComponentCategory | null;
  componentTypeId: string | null;
  recipientBloodGroup: BloodGroup | null;
  donorBloodGroup: BloodGroup | null;
  isCompatible: boolean;
  priority: number;
}

export interface RuleSetInput {
  id: string;
  code: string;
  version: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  isNonClinicalFixture: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  rules: CompatibilityRuleInput[];
}

export interface RequestLineMatchInput {
  id: string;
  componentTypeId: string;
  componentTypeCategory: ComponentCategory;
  bloodGroupRequired: BloodGroup | null;
  quantityRequested: number;
  quantityReserved: number;
  quantityIssued: number;
}

export interface CandidateUnitInput {
  id: string;
  publicCode: string;
  componentTypeId: string;
  componentTypeCategory: ComponentCategory;
  bloodGroup: BloodGroup;
  state: UnitState;
  expiresAt: Date;
  facilityId: string;
  hasActiveReservationClaim: boolean;
}

export interface EvaluatedCandidate {
  unitId: string;
  publicCode: string;
  componentTypeId: string;
  bloodGroup: string;
  expiresAt: string;
  state: string;
  effectiveState: string;
  eligible: boolean;
  exclusionReasons: MatchingExclusionReason[];
  fefoRank: number | null;
}

export interface LineMatchResult {
  requestLineId: string;
  componentTypeId: string;
  componentTypeCategory: string;
  bloodGroupRequired: string | null;
  quantityRequested: number;
  quantityReserved: number;
  quantityIssued: number;
  quantityNeeded: number;
  quantityEligible: number;
  shortfall: number;
  candidates: EvaluatedCandidate[];
}

export interface MatchingResult {
  requestId: string;
  facilityId: string;
  matchedAt: string;
  ruleSet: {
    id: string;
    code: string;
    version: string;
    isNonClinicalFixture: boolean;
  };
  advisoryNotice: string;
  lines: LineMatchResult[];
}
