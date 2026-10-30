-- HIR-M-08: Consent and notice-acceptance records (additive)
CREATE TABLE IF NOT EXISTS "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConsentRecord_userId_purpose_idx" ON "ConsentRecord"("userId", "purpose");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConsentRecord_userId_fkey') THEN
    ALTER TABLE "ConsentRecord"
      ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
