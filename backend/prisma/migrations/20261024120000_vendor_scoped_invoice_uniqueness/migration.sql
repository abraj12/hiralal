-- Step 1: Add vendorGstin and merchantName columns to Bill
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "vendorGstin" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "merchantName" TEXT;

-- Step 2: Add DEFICIT_OFFSET to TransactionType enum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'DEFICIT_OFFSET';

-- Step 3: Drop global unscoped invoice number approved index (FINDING-05)
DROP INDEX IF EXISTS "Bill_lower_invoice_number_approved_idx";
DROP INDEX IF EXISTS "global_invoice_approved_unique";

-- Step 4: Create vendor-scoped composite partial unique indexes
-- For invoices with vendor GSTIN
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_vendor_gstin_lower_invoice_approved_idx"
ON "Bill" (LOWER(TRIM("vendorGstin")), LOWER(TRIM("invoiceNumber")))
WHERE "status" = 'APPROVED' AND "vendorGstin" IS NOT NULL;

-- For invoices with merchantName but no GSTIN
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_merchant_lower_invoice_approved_idx"
ON "Bill" (LOWER(TRIM("merchantName")), LOWER(TRIM("invoiceNumber")))
WHERE "status" = 'APPROVED' AND "vendorGstin" IS NULL AND "merchantName" IS NOT NULL;

-- For legacy or unorganized invoices with neither GSTIN nor merchantName (scoped per user)
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_user_lower_invoice_approved_idx"
ON "Bill" ("userId", LOWER(TRIM("invoiceNumber")))
WHERE "status" = 'APPROVED' AND "vendorGstin" IS NULL AND "merchantName" IS NULL;

-- Step 5: Regular query indexes
CREATE INDEX IF NOT EXISTS "Bill_vendorGstin_idx" ON "Bill" ("vendorGstin");
CREATE INDEX IF NOT EXISTS "Bill_merchantName_idx" ON "Bill" ("merchantName");
