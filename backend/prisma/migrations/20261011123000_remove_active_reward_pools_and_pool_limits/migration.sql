-- DropTable
DROP TABLE IF EXISTS "RewardPool";

-- DropTable
DROP TABLE IF EXISTS "GlobalRewardPool";

-- AlterTable
ALTER TABLE "RewardRule" DROP COLUMN IF EXISTS "monthlyPoolLimit";
