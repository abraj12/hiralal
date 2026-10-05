#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Restore Script
# Platform: AWS EC2 t4g.medium (ARM64 / Graviton2)
# Client: HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)
# ==============================================================================

set -euo pipefail

ENC_BACKUP="${1:-}"
TARGET_DB="${2:-${POSTGRES_DB:-hiralal_rewards}}"
DB_CONTAINER="${DB_CONTAINER:-hiralal_postgres}"
DB_USER="${POSTGRES_USER:-postgres}"

if [ -z "${ENC_BACKUP}" ]; then
  echo "Usage: $0 <path_to_backup.sql.gz.enc> [TARGET_DB_NAME]" >&2
  exit 1
fi

if [ ! -f "${ENC_BACKUP}" ]; then
  echo "[FATAL ERROR] Backup file not found: ${ENC_BACKUP}" >&2
  exit 1
fi

if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "[FATAL ERROR] BACKUP_ENCRYPTION_PASSPHRASE environment variable is required to decrypt backup." >&2
  exit 1
fi

TEMP_DIR=$(mktemp -d /tmp/hiralal_restore_XXXXXX)
trap 'rm -rf "${TEMP_DIR}"' EXIT

DEC_FILE="${TEMP_DIR}/decrypted.sql.gz"
SQL_FILE="${TEMP_DIR}/restore.sql"

echo "[$(date -u)] Decrypting AES-256 backup: ${ENC_BACKUP}..."
openssl enc -d -aes-256-cbc -pbkdf2 -in "${ENC_BACKUP}" -out "${DEC_FILE}" -pass pass:"${BACKUP_ENCRYPTION_PASSPHRASE}"

echo "[$(date -u)] Decompressing SQL dump..."
gunzip -c "${DEC_FILE}" > "${SQL_FILE}"

echo "[$(date -u)] Restoring SQL dump into database '${TARGET_DB}' in container '${DB_CONTAINER}'..."
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" < "${SQL_FILE}"

echo "[$(date -u)] Database restore completed successfully."
echo "[$(date -u)] Verifying table counts..."
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" -c "
  SELECT 
    (SELECT count(*) FROM \"User\") AS users_count,
    (SELECT count(*) FROM \"Wallet\") AS wallets_count,
    (SELECT count(*) FROM \"WalletTransaction\") AS transactions_count,
    (SELECT count(*) FROM \"Bill\") AS bills_count,
    (SELECT count(*) FROM \"Payout\") AS payouts_count,
    (SELECT count(*) FROM \"_prisma_migrations\") AS applied_migrations;
"
