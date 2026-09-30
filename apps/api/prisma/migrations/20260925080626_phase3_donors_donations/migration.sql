-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DonationState" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'COLLECTED', 'SCREENING', 'QUARANTINED', 'RELEASED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScreeningResult" AS ENUM ('IN_PROGRESS', 'PASS', 'REJECT');

-- CreateTable
CREATE TABLE "DonorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "bloodGroup" "BloodGroup",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodDrive" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "targetUnits" INTEGER,
    "capacity" INTEGER,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodDrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRegistration" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "donorProfileId" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "registeredById" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "donorProfileId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "campaignRegistrationId" TEXT,
    "state" "DonationState" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "volumeMl" INTEGER,
    "bloodGroup" "BloodGroup",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationScreening" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "screenedById" TEXT NOT NULL,
    "bloodGroup" "BloodGroup" NOT NULL,
    "result" "ScreeningResult" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorDeferral" (
    "id" TEXT NOT NULL,
    "donorProfileId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonNote" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonorDeferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonorProfile_userId_key" ON "DonorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DonorProfile_publicCode_key" ON "DonorProfile"("publicCode");

-- CreateIndex
CREATE INDEX "DonorProfile_name_idx" ON "DonorProfile"("name");

-- CreateIndex
CREATE INDEX "BloodDrive_facilityId_idx" ON "BloodDrive"("facilityId");

-- CreateIndex
CREATE INDEX "BloodDrive_status_idx" ON "BloodDrive"("status");

-- CreateIndex
CREATE INDEX "BloodDrive_startsAt_idx" ON "BloodDrive"("startsAt");

-- CreateIndex
CREATE INDEX "CampaignRegistration_donorProfileId_idx" ON "CampaignRegistration"("donorProfileId");

-- CreateIndex
CREATE INDEX "CampaignRegistration_status_idx" ON "CampaignRegistration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRegistration_campaignId_donorProfileId_key" ON "CampaignRegistration"("campaignId", "donorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_publicCode_key" ON "Donation"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_campaignRegistrationId_key" ON "Donation"("campaignRegistrationId");

-- CreateIndex
CREATE INDEX "Donation_donorProfileId_idx" ON "Donation"("donorProfileId");

-- CreateIndex
CREATE INDEX "Donation_facilityId_idx" ON "Donation"("facilityId");

-- CreateIndex
CREATE INDEX "Donation_state_idx" ON "Donation"("state");

-- CreateIndex
CREATE INDEX "Donation_scheduledFor_idx" ON "Donation"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DonationScreening_donationId_key" ON "DonationScreening"("donationId");

-- CreateIndex
CREATE INDEX "DonationScreening_screenedById_idx" ON "DonationScreening"("screenedById");

-- CreateIndex
CREATE INDEX "DonorDeferral_donorProfileId_idx" ON "DonorDeferral"("donorProfileId");

-- CreateIndex
CREATE INDEX "DonorDeferral_effectiveAt_idx" ON "DonorDeferral"("effectiveAt");

-- AddForeignKey
ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodDrive" ADD CONSTRAINT "BloodDrive_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodDrive" ADD CONSTRAINT "BloodDrive_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRegistration" ADD CONSTRAINT "CampaignRegistration_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BloodDrive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRegistration" ADD CONSTRAINT "CampaignRegistration_donorProfileId_fkey" FOREIGN KEY ("donorProfileId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRegistration" ADD CONSTRAINT "CampaignRegistration_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorProfileId_fkey" FOREIGN KEY ("donorProfileId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_campaignRegistrationId_fkey" FOREIGN KEY ("campaignRegistrationId") REFERENCES "CampaignRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationScreening" ADD CONSTRAINT "DonationScreening_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationScreening" ADD CONSTRAINT "DonationScreening_screenedById_fkey" FOREIGN KEY ("screenedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorDeferral" ADD CONSTRAINT "DonorDeferral_donorProfileId_fkey" FOREIGN KEY ("donorProfileId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorDeferral" ADD CONSTRAINT "DonorDeferral_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorDeferral" ADD CONSTRAINT "DonorDeferral_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
