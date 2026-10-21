-- AlterTable User: Add statutoryRetentionExpiresAt and legalHold
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statutoryRetentionExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legalHold" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_statutoryRetentionExpiresAt_idx" ON "User"("statutoryRetentionExpiresAt");

-- Update foreign keys on KycRecord and PaymentAccount from CASCADE to RESTRICT
ALTER TABLE "KycRecord" DROP CONSTRAINT IF EXISTS "KycRecord_userId_fkey";
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAccount" DROP CONSTRAINT IF EXISTS "PaymentAccount_userId_fkey";
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
