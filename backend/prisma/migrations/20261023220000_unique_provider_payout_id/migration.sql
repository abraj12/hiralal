-- A provider payout ID must identify exactly one local payout.
-- Fail the migration safely if legacy data already contains duplicates; do not guess
-- which financial record should own a provider identifier.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Payout"
    WHERE "razorpayPayoutId" IS NOT NULL
    GROUP BY "razorpayPayoutId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce unique RazorpayX payout IDs: duplicate non-null values exist in Payout. Reconcile these records before migrating.';
  END IF;
END $$;

DROP INDEX IF EXISTS "Payout_razorpayPayoutId_idx";

CREATE UNIQUE INDEX "Payout_razorpayPayoutId_key"
  ON "Payout"("razorpayPayoutId");
