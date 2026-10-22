-- VULN-DB-01: Update Wallet.userId foreign key from CASCADE to RESTRICT
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_userId_fkey";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- VULN-FIN-04: Database-level CHECK constraint ensuring non-negative totalRedeemed
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_total_redeemed_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_total_redeemed_non_negative" CHECK ("totalRedeemed" >= 0);

-- Immutable Bill Revisions & Cancellation Schema Fields
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "parentBillId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "revisionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "cancelledByAdminId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "requiresSecondaryApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "secondaryApprovedByAdminId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "secondaryApprovedAt" TIMESTAMP(3);

-- Revisions Foreign Key
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_parentBillId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_parentBillId_fkey" FOREIGN KEY ("parentBillId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index on parentBillId
CREATE INDEX IF NOT EXISTS "Bill_parentBillId_idx" ON "Bill"("parentBillId");

-- Replace unconditional user_invoice_unique with revision unique and partial unique indexes (ADV-07)
DROP INDEX IF EXISTS "Bill_userId_invoiceNumber_key";
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_userId_invoiceNumber_key";
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "user_invoice_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "Bill_userId_invoiceNumber_revisionNumber_key" ON "Bill"("userId", "invoiceNumber", "revisionNumber");

-- Partial unique indexes enforcing business rules
CREATE UNIQUE INDEX IF NOT EXISTS "user_invoice_approved_unique" ON "Bill"("userId", "invoiceNumber") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS "user_invoice_active_unique" ON "Bill"("userId", "invoiceNumber") WHERE "status" IN ('PENDING', 'UNDER_REVIEW');
CREATE UNIQUE INDEX IF NOT EXISTS "global_invoice_approved_unique" ON "Bill"("invoiceNumber") WHERE "status" = 'APPROVED';
