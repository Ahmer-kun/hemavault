import { Injectable } from '@nestjs/common';
import { BloodRequestStatus, Prisma, RequestUrgency } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface RequestListInput {
  facilityScope: string[] | null;
  status?: BloodRequestStatus;
  urgency?: RequestUrgency;
  limit: number;
  offset: number;
}

const requestInclude = {
  facility: { select: { id: true, name: true, code: true, organizationId: true } },
  requestedBy: { select: { id: true, email: true, name: true } },
  lines: {
    include: {
      componentType: { select: { id: true, code: true, name: true, category: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.BloodRequestInclude;

export type RequestWithDetails = Prisma.BloodRequestGetPayload<{ include: typeof requestInclude }>;

@Injectable()
export class RequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveFacility(facilityId: string) {
    return this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true, organizationId: true, status: true, name: true, code: true },
    });
  }

  async findById(id: string): Promise<RequestWithDetails | null> {
    return this.prisma.bloodRequest.findUnique({ where: { id }, include: requestInclude });
  }

  async list(input: RequestListInput) {
    const where: Prisma.BloodRequestWhereInput = {};
    if (input.facilityScope !== null) where.facilityId = { in: input.facilityScope };
    if (input.status) where.status = input.status;
    if (input.urgency) where.urgency = input.urgency;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bloodRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }),
      this.prisma.bloodRequest.count({ where }),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  }

  async createDraft(data: {
    publicCode: string;
    facilityId: string;
    requestedByUserId: string | null;
    urgency: RequestUrgency;
    requiredByAt: Date | null;
    patientReferenceCode: string | null;
    operationalNotes: string | null;
    emergencyEscalatedAt: Date | null;
    lines: Array<{
      componentTypeId: string;
      bloodGroupRequired: string | null;
      quantityRequested: number;
      notes: string | null;
    }>;
  }): Promise<RequestWithDetails> {
    return this.prisma.bloodRequest.create({
      data: {
        publicCode: data.publicCode,
        facilityId: data.facilityId,
        requestedByUserId: data.requestedByUserId,
        urgency: data.urgency,
        status: BloodRequestStatus.DRAFT,
        requiredByAt: data.requiredByAt,
        patientReferenceCode: data.patientReferenceCode,
        operationalNotes: data.operationalNotes,
        emergencyEscalatedAt: data.emergencyEscalatedAt,
        lines: {
          create: data.lines.map((line) => ({
            componentTypeId: line.componentTypeId,
            bloodGroupRequired: line.bloodGroupRequired as any,
            quantityRequested: line.quantityRequested,
            notes: line.notes,
          })),
        },
      },
      include: requestInclude,
    });
  }

  async updateDraft(
    id: string,
    data: {
      urgency?: RequestUrgency;
      requiredByAt?: Date | null;
      patientReferenceCode?: string | null;
      operationalNotes?: string | null;
      emergencyEscalatedAt?: Date | null;
      lines?: Array<{
        componentTypeId: string;
        bloodGroupRequired: string | null;
        quantityRequested: number;
        notes: string | null;
      }>;
    },
  ): Promise<RequestWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      if (data.lines) {
        await tx.bloodRequestLine.deleteMany({ where: { requestId: id } });
      }
      return tx.bloodRequest.update({
        where: { id },
        data: {
          ...(data.urgency !== undefined ? { urgency: data.urgency } : {}),
          ...(data.requiredByAt !== undefined ? { requiredByAt: data.requiredByAt } : {}),
          ...(data.patientReferenceCode !== undefined
            ? { patientReferenceCode: data.patientReferenceCode }
            : {}),
          ...(data.operationalNotes !== undefined ? { operationalNotes: data.operationalNotes } : {}),
          ...(data.emergencyEscalatedAt !== undefined
            ? { emergencyEscalatedAt: data.emergencyEscalatedAt }
            : {}),
          ...(data.lines
            ? {
                lines: {
                  create: data.lines.map((line) => ({
                    componentTypeId: line.componentTypeId,
                    bloodGroupRequired: line.bloodGroupRequired as any,
                    quantityRequested: line.quantityRequested,
                    notes: line.notes,
                  })),
                },
              }
            : {}),
        },
        include: requestInclude,
      });
    });
  }

  async setStatus(
    id: string,
    data: {
      status: BloodRequestStatus;
      submittedAt?: Date;
      reviewedAt?: Date;
      approvedAt?: Date;
      rejectedAt?: Date;
      cancelledAt?: Date;
      fulfilledAt?: Date;
      expiredAt?: Date;
      rejectionReason?: string | null;
      cancellationReason?: string | null;
    },
  ): Promise<RequestWithDetails> {
    return this.prisma.bloodRequest.update({
      where: { id },
      data,
      include: requestInclude,
    });
  }

  async setStatusIfCurrent(
    id: string,
    currentStatus: BloodRequestStatus,
    data: {
      status: BloodRequestStatus;
      submittedAt?: Date;
      reviewedAt?: Date;
      approvedAt?: Date;
      rejectedAt?: Date;
      cancelledAt?: Date;
      fulfilledAt?: Date;
      expiredAt?: Date;
      rejectionReason?: string | null;
      cancellationReason?: string | null;
    },
  ): Promise<RequestWithDetails | null> {
    const updated = await this.prisma.bloodRequest.updateMany({
      where: { id, status: currentStatus },
      data,
    });
    if (updated.count !== 1) return null;
    return this.findById(id);
  }
}
