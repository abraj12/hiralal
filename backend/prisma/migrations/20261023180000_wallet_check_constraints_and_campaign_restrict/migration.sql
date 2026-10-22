-- AlterTable: Add check constraints on processingAmount and deficitLiability
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_processing_amount_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_processing_amount_non_negative" CHECK ("processingAmount" >= 0);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_deficit_liability_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_deficit_liability_non_negative" CHECK ("deficitLiability" >= 0);

-- Update NotificationCampaign foreign key constraint to Restrict
ALTER TABLE "NotificationCampaign" DROP CONSTRAINT IF EXISTS "NotificationCampaign_createdByAdminId_fkey";
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
