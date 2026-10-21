-- AlterTable: PaymentAccount (Add upiIdEncrypted for AES-256-GCM encrypted UPI address storage)
ALTER TABLE "PaymentAccount" ADD COLUMN IF NOT EXISTS "upiIdEncrypted" TEXT;
