-- Migration: Add AppInstallation and AccountDeletionOperation models with associated enums and indexes

-- 1. Create Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WelcomeDeliveryStatus') THEN
        CREATE TYPE "WelcomeDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED_RETRYABLE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeletionOperationStatus') THEN
        CREATE TYPE "DeletionOperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE', 'COMPLETED', 'CANCELLED');
    END IF;
END $$;

-- 2. Create AppInstallation Table
CREATE TABLE IF NOT EXISTS "AppInstallation" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "userId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "pushToken" TEXT,
    "appVersion" TEXT,
    "welcomeSentAt" TIMESTAMP(3),
    "welcomeStatus" "WelcomeDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- AppInstallation Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "AppInstallation_installationId_key" ON "AppInstallation"("installationId");
CREATE INDEX IF NOT EXISTS "AppInstallation_userId_idx" ON "AppInstallation"("userId");
CREATE INDEX IF NOT EXISTS "AppInstallation_installationId_idx" ON "AppInstallation"("installationId");

-- AppInstallation Foreign Key
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AppInstallation_userId_fkey') THEN
        ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Create AccountDeletionOperation Table
CREATE TABLE IF NOT EXISTS "AccountDeletionOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DeletionOperationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deletedFilesCount" INTEGER NOT NULL DEFAULT 0,
    "failedFileKeys" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionOperation_pkey" PRIMARY KEY ("id")
);

-- AccountDeletionOperation Indexes
CREATE INDEX IF NOT EXISTS "AccountDeletionOperation_userId_idx" ON "AccountDeletionOperation"("userId");
CREATE INDEX IF NOT EXISTS "AccountDeletionOperation_status_idx" ON "AccountDeletionOperation"("status");
CREATE INDEX IF NOT EXISTS "AccountDeletionOperation_scheduledFor_idx" ON "AccountDeletionOperation"("scheduledFor");
CREATE INDEX IF NOT EXISTS "AccountDeletionOperation_nextRetryAt_idx" ON "AccountDeletionOperation"("nextRetryAt");

-- AccountDeletionOperation Foreign Key
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountDeletionOperation_userId_fkey') THEN
        ALTER TABLE "AccountDeletionOperation" ADD CONSTRAINT "AccountDeletionOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
