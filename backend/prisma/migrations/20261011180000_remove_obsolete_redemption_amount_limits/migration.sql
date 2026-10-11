-- AlterTable
ALTER TABLE "RewardRule" DROP COLUMN IF EXISTS "minRedemptionAmount";
ALTER TABLE "RewardRule" DROP COLUMN IF EXISTS "maxRedemptionAmount";

-- AlterTable
ALTER TABLE "RedemptionSettings" DROP COLUMN IF EXISTS "minimumAmount";
ALTER TABLE "RedemptionSettings" DROP COLUMN IF EXISTS "maximumAmount";
