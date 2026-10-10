-- AlterTable User: Add structured name fields, name lock fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "middleName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isNameLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nameLockedAt" TIMESTAMP(3);

-- Populate existing users firstName from legacy fullName
UPDATE "User"
SET "firstName" = split_part("fullName", ' ', 1)
WHERE "firstName" IS NULL AND "fullName" IS NOT NULL AND length("fullName") > 0;

-- AlterTable KycRecord: Update consent default to false, add consentText, verifiedName, nameMatched
ALTER TABLE "KycRecord" ALTER COLUMN "consent" SET DEFAULT false;
ALTER TABLE "KycRecord" ADD COLUMN IF NOT EXISTS "consentText" TEXT;
ALTER TABLE "KycRecord" ADD COLUMN IF NOT EXISTS "verifiedName" TEXT;
ALTER TABLE "KycRecord" ADD COLUMN IF NOT EXISTS "nameMatched" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Payout: Add admin approval fields
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "approvedByAdminId" TEXT;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "adminRejectionReason" TEXT;
