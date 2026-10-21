-- SEC-HIGH-02: CreateIndex on Payout foreign keys to prevent sequential table scans & lock escalation
CREATE INDEX IF NOT EXISTS "Payout_walletId_idx" ON "Payout"("walletId");
CREATE INDEX IF NOT EXISTS "Payout_paymentAccountId_idx" ON "Payout"("paymentAccountId");

-- SEC-HIGH-03: Update foreign key rules from CASCADE to RESTRICT to protect statutory financial ledgers
ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS "WalletTransaction_walletId_fkey";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_userId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_userId_fkey";
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_walletId_fkey";
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_paymentAccountId_fkey";

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SEC-MED-08: Database-level CHECK constraints ensuring non-negative balances
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_available_balance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_available_balance_non_negative" CHECK ("availableBalance" >= 0);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "chk_wallet_processing_amount_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "chk_wallet_processing_amount_non_negative" CHECK ("processingAmount" >= 0);
