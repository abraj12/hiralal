-- Dynamic Business Rules, Profession Separation, and GST Financial Architecture Migration
-- Hiralal & Sons Sales Pvt. Ltd.

-- Drop previous year_month index on RewardPool if exists
DROP INDEX IF EXISTS "RewardPool_year_month_key";

-- Alter Table Bill: Add financial calculation snapshots and foreign keys
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "eligibleRewardAmount" DECIMAL(12,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "grossBillAmount" DECIMAL(12,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstAmount" DECIMAL(12,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstOverrideReason" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstRate" DECIMAL(5,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstRuleId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "rewardRateSnapshot" DECIMAL(5,2);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "rewardRuleId" TEXT;
ALTER TABLE "Bill" ALTER COLUMN "rewardPercentage" DROP NOT NULL;
ALTER TABLE "Bill" ALTER COLUMN "rewardPercentage" DROP DEFAULT;

-- Backfill grossBillAmount for existing bills
UPDATE "Bill" SET "grossBillAmount" = "billAmount" WHERE "grossBillAmount" IS NULL;

-- Alter Table RedemptionSettings: Support profession-specific windows
ALTER TABLE "RedemptionSettings" ADD COLUMN IF NOT EXISTS "profession" "Profession";

-- Alter Table RewardPool: Separate pools per profession
ALTER TABLE "RewardPool" ADD COLUMN IF NOT EXISTS "profession" "Profession" NOT NULL DEFAULT 'PLUMBER';

-- Alter Table RewardRule: Add versioning, auditing, and profession-specific limits
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'RewardRule' AND column_name = 'percentage'
    ) THEN
        ALTER TABLE "RewardRule" RENAME COLUMN "percentage" TO "rewardPercentage";
    ELSE
        ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "rewardPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0.50;
    END IF;
END $$;

ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "createdByAdminId" TEXT;
ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "effectiveUntil" TIMESTAMP(3);
ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "maxRedemptionAmount" DECIMAL(12,2) NOT NULL DEFAULT 10000.00;
ALTER TABLE "RewardRule" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RewardRule" ALTER COLUMN "profession" SET NOT NULL;
ALTER TABLE "RewardRule" ALTER COLUMN "profession" SET DEFAULT 'PLUMBER';

-- Create Table GstRule for dynamic GST rates
CREATE TABLE IF NOT EXISTS "GstRule" (
    "id" TEXT NOT NULL,
    "ratePercentage" DECIMAL(5,2) NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstRule_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "GstRule_isActive_idx" ON "GstRule"("isActive");
CREATE INDEX IF NOT EXISTS "Bill_rewardRuleId_idx" ON "Bill"("rewardRuleId");
CREATE INDEX IF NOT EXISTS "Bill_gstRuleId_idx" ON "Bill"("gstRuleId");
CREATE UNIQUE INDEX IF NOT EXISTS "RedemptionSettings_profession_key" ON "RedemptionSettings"("profession");
CREATE INDEX IF NOT EXISTS "RewardPool_profession_year_month_idx" ON "RewardPool"("profession", "year", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardPool_profession_year_month_key" ON "RewardPool"("profession", "year", "month");
CREATE INDEX IF NOT EXISTS "RewardRule_profession_isActive_idx" ON "RewardRule"("profession", "isActive");
CREATE INDEX IF NOT EXISTS "RewardRule_effectiveFrom_effectiveUntil_idx" ON "RewardRule"("effectiveFrom", "effectiveUntil");

-- Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Bill_rewardRuleId_fkey') THEN
        ALTER TABLE "Bill" ADD CONSTRAINT "Bill_rewardRuleId_fkey" FOREIGN KEY ("rewardRuleId") REFERENCES "RewardRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Bill_gstRuleId_fkey') THEN
        ALTER TABLE "Bill" ADD CONSTRAINT "Bill_gstRuleId_fkey" FOREIGN KEY ("gstRuleId") REFERENCES "GstRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Seed Default GST Rates if none exist
INSERT INTO "GstRule" ("id", "ratePercentage", "description", "isDefault", "isActive", "createdAt", "updatedAt")
VALUES
    ('gst_0_pct', 0.00, 'Exempt / Zero GST', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gst_5_pct', 5.00, '5% Concessional GST', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gst_12_pct', 12.00, '12% Standard GST', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gst_18_pct', 18.00, '18% Standard Services & Hardware GST', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gst_28_pct', 28.00, '28% Luxury Hardware GST', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Seed Separate Default Rules for PLUMBER and TILE_INSTALLER if not present
INSERT INTO "RewardRule" ("id", "profession", "rewardPercentage", "monthlyPoolLimit", "minRedemptionAmount", "maxRedemptionAmount", "isActive", "version", "createdAt", "updatedAt")
VALUES
    ('rule_plumber_v1', 'PLUMBER', 0.50, 50000.00, 500.00, 10000.00, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('rule_tile_v1', 'TILE_INSTALLER', 0.75, 50000.00, 500.00, 10000.00, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
