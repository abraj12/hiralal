-- AlterTable: Add check constraints on Payout amounts (DB-004 / FIN-001 / VER-003)
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "chk_payout_amount_valid_range";
ALTER TABLE "Payout" ADD CONSTRAINT "chk_payout_amount_valid_range" CHECK ("amount" > 0 AND "amount" <= 50000.00);

-- AlterTable: Add check constraints on RedemptionSettings ceilings (FIN-001)
ALTER TABLE "RedemptionSettings" DROP CONSTRAINT IF EXISTS "chk_redemption_settings_maximum_ceiling";
ALTER TABLE "RedemptionSettings" ADD CONSTRAINT "chk_redemption_settings_maximum_ceiling" CHECK ("maximumRedemptionAmount" IS NULL OR ("maximumRedemptionAmount" >= 0 AND "maximumRedemptionAmount" <= 50000.00));

ALTER TABLE "RedemptionSettings" DROP CONSTRAINT IF EXISTS "chk_redemption_settings_minimum_ceiling";
ALTER TABLE "RedemptionSettings" ADD CONSTRAINT "chk_redemption_settings_minimum_ceiling" CHECK ("minimumRedemptionAmount" IS NULL OR ("minimumRedemptionAmount" > 0 AND "minimumRedemptionAmount" <= 50000.00));

-- CreateIndex: Add partial unique index on PaymentAccount enforcing at most one default account per user (DB-005)
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAccount_user_single_default_idx"
ON "PaymentAccount"("userId")
WHERE "isDefault" = true;

-- CreateIndex: Add partial unique index on WalletTransaction to reject duplicate reward credits (DB-007)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wallet_tx_bill_reward_credit_unique"
ON "WalletTransaction"("referenceId")
WHERE "referenceType" = 'BILL' AND "type" = 'REWARD_CREDIT';
