-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'BILL_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_ADMIN';

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ADMIN_LOGIN';

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;

-- AlterTable AuthSession
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuthSession_sessionId_idx" ON "AuthSession"("sessionId");
