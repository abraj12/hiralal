-- AlterTable: KycRecord (Make panNumber nullable, add panBlindIndex with unique constraint)
ALTER TABLE "KycRecord" ALTER COLUMN "panNumber" DROP NOT NULL;
ALTER TABLE "KycRecord" ADD COLUMN IF NOT EXISTS "panBlindIndex" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "KycRecord_panBlindIndex_key" ON "KycRecord"("panBlindIndex");
CREATE INDEX IF NOT EXISTS "KycRecord_panBlindIndex_idx" ON "KycRecord"("panBlindIndex");
DROP INDEX IF EXISTS "KycRecord_panNumber_idx";

-- AlterTable: Payout (Add reconciliation tracking and manual review escalation fields)
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "lastReconciledAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "requiresManualReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "manualReviewReason" TEXT;
CREATE INDEX IF NOT EXISTS "Payout_requiresManualReview_idx" ON "Payout"("requiresManualReview");

-- AlterTable: WebhookEvent (Add lease timestamp, attempts, lastError, and updatedAt)
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX IF EXISTS "WebhookEvent_isProcessed_idx";
CREATE INDEX IF NOT EXISTS "WebhookEvent_isProcessed_processingStartedAt_idx" ON "WebhookEvent"("isProcessed", "processingStartedAt");

-- AlterTable: WalletTransaction (Add composite index for ledger reference lookups)
CREATE INDEX IF NOT EXISTS "WalletTransaction_referenceType_referenceId_idx" ON "WalletTransaction"("referenceType", "referenceId");
