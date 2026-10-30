-- HIR-M-12: Force rotation of provisioned administrator passwords.
-- Additive, idempotent. Existing administrators were created from *_INITIAL_PASSWORD environment
-- values and must choose a new password at their next sign-in.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

UPDATE "User"
SET "mustChangePassword" = true
WHERE "role" IN ('BILL_ADMIN', 'OPERATIONS_ADMIN')
  AND "passwordChangedAt" IS NULL;
