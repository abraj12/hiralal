-- Migration 39: Fix Trigger Execution Order, Invoice Key Normalization, AuditLog Truncate Protection, and Redundant Indexes
-- Addresses HIR-TRIGGER-01, HIR-RT-01, HIR-TRIGGER-02, HIR-AUDIT-01, HIR-INDEX-01

-- 1. Defensively update check_bill_invoice_submission_allowed to populate keys if empty
CREATE OR REPLACE FUNCTION check_bill_invoice_submission_allowed()
RETURNS TRIGGER AS $$
DECLARE
  v_res_exp TIMESTAMPTZ;
  v_res_user TEXT;
BEGIN
  -- Defensive key derivation: eliminates alphabetical trigger order bypass on INSERT
  IF NEW."invoicePeriod" IS NULL OR NEW."invoicePeriod" = '' THEN
    NEW."invoicePeriod" := to_char((NEW."invoiceDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
  END IF;
  
  IF NEW."invoiceKey" IS NULL OR NEW."invoiceKey" = '' THEN
    NEW."invoiceKey" := regexp_replace(upper(trim(NEW."invoiceNumber")), '[^A-Z0-9]', '', 'g');
    -- Strip leading zeros from numeric sequences: INV0042 -> INV42
    NEW."invoiceKey" := regexp_replace(NEW."invoiceKey", '([A-Z]+)0+([1-9][0-9]*)', '\1\2', 'g');
  END IF;

  -- Disqualification check (permanent fraud blacklist)
  IF EXISTS (
    SELECT 1 FROM "Bill"
    WHERE "invoicePeriod" = NEW."invoicePeriod"
      AND "invoiceKey" = NEW."invoiceKey"
      AND ("status" = 'CANCELLED' OR "isDisqualified" = true)
      AND "id" != NEW."id"
  ) THEN
    RAISE EXCEPTION 'Invoice is permanently disqualified on the platform.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 7-Day claimant reservation check
  SELECT "reservationExpiresAt", "userId"
  INTO v_res_exp, v_res_user
  FROM "Bill"
  WHERE "invoicePeriod" = NEW."invoicePeriod"
    AND "invoiceKey" = NEW."invoiceKey"
    AND "status" = 'REJECTED'
    AND "reservationExpiresAt" IS NOT NULL
    AND "reservationExpiresAt" > clock_timestamp()
    AND "id" != NEW."id"
  ORDER BY "createdAt" DESC
  LIMIT 1;

  IF FOUND AND v_res_user != NEW."userId" THEN
    RAISE EXCEPTION 'Invoice is currently reserved for correction by another customer.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Update set_bill_invoice_identity to also strip leading zeros
CREATE OR REPLACE FUNCTION set_bill_invoice_identity()
RETURNS TRIGGER AS $$
BEGIN
  NEW."invoicePeriod" := to_char((NEW."invoiceDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
  NEW."invoiceKey" := regexp_replace(upper(trim(NEW."invoiceNumber")), '[^A-Z0-9]', '', 'g');
  -- Strip leading zeros from numeric sequences: INV0042 -> INV42
  NEW."invoiceKey" := regexp_replace(NEW."invoiceKey", '([A-Z]+)0+([1-9][0-9]*)', '\1\2', 'g');
  IF NEW."invoiceKey" = '' THEN
    RAISE EXCEPTION 'Invoice number must contain at least one letter or digit.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Expand trigger UPDATE OF clause to include invoiceNumber and invoiceDate
DROP TRIGGER IF EXISTS "Bill_check_submission_allowed_trigger" ON "Bill";
CREATE TRIGGER "Bill_check_submission_allowed_trigger"
BEFORE INSERT OR UPDATE OF "invoicePeriod", "invoiceKey", "status", "userId", "invoiceNumber", "invoiceDate" ON "Bill"
FOR EACH ROW EXECUTE FUNCTION check_bill_invoice_submission_allowed();

-- 4. Add statement-level TRUNCATE protection on AuditLog
CREATE OR REPLACE FUNCTION prevent_audit_log_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE operation is prohibited on AuditLog table.'
    USING ERRCODE = 'P0003';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON "AuditLog";
CREATE TRIGGER trg_audit_log_no_truncate
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_truncate();

-- 5. Drop redundant duplicate indexes on blind indexes
DROP INDEX IF EXISTS "KycRecord_panBlindIndex_idx";
DROP INDEX IF EXISTS "PaymentAccount_beneficiaryBlindIndex_idx";
