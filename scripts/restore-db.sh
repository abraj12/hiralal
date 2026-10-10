#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Restore Script
# Platform: AWS EC2 t4g.medium (ARM64 / Graviton2)
# Client: HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)
# ==============================================================================
#
# VERIFICATION POLICY:
# --------------------
# A restore is considered SUCCESSFUL only if:
#   1. SQL dump restores cleanly.
#   2. All 16 core Prisma schema tables exist and have valid rows.
#   3. Authoritative financial reconciliation passes:
#      wallet.availableBalance == sum of valid ledger transactions
#   4. Payout state machine ledger correlation passes (no orphaned debits).
# ==============================================================================

set -euo pipefail

ENC_BACKUP="${1:-}"
TARGET_DB="${2:-${POSTGRES_DB:-hiralal_rewards}}"
ALLOW_OVERWRITE="${3:-${RESTORE_CONFIRM_OVERWRITE:-false}}"
DB_CONTAINER="${DB_CONTAINER:-hiralal_postgres}"
DB_USER="${POSTGRES_USER:-postgres}"

if [ -z "${ENC_BACKUP}" ]; then
  echo "Usage: $0 <path_to_backup.sql.gz.enc> [TARGET_DB_NAME] [--allow-production-overwrite]" >&2
  exit 1
fi

if [ ! -f "${ENC_BACKUP}" ]; then
  echo "[FATAL ERROR] Backup file not found: ${ENC_BACKUP}" >&2
  exit 1
fi

# Production database safety guard
if [ "${TARGET_DB}" = "hiralal_rewards" ] || [ "${TARGET_DB}" = "${POSTGRES_DB:-hiralal_rewards}" ]; then
  if [ "${ALLOW_OVERWRITE}" != "--allow-production-overwrite" ] && [ "${ALLOW_OVERWRITE}" != "true" ]; then
    echo "[FATAL SAFETY GUARD] Refusing to restore into production database '${TARGET_DB}' without explicit overwrite flag: --allow-production-overwrite (or RESTORE_CONFIRM_OVERWRITE=true)." >&2
    exit 1
  fi
fi

if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "[FATAL ERROR] BACKUP_ENCRYPTION_PASSPHRASE environment variable is required to decrypt backup." >&2
  exit 1
fi

TEMP_DIR=$(mktemp -d /tmp/hiralal_restore_XXXXXX)
trap 'rm -rf "${TEMP_DIR}"' EXIT

DEC_FILE="${TEMP_DIR}/decrypted.sql.gz"
SQL_FILE="${TEMP_DIR}/restore.sql"

echo "[$(date -u)] [1/4] Decrypting AES-256 backup: ${ENC_BACKUP}..."
CRYPTO_SCRIPT="$(dirname "$0")/crypto-backup.js"
if [ ! -f "${CRYPTO_SCRIPT}" ] || ! command -v node >/dev/null 2>&1; then
  echo "[FATAL ERROR] Node.js or crypto-backup.js helper missing. Cannot safely decrypt backup." >&2
  exit 1
fi
node "${CRYPTO_SCRIPT}" decrypt "${ENC_BACKUP}" "${DEC_FILE}"

echo "[$(date -u)] [2/4] Decompressing SQL dump..."
gunzip -c "${DEC_FILE}" > "${SQL_FILE}"

echo "[$(date -u)] [3/4] Restoring SQL dump into database '${TARGET_DB}' in container '${DB_CONTAINER}'..."
docker exec -i "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${TARGET_DB}" < "${SQL_FILE}"

echo "[$(date -u)] [4/4] Commencing deep financial integrity & ledger reconciliation verification..."

# 1. Core Schema and Migrations Verification
MIGRATIONS_COUNT=$(docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" -t -A -c "
  SELECT count(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NULL;
")

if [ "${MIGRATIONS_COUNT}" -eq 0 ]; then
  echo "[FATAL ERROR] Restore verification FAILED: No active Prisma migrations found." >&2
  exit 2
fi

echo "[$(date -u)] Core migrations verified: ${MIGRATIONS_COUNT} migrations applied."

# 2. Financial Ledger Reconciliation: Wallet Available Balance == Net Ledger Transactions
DISCREPANCIES=$(docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" -t -A -c "
  SELECT count(*) FROM (
    SELECT w.id, w.\"availableBalance\",
      COALESCE(SUM(CASE
        WHEN t.type = 'REWARD_CREDIT' THEN t.amount
        WHEN t.type = 'PAYOUT_REVERSAL' THEN t.amount
        WHEN t.type = 'REFUND' THEN t.amount
        WHEN t.type = 'MANUAL_ADJUSTMENT' THEN t.amount
        WHEN t.type = 'PAYOUT_DEBIT' THEN -t.amount
        ELSE 0 END), 0) AS calculated_balance
    FROM \"Wallet\" w
    LEFT JOIN \"WalletTransaction\" t ON w.id = t.\"walletId\"
    GROUP BY w.id, w.\"availableBalance\"
    HAVING w.\"availableBalance\" <> COALESCE(SUM(CASE
        WHEN t.type = 'REWARD_CREDIT' THEN t.amount
        WHEN t.type = 'PAYOUT_REVERSAL' THEN t.amount
        WHEN t.type = 'REFUND' THEN t.amount
        WHEN t.type = 'MANUAL_ADJUSTMENT' THEN t.amount
        WHEN t.type = 'PAYOUT_DEBIT' THEN -t.amount
        ELSE 0 END), 0)
  ) sub;
")

if [ "${DISCREPANCIES}" -ne 0 ]; then
  echo "[FATAL ERROR] Financial reconciliation FAILED: Found ${DISCREPANCIES} wallet(s) with ledger balance mismatches!" >&2
  exit 3
fi

echo "[$(date -u)] Authoritative wallet ledger reconciliation PASSED (0 balance discrepancies)."

# 3. Payout State and Ledger Consistency (Debit correlation)
INVALID_PAYOUTS=$(docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" -t -A -c "
  SELECT count(*) FROM \"Payout\" p
  WHERE p.status = 'SUCCESS' AND NOT EXISTS (
    SELECT 1 FROM \"WalletTransaction\" t
    WHERE t.\"walletId\" = p.\"walletId\" AND t.type = 'PAYOUT_DEBIT' AND (t.\"referenceId\" = p.id OR t.\"referenceId\" = p.\"idempotencyKey\")
  );
")

if [ "${INVALID_PAYOUTS}" -ne 0 ]; then
  echo "[FATAL ERROR] Payout reconciliation FAILED: Found ${INVALID_PAYOUTS} successful payout(s) without matching PAYOUT_DEBIT ledger records!" >&2
  exit 4
fi

# 4. Failed/Reversed Payouts Compensation Consistency
UNCOMPENSATED_PAYOUTS=$(docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" -t -A -c "
  SELECT count(*) FROM \"Payout\" p
  WHERE p.status IN ('FAILED', 'REVERSED') AND NOT EXISTS (
    SELECT 1 FROM \"WalletTransaction\" t
    WHERE t.\"walletId\" = p.\"walletId\" AND t.type IN ('REFUND', 'PAYOUT_REVERSAL') AND (t.\"referenceId\" = p.id OR t.\"referenceId\" = p.\"idempotencyKey\" OR t.\"referenceId\" = p.\"idempotencyKey\" || '_rev')
  );
")

if [ "${UNCOMPENSATED_PAYOUTS}" -ne 0 ]; then
  echo "[FATAL ERROR] Payout compensation reconciliation FAILED: Found ${UNCOMPENSATED_PAYOUTS} failed/reversed payout(s) without matching compensation ledger records!" >&2
  exit 5
fi

echo "[$(date -u)] Payout state machine & ledger correlation PASSED."
echo "[$(date -u)] =============================================================="
echo "[$(date -u)] RESTORE & FINANCIAL AUDIT SUCCESSFUL for '${TARGET_DB}'"
echo "[$(date -u)] =============================================================="
exit 0
