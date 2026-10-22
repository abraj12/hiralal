-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "deficitLiability" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- Restore non-negative constraint on availableBalance to eliminate balance deficit overdrafts
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_available_balance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_available_balance_non_negative" CHECK ("availableBalance" >= 0);
