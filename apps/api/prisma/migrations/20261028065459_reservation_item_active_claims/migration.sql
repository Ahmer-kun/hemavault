-- CreateEnum
CREATE TYPE "ComponentCategory" AS ENUM ('WHOLE_BLOOD', 'RED_CELLS', 'PLATELETS', 'PLASMA', 'CRYOPRECIPITATE', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitState" AS ENUM ('COLLECTED', 'QUARANTINED', 'AVAILABLE', 'RESERVED', 'TRANSFER_PENDING', 'IN_TRANSIT', 'RECEIVED', 'RECEIVED_BY_DESTINATION', 'ISSUED', 'EXPIRED', 'DISCARDED', 'RECALLED', 'CLOSED', 'USED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('CREATED', 'STATE_CHANGE', 'LOCATION_MOVE', 'FACILITY_MOVE', 'QUARANTINED', 'RELEASED_TO_AVAILABLE', 'RESERVED', 'RESERVATION_RELEASED', 'ISSUED', 'DISPATCHED', 'RECEIVED', 'EXPIRED', 'DISCARDED', 'RECALLED', 'RECONCILED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED_TO_ISSUANCE', 'RELEASED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ComponentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ComponentCategory" NOT NULL,
    "description" TEXT,
    "shelfLifeDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodComponentUnit" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "componentTypeId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "storageLocationId" TEXT,
    "bloodGroup" "BloodGroup" NOT NULL,
    "state" "UnitState" NOT NULL DEFAULT 'QUARANTINED',
    "volumeMl" INTEGER,
    "collectionAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "recalledAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodComponentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "facilityId" TEXT,
    "actorUserId" TEXT,
    "movementType" "InventoryMovementType" NOT NULL,
    "fromState" "UnitState",
    "toState" "UnitState",
    "fromFacilityId" TEXT,
    "toFacilityId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "reservationId" TEXT,
    "transferId" TEXT,
    "issuanceId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "facilityId" TEXT NOT NULL,
    "createdById" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationItem" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentType_code_key" ON "ComponentType"("code");

-- CreateIndex
CREATE INDEX "ComponentType_category_idx" ON "ComponentType"("category");

-- CreateIndex
CREATE INDEX "ComponentType_isActive_idx" ON "ComponentType"("isActive");

-- CreateIndex
CREATE INDEX "StorageLocation_facilityId_idx" ON "StorageLocation"("facilityId");

-- CreateIndex
CREATE INDEX "StorageLocation_isActive_idx" ON "StorageLocation"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_facilityId_code_key" ON "StorageLocation"("facilityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BloodComponentUnit_publicCode_key" ON "BloodComponentUnit"("publicCode");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_donationId_idx" ON "BloodComponentUnit"("donationId");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_componentTypeId_idx" ON "BloodComponentUnit"("componentTypeId");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_facilityId_idx" ON "BloodComponentUnit"("facilityId");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_storageLocationId_idx" ON "BloodComponentUnit"("storageLocationId");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_state_idx" ON "BloodComponentUnit"("state");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_expiresAt_idx" ON "BloodComponentUnit"("expiresAt");

-- CreateIndex
CREATE INDEX "BloodComponentUnit_bloodGroup_idx" ON "BloodComponentUnit"("bloodGroup");

-- CreateIndex
CREATE INDEX "InventoryMovement_unitId_idx" ON "InventoryMovement"("unitId");

-- CreateIndex
CREATE INDEX "InventoryMovement_facilityId_idx" ON "InventoryMovement"("facilityId");

-- CreateIndex
CREATE INDEX "InventoryMovement_actorUserId_idx" ON "InventoryMovement"("actorUserId");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");

-- CreateIndex
CREATE INDEX "InventoryMovement_occurredAt_idx" ON "InventoryMovement"("occurredAt");

-- CreateIndex
CREATE INDEX "Reservation_facilityId_idx" ON "Reservation"("facilityId");

-- CreateIndex
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");

-- CreateIndex
CREATE INDEX "Reservation_requestId_idx" ON "Reservation"("requestId");

-- CreateIndex
CREATE INDEX "Reservation_createdById_idx" ON "Reservation"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_facilityId_idempotencyKey_key" ON "Reservation"("facilityId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ReservationItem_reservationId_idx" ON "ReservationItem"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationItem_unitId_idx" ON "ReservationItem"("unitId");

-- CreateIndex
CREATE INDEX "ReservationItem_isActive_idx" ON "ReservationItem"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationItem_unitId_active_unique" ON "ReservationItem"("unitId") WHERE "isActive" = true;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodComponentUnit" ADD CONSTRAINT "BloodComponentUnit_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodComponentUnit" ADD CONSTRAINT "BloodComponentUnit_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodComponentUnit" ADD CONSTRAINT "BloodComponentUnit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodComponentUnit" ADD CONSTRAINT "BloodComponentUnit_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BloodComponentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BloodComponentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
