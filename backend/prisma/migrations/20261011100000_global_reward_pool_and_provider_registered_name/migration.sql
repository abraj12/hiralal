-- AlterTable: Add providerRegisteredName to PaymentAccount
ALTER TABLE "PaymentAccount" ADD COLUMN IF NOT EXISTS "providerRegisteredName" TEXT;

-- CreateTable: GlobalRewardPool for combined monthly rewards cap across all professions
CREATE TABLE IF NOT EXISTS "GlobalRewardPool" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalPoolCap" DECIMAL(12,2) NOT NULL DEFAULT 50000.00,
    "usedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "isCapped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalRewardPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique composite index on [year, month]
CREATE UNIQUE INDEX IF NOT EXISTS "GlobalRewardPool_year_month_key" ON "GlobalRewardPool"("year", "month");

-- CreateIndex: Query index on [year, month]
CREATE INDEX IF NOT EXISTS "GlobalRewardPool_year_month_idx" ON "GlobalRewardPool"("year", "month");
