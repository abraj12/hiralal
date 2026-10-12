-- Migration: Safely remove legacy ADMIN role from UserRole enum

-- 1. Safety precondition: Ensure no records in User table have legacy 'ADMIN' role
DO $$
DECLARE
    legacy_admin_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO legacy_admin_count FROM "User" WHERE "role"::text = 'ADMIN';
    IF legacy_admin_count > 0 THEN
        RAISE EXCEPTION 'Cannot remove ADMIN role: % user record(s) still have legacy role ADMIN. Run legacy admin migration before applying this migration.', legacy_admin_count;
    END IF;
END $$;

-- 2. Drop dependent indexes and default value on "User"."role"
DROP INDEX IF EXISTS "User_single_bill_admin_key";
DROP INDEX IF EXISTS "User_single_ops_admin_key";
DROP INDEX IF EXISTS "User_role_idx";
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- 3. Replace UserRole enum with new enum without ADMIN
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('USER', 'BILL_ADMIN', 'OPERATIONS_ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
DROP TYPE "UserRole_old";

-- 4. Restore column default and indexes
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER'::"UserRole";
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE UNIQUE INDEX "User_single_bill_admin_key" ON "User"("role") WHERE "role" = 'BILL_ADMIN';
CREATE UNIQUE INDEX "User_single_ops_admin_key" ON "User"("role") WHERE "role" = 'OPERATIONS_ADMIN';
