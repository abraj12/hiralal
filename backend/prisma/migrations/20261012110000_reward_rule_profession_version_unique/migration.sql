-- Migration: Add unique constraint on RewardRule(profession, version)
-- Step 1: Pre-check for duplicate (profession, version) records.
-- If duplicates are found, abort with an actionable diagnostic rather than deleting or modifying historical records.
DO $$
DECLARE
    duplicate_count INTEGER;
    dup_details TEXT;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT profession, version
        FROM "RewardRule"
        GROUP BY profession, version
        HAVING COUNT(*) > 1
    ) dups;

    IF duplicate_count > 0 THEN
        SELECT string_agg(profession || ' v' || version || ' (count: ' || cnt || ')', ', ') INTO dup_details
        FROM (
            SELECT profession, version, COUNT(*) as cnt
            FROM "RewardRule"
            GROUP BY profession, version
            HAVING COUNT(*) > 1
        ) dups;

        RAISE EXCEPTION 'Migration aborted: Duplicate (profession, version) records detected in RewardRule: %. Historical data must be reconciled manually by an administrator without in-place mutation.', dup_details;
    END IF;
END $$;

-- Step 2: Create the unique index on (profession, version)
CREATE UNIQUE INDEX IF NOT EXISTS "RewardRule_profession_version_key" ON "RewardRule"("profession", "version");
