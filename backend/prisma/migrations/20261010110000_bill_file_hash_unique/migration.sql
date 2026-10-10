-- Prevent Concurrent Duplicate Invoice Files Migration
-- Hiralal & Sons Sales Pvt. Ltd.

-- Step 1: Detect existing duplicate non-null fileHash records and abort with clear error if found
DO $$
BEGIN
  IF EXISTS (
    SELECT "fileHash"
    FROM "Bill"
    WHERE "fileHash" IS NOT NULL
    GROUP BY "fileHash"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot apply unique index: duplicate non-null fileHash records exist in the Bill table. Remediation required before applying migration.';
  END IF;
END $$;

-- Step 2: Drop non-unique index if exists
DROP INDEX IF EXISTS "Bill_fileHash_idx";

-- Step 3: Create unique index on Bill.fileHash
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_fileHash_key" ON "Bill"("fileHash");
