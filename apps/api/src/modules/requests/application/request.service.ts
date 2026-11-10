import { HttpStatus, Injectable } from '@nestjs/common';
import { BloodRequestStatus, RequestUrgency } from '@prisma/client';
import { generatePublicCode } from '../../../common/identifiers/public-code';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { AuditService } from '../../../common/audit/audit.service';
import { ActorContext, canAnywhere, canAtFacility } from '../../rbac/domain/policy';
import { REQUEST_ACTIONS, REQUEST_PUBLIC_CODE_PREFIX } from '../domain/request.constants';
import {
  invalidRequestTransitionError,
  requestFacilityNotFoundError,
  requestLinesRequiredError,
  requestMutableFieldsLockedError,
  requestNotFoundError,
  requestRejectReasonRequiredError,
  requestTerminalStateError,
} from '../domain/request.errors';
import {
  assertValidRequestTransition,
  canTransitionRequest,
  isTerminalRequestStatus,
} from '../domain/request-state-machine';
import {
  EscalationDecision,
  resolveEmergencyEscalation,
} from '../domain/request-priority';
import { RequestRepository, RequestWithDetails } from '../infrastructure/request.repository';
import { CreateRequestDto } from '../dto/create-request.dto';
import { UpdateRequestDto } from '../dto/update-request.dto';
import { RejectRequestDto } from '../dto/reject-request.dto';
import { CancelRequestDto } from '../dto/cancel-request.dto';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RequestLineView {
  id: string;
  componentType: { id: string; code: string; name: string; category: string };
  bloodGroupRequired: string | null;
  quantityRequested: number;
  quantityReserved: number;
  quantityIssued: number;
  notes: string | null;
}

export interface RequestView {
  id: string;
  publicCode: string;
  facility: { id: string; name: string; code: string; organizationId: string };
  requestedBy: { id: string; email: string; name: string | null } | null;
  urgency: RequestUrgency;
  status: BloodRequestStatus;
  requiredByAt: Date | null;
  patientReferenceCode: string | null;
  operationalNotes: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  emergencyEscalatedAt: Date | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  fulfilledAt: Date | null;
  expiredAt: Date | null;
  ruleSetVersion: string | null;
  lines: RequestLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestPageResult {
  items: RequestView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class RequestService {
  constructor(
    private readonly repository: RequestRepository,
    private readonly auditService: AuditService,
  ) {}

  private view(request: RequestWithDetails): RequestView {
    return {
      id: request.id,
      publicCode: request.publicCode,
      facility: request.facility,
      requestedBy: request.requestedBy
        ? { id: request.requestedBy.id, email: request.requestedBy.email, name: request.requestedBy.name }
        : null,
      urgency: request.urgency,
      status: request.status,
      requiredByAt: request.requiredByAt,
      patientReferenceCode: request.patientReferenceCode,
      operationalNotes: request.operationalNotes,
      rejectionReason: request.rejectionReason,
      cancellationReason: request.cancellationReason,
      emergencyEscalatedAt: request.emergencyEscalatedAt,
      submittedAt: request.submittedAt,
      reviewedAt: request.reviewedAt,
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      cancelledAt: request.cancelledAt,
      fulfilledAt: request.fulfilledAt,
      expiredAt: request.expiredAt,
      ruleSetVersion: request.ruleSetVersion,
      lines: request.lines.map((line) => ({
        id: line.id,
        componentType: line.componentType,
        bloodGroupRequired: line.bloodGroupRequired,
        quantityRequested: line.quantityRequested,
        quantityReserved: line.quantityReserved,
        quantityIssued: line.quantityIssued,
        notes: line.notes,
      })),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private facilityScope(actor: ActorContext): string[] | null {
    if (canAnywhere(actor, 'request.read')) {
      // Global readers may see all; facility-scoped readers limited below.
      // canAnywhere is true if global or any facility has it; refine:
    }
    // If actor has global request.read, allow broad access.
    if (actor.globalPermissions.has('request.read')) return null;
    const ids = Array.from(actor.facilityPermissions.entries())
      .filter(([, perms]) => perms.has('request.read'))
      .map(([id]) => id);
    return ids;
  }

  private ensureFacilityCreateAccess(actor: ActorContext, facilityId: string): void {
    if (actor.globalPermissions.has('request.self.create')) return;
    if (canAtFacility(actor, facilityId, 'request.self.create')) return;
    // Platform admins with approval authority may create operational requests in scope.
    if (actor.globalPermissions.has('request.approve')) return;
    throw new AppHttpException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'You do not have permission to create requests for this facility.',
    );
  }

  private async getScoped(actor: ActorContext, id: string): Promise<RequestWithDetails> {
    const request = await this.repository.findById(id);
    if (!request) throw requestNotFoundError();
    if (actor.globalPermissions.has('request.read')) return request;
    if (canAtFacility(actor, request.facilityId, 'request.read')) return request;
    throw requestNotFoundError(); // 404 masking
  }

  private escalationMetadata(
    decision: EscalationDecision,
    urgency: RequestUrgency,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      urgency,
      alertRequired: true,
      notificationDelivery: 'DEFERRED_PHASE_6',
      escalatedAt: decision.emergencyEscalatedAt?.toISOString() ?? null,
      ...extra,
    };
  }

  private async recordEmergencyEscalation(
    actor: ActorContext,
    request: RequestView,
    req: RequestContext,
    decision: EscalationDecision,
    previousUrgency: RequestUrgency | null,
  ): Promise<void> {
    if (decision.escalated) {
      await this.auditService.record({
        actorUserId: actor.userId,
        action: REQUEST_ACTIONS.EMERGENCY_ESCALATED,
        targetType: 'BloodRequest',
        targetId: request.id,
        organizationId: request.facility.organizationId,
        facilityId: request.facility.id,
        requestId: req.requestId,
        ipAddress: req.ipAddress,
        userAgent: req.userAgent,
        metadata: this.escalationMetadata(decision, request.urgency, {
          requiredByAt: request.requiredByAt?.toISOString() ?? null,
          previousUrgency,
        }),
      });
      return;
    }
    if (decision.deescalated) {
      await this.auditService.record({
        actorUserId: actor.userId,
        action: REQUEST_ACTIONS.EMERGENCY_DEESCALATED,
        targetType: 'BloodRequest',
        targetId: request.id,
        organizationId: request.facility.organizationId,
        facilityId: request.facility.id,
        requestId: req.requestId,
        ipAddress: req.ipAddress,
        userAgent: req.userAgent,
        metadata: { urgency: request.urgency, previousUrgency },
      });
    }
  }

  async create(actor: ActorContext, dto: CreateRequestDto, req: RequestContext): Promise<RequestView> {
    this.ensureFacilityCreateAccess(actor, dto.facilityId);
    const facility = await this.repository.findActiveFacility(dto.facilityId);
    if (!facility) throw requestFacilityNotFoundError();
    if (dto.lines.length < 1) throw requestLinesRequiredError();
    for (const line of dto.lines) {
      if (!Number.isInteger(line.quantityRequested) || line.quantityRequested < 1) {
        throw requestLinesRequiredError();
      }
    }
    const urgency = dto.urgency ?? RequestUrgency.NORMAL;
    const escalation = resolveEmergencyEscalation(urgency, null);
    const created = await this.repository.createDraft({
      publicCode: generatePublicCode(REQUEST_PUBLIC_CODE_PREFIX),
      facilityId: dto.facilityId,
      requestedByUserId: actor.userId,
      urgency,
      requiredByAt: dto.requiredByAt ? new Date(dto.requiredByAt) : null,
      patientReferenceCode: dto.patientReferenceCode?.trim() || null,
      operationalNotes: dto.operationalNotes?.trim() || null,
      emergencyEscalatedAt: escalation.emergencyEscalatedAt,
      lines: dto.lines.map((l) => ({
        componentTypeId: l.componentTypeId,
        bloodGroupRequired: l.bloodGroupRequired ?? null,
        quantityRequested: l.quantityRequested,
        notes: l.notes?.trim() || null,
      })),
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.CREATE,
      targetType: 'BloodRequest',
      targetId: created.id,
      organizationId: created.facility.organizationId,
      facilityId: created.facilityId,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { urgency, emergency: !!created.emergencyEscalatedAt },
    });
    const view = this.view(created);
    await this.recordEmergencyEscalation(actor, view, req, escalation, null);
    return view;
  }

  async list(
    actor: ActorContext,
    query: { status?: BloodRequestStatus; urgency?: RequestUrgency; limit?: number; offset?: number },
  ): Promise<RequestPageResult> {
    const scope = this.facilityScope(actor);
    if (scope !== null && scope.length === 0) {
      return { items: [], total: 0, limit: query.limit ?? 20, offset: query.offset ?? 0 };
    }
    const page = await this.repository.list({
      facilityScope: scope,
      status: query.status,
      urgency: query.urgency,
      limit: Math.min(Math.max(query.limit ?? 20, 1), 100),
      offset: Math.max(query.offset ?? 0, 0),
    });
    return { ...page, items: page.items.map((r) => this.view(r)) };
  }

  async get(actor: ActorContext, id: string): Promise<RequestView> {
    return this.view(await this.getScoped(actor, id));
  }

  async update(actor: ActorContext, id: string, dto: UpdateRequestDto, req: RequestContext): Promise<RequestView> {
    const request = await this.getScoped(actor, id);
    const canUpdate =
      actor.globalPermissions.has('request.approve') ||
      canAtFacility(actor, request.facilityId, 'request.self.create') ||
      (request.requestedByUserId !== null && request.requestedByUserId === actor.userId);
    if (!canUpdate) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden.');
    }
    if (request.status !== BloodRequestStatus.DRAFT) throw requestMutableFieldsLockedError();
    if (dto.lines && dto.lines.length < 1) throw requestLinesRequiredError();
    if (dto.lines) {
      for (const line of dto.lines) {
        if (!Number.isInteger(line.quantityRequested) || line.quantityRequested < 1) {
          throw requestLinesRequiredError();
        }
      }
    }
    const urgency = dto.urgency ?? request.urgency;
    const escalation = resolveEmergencyEscalation(urgency, {
      urgency: request.urgency,
      emergencyEscalatedAt: request.emergencyEscalatedAt,
    });
    const updated = await this.repository.updateDraft(id, {
      urgency,
      requiredByAt: dto.requiredByAt !== undefined ? (dto.requiredByAt ? new Date(dto.requiredByAt) : null) : undefined,
      patientReferenceCode:
        dto.patientReferenceCode !== undefined ? dto.patientReferenceCode?.trim() || null : undefined,
      operationalNotes: dto.operationalNotes !== undefined ? dto.operationalNotes?.trim() || null : undefined,
      emergencyEscalatedAt:
        dto.urgency !== undefined ? escalation.emergencyEscalatedAt : undefined,
      lines: dto.lines?.map((l) => ({
        componentTypeId: l.componentTypeId,
        bloodGroupRequired: l.bloodGroupRequired ?? null,
        quantityRequested: l.quantityRequested,
        notes: l.notes?.trim() || null,
      })),
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.UPDATE,
      targetType: 'BloodRequest',
      targetId: updated.id,
      organizationId: updated.facility.organizationId,
      facilityId: updated.facilityId,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { urgency: updated.urgency },
    });
    const view = this.view(updated);
    await this.recordEmergencyEscalation(
      actor,
      view,
      req,
      escalation,
      dto.urgency !== undefined ? request.urgency : null,
    );
    return view;
  }

  private async transitionScoped(
    request: RequestWithDetails,
    to: BloodRequestStatus,
    extra: Record<string, unknown> = {},
  ): Promise<RequestView> {
    if (isTerminalRequestStatus(request.status)) throw requestTerminalStateError(request.status);
    try {
      assertValidRequestTransition(request.status, to);
    } catch {
      throw invalidRequestTransitionError(request.status, to);
    }
    const now = new Date();
    const patch: any = { status: to, ...extra };
    if (to === BloodRequestStatus.SUBMITTED) patch.submittedAt = now;
    if (to === BloodRequestStatus.UNDER_REVIEW) patch.reviewedAt = now;
    if (to === BloodRequestStatus.APPROVED) patch.approvedAt = now;
    if (to === BloodRequestStatus.REJECTED) patch.rejectedAt = now;
    if (to === BloodRequestStatus.CANCELLED) patch.cancelledAt = now;
    if (to === BloodRequestStatus.FULFILLED) patch.fulfilledAt = now;
    if (to === BloodRequestStatus.EXPIRED) patch.expiredAt = now;
    const updated = await this.repository.setStatusIfCurrent(request.id, request.status, patch);
    if (!updated) throw invalidRequestTransitionError(request.status, to);
    return this.view(updated);
  }

  async submit(actor: ActorContext, id: string, req: RequestContext): Promise<RequestView> {
    const request = await this.getScoped(actor, id);
    if (
      !canAtFacility(actor, request.facilityId, 'request.self.create') &&
      !actor.globalPermissions.has('request.approve') &&
      !actor.globalPermissions.has('request.review')
    ) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden.');
    }
    if (request.lines.length < 1) throw requestLinesRequiredError();
    const view = await this.transitionScoped(request, BloodRequestStatus.SUBMITTED);
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.SUBMIT,
      targetType: 'BloodRequest',
      targetId: id,
      organizationId: view.facility.organizationId,
      facilityId: view.facility.id,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { status: view.status },
    });
    return view;
  }

  async approve(actor: ActorContext, id: string, req: RequestContext): Promise<RequestView> {
    if (!canAnywhere(actor, 'request.approve')) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden.');
    }
    let request = await this.getScoped(actor, id);
    if (!canAtFacility(actor, request.facilityId, 'request.approve') && !actor.globalPermissions.has('request.approve')) {
      throw requestNotFoundError();
    }
    // Contract has no /review route; perform valid state-machine transitions.
    if (request.status === BloodRequestStatus.SUBMITTED) {
      await this.transitionScoped(request, BloodRequestStatus.UNDER_REVIEW);
      request = (await this.repository.findById(id))!;
    } else if (request.status !== BloodRequestStatus.UNDER_REVIEW) {
      throw invalidRequestTransitionError(request.status, BloodRequestStatus.APPROVED);
    }
    const view = await this.transitionScoped(request, BloodRequestStatus.APPROVED);
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.APPROVE,
      targetType: 'BloodRequest',
      targetId: id,
      organizationId: view.facility.organizationId,
      facilityId: view.facility.id,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { status: view.status },
    });
    return view;
  }

  async reject(actor: ActorContext, id: string, dto: RejectRequestDto, req: RequestContext): Promise<RequestView> {
    if (!canAnywhere(actor, 'request.reject')) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden.');
    }
    let request = await this.getScoped(actor, id);
    if (!canAtFacility(actor, request.facilityId, 'request.reject') && !actor.globalPermissions.has('request.reject')) {
      throw requestNotFoundError();
    }
    const reason = dto.reason?.trim();
    if (!reason) throw requestRejectReasonRequiredError();
    if (request.status === BloodRequestStatus.SUBMITTED) {
      await this.transitionScoped(request, BloodRequestStatus.UNDER_REVIEW);
      request = (await this.repository.findById(id))!;
    } else if (request.status !== BloodRequestStatus.UNDER_REVIEW) {
      throw invalidRequestTransitionError(request.status, BloodRequestStatus.REJECTED);
    }
    const view = await this.transitionScoped(request, BloodRequestStatus.REJECTED, { rejectionReason: reason });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.REJECT,
      targetType: 'BloodRequest',
      targetId: id,
      organizationId: view.facility.organizationId,
      facilityId: view.facility.id,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { status: view.status },
    });
    return view;
  }

  async cancel(actor: ActorContext, id: string, dto: CancelRequestDto, req: RequestContext): Promise<RequestView> {
    const request = await this.getScoped(actor, id);
    const canCancel =
      actor.globalPermissions.has('request.cancel') ||
      canAtFacility(actor, request.facilityId, 'request.cancel') ||
      canAtFacility(actor, request.facilityId, 'request.self.create');
    if (!canCancel) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden.');
    }
    if (isTerminalRequestStatus(request.status)) throw requestTerminalStateError(request.status);
    if (!canTransitionRequest(request.status, BloodRequestStatus.CANCELLED)) {
      throw invalidRequestTransitionError(request.status, BloodRequestStatus.CANCELLED);
    }
    const view = await this.transitionScoped(request, BloodRequestStatus.CANCELLED, {
      cancellationReason: dto.reason?.trim() || null,
    });
    await this.auditService.record({
      actorUserId: actor.userId,
      action: REQUEST_ACTIONS.CANCEL,
      targetType: 'BloodRequest',
      targetId: id,
      organizationId: view.facility.organizationId,
      facilityId: view.facility.id,
      requestId: req.requestId,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      metadata: { status: view.status },
    });
    return view;
  }
}
