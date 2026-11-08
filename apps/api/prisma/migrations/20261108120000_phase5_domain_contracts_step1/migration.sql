-- Phase 5 Step 1: Domain/contracts alignment and schema design (forward-only).
-- Prepared 2026-11-08. VERIFY against isolated local PostgreSQL before any Supabase deployment.
-- Never edit historical migrations. No destructive operations.

-- Extend ReservationStatus (additive). PostgreSQL 12+ supports ADD VALUE in some contexts;
-- Prisma migration execution may require this statement outside an explicit transaction block depending on runner.
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';

-- New enums
CREATE TYPE "RequestUrgency" AS ENUM ('NORMAL', 'URGENT', 'EMERGENCY', 'CRITICAL');
CREATE TYPE "BloodRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'RESERVED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "IssuanceStatus" AS ENUM ('CREATED', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "CompatibilityRuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- BloodRequest
CREATE TABLE "BloodRequest" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "BloodRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredByAt" TIMESTAMP(3),
    "patientReferenceCode" TEXT,
    "operationalNotes" TEXT,
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "emergencyEscalatedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "ruleSetVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodRequest_pkey" PRIMARY KEY ("id")
);

-- BloodRequestLine
CREATE TABLE "BloodRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "componentTypeId" TEXT NOT NULL,
    "bloodGroupRequired" "BloodGroup",
    "quantityRequested" INTEGER NOT NULL,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "quantityIssued" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodRequestLine_pkey" PRIMARY KEY ("id")
);

-- Compatibility reference (versioned; no clinical values invented - ADR-018/040)
CREATE TABLE "CompatibilityRuleSet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CompatibilityRuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceReference" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "isNonClinicalFixture" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompatibilityRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompatibilityRule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "componentCategory" "ComponentCategory",
    "componentTypeId" TEXT,
    "recipientBloodGroup" "BloodGroup",
    "donorBloodGroup" "BloodGroup",
    "isCompatible" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompatibilityRule_pkey" PRIMARY KEY ("id")
);

-- Issuance
CREATE TABLE "Issuance" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "requestId" TEXT,
    "reservationId" TEXT,
    "facilityId" TEXT NOT NULL,
    "issuedByUserId" TEXT,
    "status" "IssuanceStatus" NOT NULL DEFAULT 'CREATED',
    "issuedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "destinationReference" TEXT,
    "notes" TEXT,
    "ruleSetVersion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issuance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IssuanceItem" (
    "id" TEXT NOT NULL,
    "issuanceId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "reservationItemId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuanceItem_pkey" PRIMARY KEY ("id")
);

-- Reservation additive fields (ADR-038)
ALTER TABLE "Reservation" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "ruleSetVersion" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "metadata" JSONB;

-- Unique constraints
CREATE UNIQUE INDEX "BloodRequest_publicCode_key" ON "BloodRequest"("publicCode");
CREATE UNIQUE INDEX "Issuance_publicCode_key" ON "Issuance"("publicCode");
CREATE UNIQUE INDEX "CompatibilityRuleSet_code_key" ON "CompatibilityRuleSet"("code");
CREATE UNIQUE INDEX "CompatibilityRuleSet_code_version_key" ON "CompatibilityRuleSet"("code", "version");

-- Indexes
CREATE INDEX "BloodRequest_facilityId_idx" ON "BloodRequest"("facilityId");
CREATE INDEX "BloodRequest_requestedByUserId_idx" ON "BloodRequest"("requestedByUserId");
CREATE INDEX "BloodRequest_status_idx" ON "BloodRequest"("status");
CREATE INDEX "BloodRequest_urgency_idx" ON "BloodRequest"("urgency");
CREATE INDEX "BloodRequest_requiredByAt_idx" ON "BloodRequest"("requiredByAt");
CREATE INDEX "BloodRequest_createdAt_idx" ON "BloodRequest"("createdAt");
CREATE INDEX "BloodRequestLine_requestId_idx" ON "BloodRequestLine"("requestId");
CREATE INDEX "BloodRequestLine_componentTypeId_idx" ON "BloodRequestLine"("componentTypeId");
CREATE INDEX "Issuance_requestId_idx" ON "Issuance"("requestId");
CREATE INDEX "Issuance_reservationId_idx" ON "Issuance"("reservationId");
CREATE INDEX "Issuance_facilityId_idx" ON "Issuance"("facilityId");
CREATE INDEX "Issuance_issuedByUserId_idx" ON "Issuance"("issuedByUserId");
CREATE INDEX "Issuance_status_idx" ON "Issuance"("status");
CREATE INDEX "Issuance_createdAt_idx" ON "Issuance"("createdAt");
CREATE INDEX "IssuanceItem_issuanceId_idx" ON "IssuanceItem"("issuanceId");
CREATE INDEX "IssuanceItem_unitId_idx" ON "IssuanceItem"("unitId");
CREATE INDEX "IssuanceItem_reservationItemId_idx" ON "IssuanceItem"("reservationItemId");
CREATE INDEX "CompatibilityRuleSet_status_idx" ON "CompatibilityRuleSet"("status");
CREATE INDEX "CompatibilityRuleSet_isNonClinicalFixture_idx" ON "CompatibilityRuleSet"("isNonClinicalFixture");
CREATE INDEX "CompatibilityRule_ruleSetId_idx" ON "CompatibilityRule"("ruleSetId");
CREATE INDEX "CompatibilityRule_componentCategory_idx" ON "CompatibilityRule"("componentCategory");
CREATE INDEX "CompatibilityRule_componentTypeId_idx" ON "CompatibilityRule"("componentTypeId");
CREATE INDEX "CompatibilityRule_recipientBloodGroup_idx" ON "CompatibilityRule"("recipientBloodGroup");
CREATE INDEX "CompatibilityRule_donorBloodGroup_idx" ON "CompatibilityRule"("donorBloodGroup");

-- Foreign keys
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BloodRequestLine" ADD CONSTRAINT "BloodRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BloodRequestLine" ADD CONSTRAINT "BloodRequestLine_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompatibilityRule" ADD CONSTRAINT "CompatibilityRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "CompatibilityRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompatibilityRule" ADD CONSTRAINT "CompatibilityRule_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Issuance" ADD CONSTRAINT "Issuance_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Issuance" ADD CONSTRAINT "Issuance_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Issuance" ADD CONSTRAINT "Issuance_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Issuance" ADD CONSTRAINT "Issuance_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IssuanceItem" ADD CONSTRAINT "IssuanceItem_issuanceId_fkey" FOREIGN KEY ("issuanceId") REFERENCES "Issuance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssuanceItem" ADD CONSTRAINT "IssuanceItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BloodComponentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssuanceItem" ADD CONSTRAINT "IssuanceItem_reservationItemId_fkey" FOREIGN KEY ("reservationItemId") REFERENCES "ReservationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
