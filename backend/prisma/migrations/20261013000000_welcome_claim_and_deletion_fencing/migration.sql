-- Migration: Add claim tracking to AppInstallation and database-level fencing/lease fields to AccountDeletionOperation

-- 1. Extend WelcomeDeliveryStatus enum with SENDING and ACCEPTED
ALTER TYPE "WelcomeDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "WelcomeDeliveryStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';

-- 2. Add claim fields and index to AppInstallation
ALTER TABLE "AppInstallation" ADD COLUMN IF NOT EXISTS "claimId" TEXT;
ALTER TABLE "AppInstallation" ADD COLUMN IF NOT EXISTS "claimExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "AppInstallation_welcomeStatus_idx" ON "AppInstallation"("welcomeStatus");

-- 3. Add lease/fencing fields and index to AccountDeletionOperation
ALTER TABLE "AccountDeletionOperation" ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT;
ALTER TABLE "AccountDeletionOperation" ADD COLUMN IF NOT EXISTS "leaseVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AccountDeletionOperation" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "AccountDeletionOperation_leaseOwner_idx" ON "AccountDeletionOperation"("leaseOwner");
