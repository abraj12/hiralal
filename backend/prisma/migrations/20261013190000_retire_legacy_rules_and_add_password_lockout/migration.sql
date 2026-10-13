-- AlterTable User to add failedPasswordAttempts and lockedUntil
ALTER TABLE "User" ADD COLUMN "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Retire legacy seeded default reward rules (ensures no unconfigured fallback reward percentages)
UPDATE "RewardRule" SET "isActive" = false WHERE "id" IN ('rule_plumber_v1', 'rule_tile_v1');

-- Retire legacy seeded default GST rules (ensures no unconfigured fallback GST rates)
UPDATE "GstRule" SET "isActive" = false, "isDefault" = false WHERE "id" IN ('gst_0_pct', 'gst_5_pct', 'gst_12_pct', 'gst_18_pct', 'gst_28_pct');
