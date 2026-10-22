-- AlterTable
ALTER TABLE "RedemptionSettings" ADD COLUMN "maximumRedemptionAmount" DECIMAL(12,2);

-- Drop non-negative constraint on availableBalance to allow deficit liability modeling and preserve ledger parity (Task 1.2 / Operating Rule 3)
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_available_balance_non_negative";

-- CreateIndex
CREATE INDEX "User_deletionScheduledAt_status_legalHold_idx" ON "User"("deletionScheduledAt", "status", "legalHold");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_createdAt_idx" ON "WalletTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_type_idx" ON "WalletTransaction"("userId", "type");

-- CreateIndex
CREATE INDEX "PaymentAccount_ifscCode_idx" ON "PaymentAccount"("ifscCode");

-- CreateIndex
CREATE INDEX "Payout_status_requiresManualReview_updatedAt_idx" ON "Payout"("status", "requiresManualReview", "updatedAt");

-- Enforce append-only immutability on AuditLog (Task 4.3)
CREATE OR REPLACE FUNCTION enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_audit_log_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog records are append-only and strictly immutable; UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION enforce_audit_log_immutability();
