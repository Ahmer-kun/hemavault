-- Phase 5 Step 4 (additive, forward-only): link reservation items to request lines
-- for per-line reserved-quantity accounting and partial fulfillment. Isolated DB only.

ALTER TABLE "ReservationItem" ADD COLUMN "requestLineId" TEXT;

CREATE INDEX "ReservationItem_requestLineId_idx" ON "ReservationItem"("requestLineId");

ALTER TABLE "ReservationItem"
  ADD CONSTRAINT "ReservationItem_requestLineId_fkey"
  FOREIGN KEY ("requestLineId") REFERENCES "BloodRequestLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
