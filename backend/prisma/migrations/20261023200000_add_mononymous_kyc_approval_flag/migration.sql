-- Persist explicit Operations Admin approval for mononymous KYC cases.
-- Ordinary successful KYC and generic name locking must not imply this exception.
ALTER TABLE "KycRecord"
  ADD COLUMN "mononymousApproved" BOOLEAN NOT NULL DEFAULT FALSE;
