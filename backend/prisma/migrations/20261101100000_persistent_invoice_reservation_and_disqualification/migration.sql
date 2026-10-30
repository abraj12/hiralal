-- Persistent Single-Seller Invoice Reservation & Disqualification Architecture
-- Remediates HIR-AUD-P0-01
--
-- Invariants:
-- 1. When an invoice is REJECTED (correctable defect), its identity remains reserved
--    for the submitting customer for a 7-day correction window (reservationExpiresAt).
--    Competing customers are strictly blocked from hijacking the invoice claim.
-- 2. When an invoice is CANCELLED (confirmed fraud/ineligible), its identity is
--    permanently disqualified across the entire platform. No customer can ever resubmit it.
-- 3. Live claims (PENDING, UNDER_REVIEW, APPROVED) remain covered by Bill_live_invoice_identity_key.

-- Step 1: Add reservation and disqualification columns
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "reservationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "isDisqualified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "disqualifiedAt" TIMESTAMP(3);

-- Step 2: Safe backfill of historical rows
-- Mark historical cancelled bills as disqualified
UPDATE "Bill"
SET "isDisqualified" = true,
    "disqualifiedAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'CANCELLED' AND "isDisqualified" = false;

-- Backfill 7-day reservation on historical rejected bills (expired if >7 days old)
UPDATE "Bill"
SET "reservationExpiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "status" = 'REJECTED' AND "reservationExpiresAt" IS NULL;

-- Step 3: Indexes
-- Unique index to prevent duplicate disqualified claims
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_disqualified_invoice_identity_key"
ON "Bill" ("invoicePeriod", "invoiceKey")
WHERE "isDisqualified" = true;

-- Composite index for fast reservation check
CREATE INDEX IF NOT EXISTS "Bill_invoice_reservation_idx"
ON "Bill" ("invoicePeriod", "invoiceKey", "reservationExpiresAt")
WHERE "status" = 'REJECTED';

-- Step 4: Database-level enforcement trigger
CREATE OR REPLACE FUNCTION check_bill_invoice_submission_allowed()
RETURNS TRIGGER AS $$
DECLARE
  conflict_user_id TEXT;
BEGIN
  -- 1. Check if invoice identity is permanently disqualified (cancelled fraud)
  IF EXISTS (
    SELECT 1 FROM "Bill"
    WHERE "invoicePeriod" = NEW."invoicePeriod"
      AND "invoiceKey" = NEW."invoiceKey"
      AND ("status" = 'CANCELLED' OR "isDisqualified" = true)
      AND "id" != NEW."id"
  ) THEN
    RAISE EXCEPTION 'Invoice % dated % has been permanently disqualified and cannot be submitted for rewards.', NEW."invoiceNumber", NEW."invoicePeriod";
  END IF;

  -- 2. Check if invoice is currently reserved by a rejected bill undergoing 7-day correction by another claimant
  SELECT "userId" INTO conflict_user_id
  FROM "Bill"
  WHERE "invoicePeriod" = NEW."invoicePeriod"
    AND "invoiceKey" = NEW."invoiceKey"
    AND "status" = 'REJECTED'
    AND "reservationExpiresAt" IS NOT NULL
    AND "reservationExpiresAt" > CURRENT_TIMESTAMP
    AND "userId" != NEW."userId"
    AND "id" != NEW."id"
  ORDER BY "reservationExpiresAt" DESC
  LIMIT 1;

  IF conflict_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % dated % is currently reserved by another customer under review.', NEW."invoiceNumber", NEW."invoicePeriod";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Bill_check_submission_allowed_trigger" ON "Bill";
CREATE TRIGGER "Bill_check_submission_allowed_trigger"
BEFORE INSERT OR UPDATE OF "invoicePeriod", "invoiceKey", "status", "userId" ON "Bill"
FOR EACH ROW EXECUTE FUNCTION check_bill_invoice_submission_allowed();
