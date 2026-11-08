import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BloodGroup, BloodRequestStatus, ComponentCategory, RequestUrgency, UnitState } from '@prisma/client';
import { MatchingService } from './matching.service';
import { ExpiryService } from '../../inventory/application/expiry.service';

function actor(overrides: { userId?: string; global?: string[]; facilityId?: string; facilityPerms?: string[] } = {}) {
  const facilityPermissions = new Map<string, ReadonlySet<string>>();
  if (overrides.facilityId && overrides.facilityPerms) {
    facilityPermissions.set(overrides.facilityId, new Set(overrides.facilityPerms));
  }
  return {
    userId: overrides.userId ?? 'u1',
    sessionId: 's1',
    globalPermissions: new Set(overrides.global ?? []),
    facilityPermissions,
  } as any;
}

function requestRow(facilityId = 'fac-1') {
  return {
    id: 'req-1',
    publicCode: 'REQ-1',
    facilityId,
    requestedByUserId: 'u1',
    urgency: RequestUrgency.NORMAL,
    status: BloodRequestStatus.APPROVED,
    facility: { id: facilityId, name: 'F', code: 'F1', organizationId: 'org-1' },
    requestedBy: { id: 'u1', email: 'u@test', name: 'U' },
    lines: [
      {
        id: 'line-1',
        requestId: 'req-1',
        componentTypeId: 'ct-1',
        bloodGroupRequired: BloodGroup.A_POS,
        quantityRequested: 1,
        quantityReserved: 0,
        quantityIssued: 0,
        notes: null,
        componentType: { id: 'ct-1', code: 'RBC', name: 'RBC', category: ComponentCategory.RED_CELLS },
      },
    ],
  } as any;
}

describe('MatchingService', () => {
  let prisma: any;
  let requestRepository: any;
  let ruleSetRepository: any;
  let expiryService: any;
  let config: any;
  let service: MatchingService;

  beforeEach(() => {
    prisma = {
      bloodComponentUnit: { findMany: vi.fn().mockResolvedValue([]) },
    };
    requestRepository = { findById: vi.fn() };
    ruleSetRepository = { findActiveCandidates: vi.fn() };
    expiryService = { getEffectiveState: vi.fn().mockReturnValue(UnitState.AVAILABLE) } as Partial<ExpiryService>;
    config = { get: vi.fn().mockReturnValue('test') };
    service = new MatchingService(prisma, requestRepository, ruleSetRepository, expiryService, config);
  });

  it('returns MATCHING_POLICY_UNAVAILABLE when no approved policy exists', async () => {
    requestRepository.findById.mockResolvedValue(requestRow());
    ruleSetRepository.findActiveCandidates.mockResolvedValue([]);
    await expect(service.getMatches(actor({ global: ['request.read'] }), 'req-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MATCHING_POLICY_UNAVAILABLE' }),
    });
    expect(prisma.bloodComponentUnit.findMany).not.toHaveBeenCalled();
  });

  it('rejects inactive policy', async () => {
    requestRepository.findById.mockResolvedValue(requestRow());
    ruleSetRepository.findActiveCandidates.mockResolvedValue([
      { id: 'rs', code: 'C', version: '1', status: 'DRAFT', isNonClinicalFixture: false, approvedAt: new Date(), approvedBy: 'a', effectiveFrom: null, effectiveTo: null, rules: [] },
    ]);
    await expect(service.getMatches(actor({ global: ['request.read'] }), 'req-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MATCHING_POLICY_UNAVAILABLE' }),
    });
  });

  it('returns matches with rule-set version and advisory notice (read-only)', async () => {
    requestRepository.findById.mockResolvedValue(requestRow());
    ruleSetRepository.findActiveCandidates.mockResolvedValue([
      {
        id: 'rs1', code: 'FIXTURE-NONCLINICAL', version: 'test-v1', status: 'ACTIVE',
        isNonClinicalFixture: true, approvedAt: null, approvedBy: null, effectiveFrom: null, effectiveTo: null,
        rules: [{ id: 'r1', componentCategory: null, componentTypeId: 'ct-1', recipientBloodGroup: BloodGroup.A_POS, donorBloodGroup: BloodGroup.A_POS, isCompatible: true, priority: 1 }],
      },
    ]);
    prisma.bloodComponentUnit.findMany.mockResolvedValue([
      {
        id: 'u1', publicCode: 'UNIT-1', componentTypeId: 'ct-1', bloodGroup: BloodGroup.A_POS,
        state: UnitState.AVAILABLE, expiresAt: new Date(Date.now() + 86400000), facilityId: 'fac-1',
        componentType: { category: ComponentCategory.RED_CELLS }, reservationItems: [],
      },
    ]);
    const result = await service.getMatches(actor({ global: ['request.read'] }), 'req-1');
    expect(result.ruleSet.version).toBe('test-v1');
    expect(result.ruleSet.isNonClinicalFixture).toBe(true);
    expect(result.advisoryNotice).toMatch(/not a clinical decision/i);
    expect(result.lines[0]?.quantityEligible).toBe(1);
    expect(prisma.bloodComponentUnit.create).toBeUndefined();
    expect(prisma.reservation?.create).toBeUndefined();
  });

  it('masks out-of-scope requests as 404', async () => {
    requestRepository.findById.mockResolvedValue(requestRow('fac-other'));
    await expect(
      service.getMatches(actor({ facilityId: 'fac-1', facilityPerms: ['request.read'] }), 'req-1'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }) });
  });
});
