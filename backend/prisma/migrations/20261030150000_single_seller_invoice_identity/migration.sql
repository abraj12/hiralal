-- Single-seller invoice identity.
--
-- Hiralal & Sons is the only seller, and its invoice serials restart each month. A genuine invoice is
-- therefore identified by: Hiralal & Sons + YYYY-MM of the invoice date (Asia/Kolkata) + normalised
-- invoice number. The amount is deliberately NOT part of the identity, so changing the claimed amount
-- cannot make a duplicate look unique. Uniqueness is platform-wide, across all customers.
--
-- Replaces the vendor-scoped indexes (20261024120000) and the per-user indexes (20261022120000).

-- Step 1: Identity columns, always derived by the database from invoiceNumber / invoiceDate.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "invoicePeriod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "invoiceKey" TEXT NOT NULL DEFAULT '';

-- invoiceDate is stored as midnight Asia/Kolkata in a UTC timestamp column, so the month must be
-- taken in IST. The key keeps only A-Z / 0-9 so "inv-001", "INV 001" and "INV001" are the same invoice.
-- Must stay in sync with getInvoiceIdentity() in backend/src/utils/invoice-identity.utils.ts.
CREATE OR REPLACE FUNCTION set_bill_invoice_identity()
RETURNS TRIGGER AS $$
BEGIN
  NEW."invoicePeriod" := to_char((NEW."invoiceDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
  NEW."invoiceKey" := regexp_replace(upper(trim(NEW."invoiceNumber")), '[^A-Z0-9]', '', 'g');
  IF NEW."invoiceKey" = '' THEN
    RAISE EXCEPTION 'Invoice number must contain at least one letter or digit.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Bill_invoice_identity_trigger" ON "Bill";
CREATE TRIGGER "Bill_invoice_identity_trigger"
BEFORE INSERT OR UPDATE OF "invoiceNumber", "invoiceDate", "invoicePeriod", "invoiceKey" ON "Bill"
FOR EACH ROW EXECUTE FUNCTION set_bill_invoice_identity();

-- Step 2: Backfill existing rows (fires the trigger).
UPDATE "Bill" SET "invoiceKey" = "invoiceKey";

-- Step 3: Refuse to continue if live claims already collide. These are invoices rewarded (or queued
-- for reward) more than once; they must be resolved by Operations (cancel/reject the extra claims)
-- before this migration can apply. See DEPLOYMENT.md "Single-seller invoice identity".
DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(format('%s/%s (%s bills)', "invoicePeriod", "invoiceKey", cnt), ', ')
  INTO conflicts
  FROM (
    SELECT "invoicePeriod", "invoiceKey", COUNT(*) AS cnt
    FROM "Bill"
    WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED')
    GROUP BY "invoicePeriod", "invoiceKey"
    HAVING COUNT(*) > 1
  ) dup;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate live invoice claims must be resolved before migrating: %', conflicts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Bill" WHERE "parentBillId" IS NOT NULL GROUP BY "parentBillId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A rejected bill has more than one resubmission; resolve forked revision chains before migrating.';
  END IF;
END $$;

-- Step 4: Drop vendor-scoped and per-user uniqueness. Per-user indexes on the raw invoice number
-- would wrongly block the same customer's INV-001 of October and INV-001 of November.
DROP INDEX IF EXISTS "Bill_vendor_gstin_lower_invoice_approved_idx";
DROP INDEX IF EXISTS "Bill_merchant_lower_invoice_approved_idx";
DROP INDEX IF EXISTS "Bill_user_lower_invoice_approved_idx";
DROP INDEX IF EXISTS "user_invoice_approved_unique";
DROP INDEX IF EXISTS "user_invoice_active_unique";
DROP INDEX IF EXISTS "Bill_userId_invoiceNumber_revisionNumber_key";
DROP INDEX IF EXISTS "Bill_vendorGstin_idx";
DROP INDEX IF EXISTS "Bill_merchantName_idx";

-- Step 5: One live claim per genuine invoice across the whole platform. REJECTED, DUPLICATE and
-- CANCELLED bills do not hold the identity, so a rejected invoice can be resubmitted as a revision.
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_live_invoice_identity_key"
ON "Bill" ("invoicePeriod", "invoiceKey")
WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED');

CREATE INDEX IF NOT EXISTS "Bill_invoicePeriod_invoiceKey_idx" ON "Bill" ("invoicePeriod", "invoiceKey");

-- Step 6: A rejected bill can be resubmitted once; revision chains cannot fork.
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_parentBillId_key" ON "Bill" ("parentBillId");
DROP INDEX IF EXISTS "Bill_parentBillId_idx";

-- vendorGstin / merchantName are kept (nullable, no longer written) so historical rows are preserved.
