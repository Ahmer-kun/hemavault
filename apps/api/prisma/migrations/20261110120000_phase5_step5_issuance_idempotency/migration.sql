-- Phase 5 Step 5 (additive, forward-only): facility-scoped idempotency for issuance commands.
-- Null keys remain distinct under PostgreSQL unique indexes, matching the Reservation convention.
-- Isolated local PostgreSQL only; never deploy to Supabase from this working tree.

ALTER TABLE "Issuance" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Issuance_facilityId_idempotencyKey_key" ON "Issuance"("facilityId", "idempotencyKey");
