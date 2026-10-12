-- Migration: Remove reward percentage default, add minimumRedemptionAmount, add account deletion lifecycle fields, and enforce two-admin unique invariant

-- 1. Extend OtpPurpose enum with ACCOUNT_DELETION
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION';

-- 2. Drop column defaults from RewardRule (no silent 0.50% default)
ALTER TABLE "RewardRule" ALTER COLUMN "rewardPercentage" DROP DEFAULT;
ALTER TABLE "RewardRule" ALTER COLUMN "profession" DROP DEFAULT;

-- 3. Add minimumRedemptionAmount to RedemptionSettings
ALTER TABLE "RedemptionSettings" ADD COLUMN IF NOT EXISTS "minimumRedemptionAmount" DECIMAL(12, 2);

-- 4. Add account deletion lifecycle fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionScheduledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastDeletionRequestAt" TIMESTAMP(3);

-- 5. Enforce Two-Admin invariant with pre-checks and partial unique indexes
DO $$
DECLARE
    bill_admin_count INTEGER;
    ops_admin_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO bill_admin_count FROM "User" WHERE "role" = 'BILL_ADMIN';
    IF bill_admin_count > 1 THEN
        RAISE EXCEPTION 'Migration aborted: Multiple BILL_ADMIN accounts detected (count: %). At most one active BILL_ADMIN is permitted.', bill_admin_count;
    END IF;

    SELECT COUNT(*) INTO ops_admin_count FROM "User" WHERE "role" = 'OPERATIONS_ADMIN';
    IF ops_admin_count > 1 THEN
        RAISE EXCEPTION 'Migration aborted: Multiple OPERATIONS_ADMIN accounts detected (count: %). At most one active OPERATIONS_ADMIN is permitted.', ops_admin_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "User_single_bill_admin_key" ON "User"("role") WHERE "role" = 'BILL_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS "User_single_ops_admin_key" ON "User"("role") WHERE "role" = 'OPERATIONS_ADMIN';
