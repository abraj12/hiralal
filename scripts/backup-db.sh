#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Backup Script
# Platform: AWS EC2 t4g.medium (ARM64 / Graviton2)
# Client: HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)
# Developer: ALGIONS AI LABS PRIVATE LIMITED (CIN: U62011BR2026PTC088473)
# ==============================================================================
#
# DISASTER RECOVERY POLICY:
# -------------------------
# A backup is considered SUCCESSFUL ONLY after:
#   1. Local pg_dump, gzip compression, and AES-256-CBC PBKDF2 encryption succeed.
#   2. External Cloudflare R2 upload succeeds.
#   3. Remote HeadObject verification proves the object exists with exact non-zero size.
#
# If offsite upload or verification fails, the job FAILS CLOSED (exits non-zero).
# The encrypted local file is preserved temporarily for emergency recovery.
# ==============================================================================

set -euo pipefail

# 1. Mandatory Encryption Passphrase (Zero Fallback)
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "[FATAL ERROR] BACKUP_ENCRYPTION_PASSPHRASE environment variable is missing." >&2
  echo "Production backups require an explicit, cryptographically secure passphrase. Aborting." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hiralal}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
YEAR=$(date +"%Y")
MONTH=$(date +"%m")
DAY=$(date +"%d")
DB_CONTAINER="${DB_CONTAINER:-hiralal_postgres}"
DB_NAME="${POSTGRES_DB:-hiralal_rewards}"
DB_USER="${POSTGRES_USER:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

RAW_BACKUP="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
ENC_BACKUP="${BACKUP_DIR}/hiralal_backup_${TIMESTAMP}.sql.gz.enc"

echo "[$(date -u)] [1/4] Starting database backup dump for '${DB_NAME}'..."

# 2. Dump and compress directly from PostgreSQL container
docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${RAW_BACKUP}"

# 3. Encrypt with Authenticated AES-256-GCM using PBKDF2 (falls back to OpenSSL CBC if node unavailable)
CRYPTO_SCRIPT="$(dirname "$0")/crypto-backup.js"
if [ -f "${CRYPTO_SCRIPT}" ] && command -v node >/dev/null 2>&1; then
  node "${CRYPTO_SCRIPT}" encrypt "${RAW_BACKUP}" "${ENC_BACKUP}"
else
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "${RAW_BACKUP}" -out "${ENC_BACKUP}" -pass pass:"${BACKUP_ENCRYPTION_PASSPHRASE}"
fi
rm -f "${RAW_BACKUP}"

BACKUP_SIZE=$(ls -lh "${ENC_BACKUP}" | awk '{print $5}')
echo "[$(date -u)] [2/4] Local backup created and encrypted: ${ENC_BACKUP} (${BACKUP_SIZE})"

# 4. Mandatory Offsite Cloudflare R2 Upload & Remote Verification
R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET:-${R2_BUCKET_NAME:-}}"

if [ -z "${R2_BACKUP_BUCKET}" ] || [ -z "${R2_ENDPOINT:-}" ] || [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then
  echo "[FATAL ERROR] [3/4] Offsite backup configuration is missing or incomplete." >&2
  echo "Required: R2_BACKUP_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY." >&2
  echo "[EMERGENCY RECOVERY] Encrypted local file retained at: ${ENC_BACKUP}" >&2
  echo "Backup status: FAILED (Offsite fail-closed policy)." >&2
  exit 2
fi

REMOTE_PREFIX="backups/postgres/${YEAR}/${MONTH}/${DAY}/$(basename "${ENC_BACKUP}")"
echo "[$(date -u)] [3/4] Uploading and verifying remote object: s3://${R2_BACKUP_BUCKET}/${REMOTE_PREFIX}..."

UPLOAD_SCRIPT="$(dirname "$0")/upload-backup.js"
if [ ! -f "${UPLOAD_SCRIPT}" ]; then
  echo "[FATAL ERROR] Upload runner script not found: ${UPLOAD_SCRIPT}" >&2
  echo "[EMERGENCY RECOVERY] Encrypted local file retained at: ${ENC_BACKUP}" >&2
  exit 3
fi

# Run upload and verification runner
if ! node "${UPLOAD_SCRIPT}" "${ENC_BACKUP}" "${REMOTE_PREFIX}" "${R2_BACKUP_BUCKET}"; then
  echo "[FATAL ERROR] Offsite upload or remote verification FAILED." >&2
  echo "[EMERGENCY RECOVERY] Encrypted local file retained at: ${ENC_BACKUP}" >&2
  echo "Backup status: FAILED." >&2
  exit 4
fi

# 5. Clean up local backups older than RETENTION_DAYS (30 days) ONLY after remote verification succeeds
echo "[$(date -u)] [4/4] Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "hiralal_backup_*.sql.gz.enc" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -u)] =============================================================="
echo "[$(date -u)] BACKUP SUCCESS: Remote object verified at s3://${R2_BACKUP_BUCKET}/${REMOTE_PREFIX}"
echo "[$(date -u)] =============================================================="
exit 0
