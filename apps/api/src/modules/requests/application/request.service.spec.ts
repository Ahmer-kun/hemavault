import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BloodRequestStatus, RequestUrgency } from '@prisma/client';
import { RequestService } from './request.service';
import type { ActorContext } from '../../rbac/domain/policy';

function actor(overrides: Partial<ActorContext> & { facilityId?: string; facilityPerms?: string[] } = {}): ActorContext {
  const { facilityId, facilityPerms, ...rest } = overrides;
  const facilityPermissions = new Map<string, ReadonlySet<string>>();
  if (facilityId && facilityPerms) facilityPermissions.set(facilityId, new Set(facilityPerms));
  return {
    userId: rest.userId ?? 'user-1',
    sessionId: 'sess-1',
    globalPermissions: new Set(rest.globalPermissions ?? []),
    facilityPermissions: rest.facilityPermissions ?? facilityPermissions,
  };
}

function requestRow(status: BloodRequestStatus, facilityId = 'fac-1', orgId = 'org-1') {
  return {
    id: 'req-1',
    publicCode: 'REQ-TEST1234',
    facilityId,
    requestedByUserId: 'user-1',
    urgency: RequestUrgency.NORMAL,
    status,
    requiredByAt: null,
    patientReferenceCode: null,
    operationalNotes: null,
    rejectionReason: null,
    cancellationReason: null,
    emergencyEscalatedAt: null,
    submittedAt: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    fulfilledAt: null,
    expiredAt: null,
    ruleSetVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    facility: { id: facilityId, name: 'F', code: 'F1', organizationId: orgId },
    requestedBy: { id: 'user-1', email: 'u@test.local', name: 'U' },
    lines: [
      {
        id: 'line-1',
        requestId: 'req-1',
        componentTypeId: 'ct-1',
        bloodGroupRequired: null,
        quantityRequested: 2,
        quantityReserved: 0,
        quantityIssued: 0,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        componentType: { id: 'ct-1', code: 'WB', name: 'Whole Blood', category: 'WHOLE_BLOOD' },
      },
    ],
  } as any;
}

describe('RequestService', () => {
  let repo: any;
  let audit: any;
  let service: RequestService;
  const ctx = { requestId: 'rid', ipAddress: null, userAgent: null };

  beforeEach(() => {
    repo = {
      findActiveFacility: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      setStatus: vi.fn(),
      setStatusIfCurrent: vi.fn(),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new RequestService(repo, audit);
  });

  it('creates a draft request with audit and quantity validation', async () => {
    repo.findActiveFacility.mockResolvedValue({ id: 'fac-1', organizationId: 'org-1', status: 'ACTIVE', name: 'F', code: 'F1' });
    repo.createDraft.mockImplementation(async () => requestRow(BloodRequestStatus.DRAFT));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.self.create', 'request.read'] });
    const result = await service.create(
      a,
      { facilityId: 'fac-1', lines: [{ componentTypeId: 'ct-1', quantityRequested: 1 }] } as any,
      ctx,
    );
    expect(result.status).toBe(BloodRequestStatus.DRAFT);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'request.created' }));
  });

  it('records an explicit escalation audit action for emergency creation', async () => {
    repo.findActiveFacility.mockResolvedValue({ id: 'fac-1', organizationId: 'org-1', status: 'ACTIVE', name: 'F', code: 'F1' });
    const emergencyRow = requestRow(BloodRequestStatus.DRAFT);
    emergencyRow.urgency = RequestUrgency.EMERGENCY;
    emergencyRow.emergencyEscalatedAt = new Date();
    repo.createDraft.mockResolvedValue(emergencyRow);
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.self.create', 'request.read'] });
    const result = await service.create(
      a,
      {
        facilityId: 'fac-1',
        urgency: RequestUrgency.EMERGENCY,
        lines: [{ componentTypeId: 'ct-1', quantityRequested: 1 }],
      } as any,
      ctx,
    );
    expect(result.urgency).toBe(RequestUrgency.EMERGENCY);
    expect(result.emergencyEscalatedAt).toBeTruthy();
    const actions = audit.record.mock.calls.map(([event]: [{ action: string }]) => event.action);
    expect(actions).toContain('request.created');
    expect(actions).toContain('request.emergency_escalated');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'request.emergency_escalated',
        metadata: expect.objectContaining({
          urgency: RequestUrgency.EMERGENCY,
          alertRequired: true,
          notificationDelivery: 'DEFERRED_PHASE_6',
        }),
      }),
    );
  });

  it('does not record an escalation audit for normal or urgent requests', async () => {
    repo.findActiveFacility.mockResolvedValue({ id: 'fac-1', organizationId: 'org-1', status: 'ACTIVE', name: 'F', code: 'F1' });
    repo.createDraft.mockResolvedValue(requestRow(BloodRequestStatus.DRAFT));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.self.create', 'request.read'] });
    await service.create(
      a,
      {
        facilityId: 'fac-1',
        urgency: RequestUrgency.URGENT,
        lines: [{ componentTypeId: 'ct-1', quantityRequested: 1 }],
      } as any,
      ctx,
    );
    const actions = audit.record.mock.calls.map(([event]: [{ action: string }]) => event.action);
    expect(actions).toContain('request.created');
    expect(actions).not.toContain('request.emergency_escalated');
  });

  it('escalates and de-escalates a draft with audit while preserving the first escalation time', async () => {
    const draft = requestRow(BloodRequestStatus.DRAFT);
    const escalatedAt = new Date('2026-11-10T09:00:00.000Z');
    const escalated = requestRow(BloodRequestStatus.DRAFT);
    escalated.urgency = RequestUrgency.CRITICAL;
    escalated.emergencyEscalatedAt = escalatedAt;
    const stillEscalated = requestRow(BloodRequestStatus.DRAFT);
    stillEscalated.urgency = RequestUrgency.EMERGENCY;
    stillEscalated.emergencyEscalatedAt = escalatedAt;
    const downgraded = requestRow(BloodRequestStatus.DRAFT);
    downgraded.urgency = RequestUrgency.URGENT;
    downgraded.emergencyEscalatedAt = null;

    repo.findById
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(escalated)
      .mockResolvedValueOnce(stillEscalated);
    repo.updateDraft
      .mockResolvedValueOnce(escalated)
      .mockResolvedValueOnce(stillEscalated)
      .mockResolvedValueOnce(downgraded);

    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.self.create'] });
    const raised = await service.update(a, 'req-1', { urgency: RequestUrgency.CRITICAL } as any, ctx);
    expect(raised.emergencyEscalatedAt).toEqual(escalatedAt);

    const repeated = await service.update(a, 'req-1', { urgency: RequestUrgency.EMERGENCY } as any, ctx);
    expect(repeated.emergencyEscalatedAt).toEqual(escalatedAt);

    const lowered = await service.update(a, 'req-1', { urgency: RequestUrgency.URGENT } as any, ctx);
    expect(lowered.emergencyEscalatedAt).toBeNull();

    const actions = audit.record.mock.calls.map(([event]: [{ action: string }]) => event.action);
    expect(actions.filter((action: string) => action === 'request.emergency_escalated')).toHaveLength(1);
    expect(actions.filter((action: string) => action === 'request.emergency_deescalated')).toHaveLength(1);
  });

  it('rejects create with invalid quantity', async () => {
    repo.findActiveFacility.mockResolvedValue({ id: 'fac-1', organizationId: 'org-1', status: 'ACTIVE' });
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.self.create'] });
    await expect(
      service.create(a, { facilityId: 'fac-1', lines: [{ componentTypeId: 'ct-1', quantityRequested: 0 }] } as any, ctx),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REQUEST_LINES_REQUIRED' }) });
  });

  it('rejects create without permission', async () => {
    repo.findActiveFacility.mockResolvedValue({ id: 'fac-1', organizationId: 'org-1', status: 'ACTIVE' });
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read'] });
    await expect(
      service.create(a, { facilityId: 'fac-1', lines: [{ componentTypeId: 'ct-1', quantityRequested: 1 }] } as any, ctx),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });

  it('masks out-of-scope request as 404', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.DRAFT, 'fac-other'));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read'] });
    await expect(service.get(a, 'req-1')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }) });
  });

  it('blocks updates outside DRAFT', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.SUBMITTED));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.self.create'] });
    await expect(service.update(a, 'req-1', { operationalNotes: 'x' } as any, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_MUTABLE_FIELDS_LOCKED' }),
    });
  });

  it('submits draft and records audit', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.DRAFT));
    repo.setStatusIfCurrent.mockImplementation(async (_id: string, _cur: any, data: any) => requestRow(data.status));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.self.create'] });
    const result = await service.submit(a, 'req-1', ctx);
    expect(result.status).toBe(BloodRequestStatus.SUBMITTED);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'request.submitted' }));
  });

  it('approves submitted request via valid compound transition', async () => {
    const submitted = requestRow(BloodRequestStatus.SUBMITTED);
    const underReview = requestRow(BloodRequestStatus.UNDER_REVIEW);
    repo.findById.mockResolvedValueOnce(submitted).mockResolvedValueOnce(underReview);
    repo.setStatusIfCurrent
      .mockResolvedValueOnce(requestRow(BloodRequestStatus.UNDER_REVIEW))
      .mockResolvedValueOnce(requestRow(BloodRequestStatus.APPROVED));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.approve'] });
    const result = await service.approve(a, 'req-1', ctx);
    expect(result.status).toBe(BloodRequestStatus.APPROVED);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'request.approved' }));
  });

  it('rejects invalid transition (draft -> approve path misuse)', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.DRAFT));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.approve'] });
    await expect(service.approve(a, 'req-1', ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_REQUEST_TRANSITION' }),
    });
  });

  it('requires reason for rejection', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.UNDER_REVIEW));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.reject'] });
    await expect(service.reject(a, 'req-1', { reason: '  ' } as any, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_REJECT_REASON_REQUIRED' }),
    });
  });

  it('rejects terminal-state cancel', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.REJECTED));
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.cancel'] });
    await expect(service.cancel(a, 'req-1', {} as any, ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REQUEST_TERMINAL_STATE' }),
    });
  });

  it('detects concurrent transition conflict (conditional update miss)', async () => {
    repo.findById.mockResolvedValue(requestRow(BloodRequestStatus.DRAFT));
    repo.setStatusIfCurrent.mockResolvedValue(null);
    const a = actor({ facilityId: 'fac-1', facilityPerms: ['request.read', 'request.self.create'] });
    await expect(service.submit(a, 'req-1', ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_REQUEST_TRANSITION' }),
    });
  });
});
