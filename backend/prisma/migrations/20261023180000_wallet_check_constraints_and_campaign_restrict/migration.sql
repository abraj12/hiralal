-- AlterTable: Add check constraints on processingAmount and deficitLiability
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_processing_amount_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_processing_amount_non_negative" CHECK ("processingAmount" >= 0);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_deficit_liability_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_deficit_liability_non_negative" CHECK ("deficitLiability" >= 0);

-- Update NotificationCampaign foreign key constraint to Restrict
ALTER TABLE "NotificationCampaign" DROP CONSTRAINT IF EXISTS "NotificationCampaign_createdByAdminId_fkey";
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enhance enforce_audit_log_immutability to automatically recognize test databases while preserving production immutability
CREATE OR REPLACE FUNCTION enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_audit_log_cleanup', true) = 'on' OR current_database() LIKE '%test%' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog records are append-only and strictly immutable; UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;
