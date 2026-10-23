-- AlterTable: Add positive check constraint on WalletTransaction amount
ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS "chk_wallet_transaction_amount_positive";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "chk_wallet_transaction_amount_positive" CHECK ("amount" > 0);

-- AlterTable: Add check constraints on Bill amounts
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "chk_bill_amount_positive";
ALTER TABLE "Bill" ADD CONSTRAINT "chk_bill_amount_positive" CHECK ("billAmount" > 0);

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "chk_bill_reward_non_negative";
ALTER TABLE "Bill" ADD CONSTRAINT "chk_bill_reward_non_negative" CHECK ("calculatedReward" >= 0);
