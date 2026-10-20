-- AlterTable: PaymentAccount (Add beneficiaryBlindIndex with unique constraint and index)
ALTER TABLE "PaymentAccount" ADD COLUMN IF NOT EXISTS "beneficiaryBlindIndex" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAccount_beneficiaryBlindIndex_key" ON "PaymentAccount"("beneficiaryBlindIndex");
CREATE INDEX IF NOT EXISTS "PaymentAccount_beneficiaryBlindIndex_idx" ON "PaymentAccount"("beneficiaryBlindIndex");
