-- AlterTable
ALTER TABLE "AccountDeletionOperation" ADD COLUMN "destructiveStartedAt" TIMESTAMP(3);

-- Reconcile any pre-existing duplicate active operations by marking older duplicates as CANCELLED
WITH ranked_ops AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "userId"
           ORDER BY "createdAt" DESC, "id" DESC
         ) as rn
  FROM "AccountDeletionOperation"
  WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
)
UPDATE "AccountDeletionOperation"
SET "status" = 'CANCELLED',
    "completedAt" = CURRENT_TIMESTAMP,
    "lastError" = 'Reconciled: superseded by newer active operation during migration'
WHERE id IN (SELECT id FROM ranked_ops WHERE rn > 1);

-- Create partial unique index to enforce exactly one active deletion operation per user
CREATE UNIQUE INDEX "AccountDeletionOperation_one_active_per_user_idx"
ON "AccountDeletionOperation" ("userId")
WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE');
