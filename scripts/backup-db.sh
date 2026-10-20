#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Backup Script
# Platform: Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM, Ubuntu x86_64)
# Client: HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)
# Developer: ALGIONS AI LABS PRIVATE LIMITED (CIN: U62011BR2026PTC088473)
# ==============================================================================
#
# DISASTER RECOVERY POLICY:
# -------------------------
# A backup is considered SUCCESSFUL ONLY after:
#   1. Local pg_dump, gzip compression, and Authenticated AES-256-GCM PBKDF2 encryption succeed.
#   2. External Cloudflare R2 upload succeeds.
#   3. Remote HeadObject verification proves the object exists with exact non-zero size.
#
# If offsite upload or verification fails, the job FAILS CLOSED (exits non-zero).
# The encrypted local file is preserved temporarily for emergency recovery.
# ==============================================================================

set -euo pipefail

umask 077

# Auto-load production environment file if variables are not already exported in current shell
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate_env in "${SCRIPT_DIR}/../.env" "./.env" "${APP_DIR:-/opt/hiralal}/.env"; do
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] && [ -f "${candidate_env}" ]; then
    set -a
    # shellcheck disable=SC1090
    . "${candidate_env}"
    set +a
    break
  fi
done

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
chmod 700 "${BACKUP_DIR}"

RAW_BACKUP="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
ENC_BACKUP="${BACKUP_DIR}/hiralal_backup_${TIMESTAMP}.sql.gz.enc"

cleanup() {
  if [ -f "${RAW_BACKUP}" ]; then
    rm -f "${RAW_BACKUP}"
  fi
}
trap cleanup EXIT INT TERM

echo "[$(date -u)] [1/4] Starting database backup dump for '${DB_NAME}'..."

# 2. Dump and compress directly from PostgreSQL container
docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${RAW_BACKUP}"

# 3. Encrypt with Authenticated AES-256-GCM using PBKDF2 (fail closed)
CRYPTO_SCRIPT="$(dirname "$0")/crypto-backup.js"
if [ ! -f "${CRYPTO_SCRIPT}" ]; then
  echo "[FATAL ERROR] crypto-backup.js helper missing. Unauthenticated CBC fallback is prohibited." >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node "${CRYPTO_SCRIPT}" encrypt "${RAW_BACKUP}" "${ENC_BACKUP}"
else
  # Container fallback if host Node.js is not installed
  BACKEND_CONTAINER="${BACKEND_CONTAINER:-hiralal_backend}"
  docker cp "${RAW_BACKUP}" "${BACKEND_CONTAINER}:/tmp/raw_backup.sql.gz"
  docker exec -e BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}" "${BACKEND_CONTAINER}" node /app/scripts/crypto-backup.js encrypt "/tmp/raw_backup.sql.gz" "/tmp/enc_backup.sql.gz.enc"
  docker cp "${BACKEND_CONTAINER}:/tmp/enc_backup.sql.gz.enc" "${ENC_BACKUP}"
  docker exec "${BACKEND_CONTAINER}" rm -f /tmp/raw_backup.sql.gz /tmp/enc_backup.sql.gz.enc
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
if command -v node >/dev/null 2>&1; then
  if ! node "${UPLOAD_SCRIPT}" "${ENC_BACKUP}" "${REMOTE_PREFIX}" "${R2_BACKUP_BUCKET}"; then
    echo "[FATAL ERROR] Offsite upload or remote verification FAILED." >&2
    echo "[EMERGENCY RECOVERY] Encrypted local file retained at: ${ENC_BACKUP}" >&2
    echo "Backup status: FAILED." >&2
    exit 4
  fi
else
  # Container fallback if host Node.js is not installed
  BACKEND_CONTAINER="${BACKEND_CONTAINER:-hiralal_backend}"
  docker cp "${ENC_BACKUP}" "${BACKEND_CONTAINER}:/tmp/enc_backup.sql.gz.enc"
  if ! docker exec -e R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET}" -e R2_ENDPOINT="${R2_ENDPOINT}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" "${BACKEND_CONTAINER}" node /app/scripts/upload-backup.js "/tmp/enc_backup.sql.gz.enc" "${REMOTE_PREFIX}" "${R2_BACKUP_BUCKET}"; then
    docker exec "${BACKEND_CONTAINER}" rm -f /tmp/enc_backup.sql.gz.enc
    echo "[FATAL ERROR] Offsite upload or remote verification FAILED." >&2
    echo "[EMERGENCY RECOVERY] Encrypted local file retained at: ${ENC_BACKUP}" >&2
    echo "Backup status: FAILED." >&2
    exit 4
  fi
  docker exec "${BACKEND_CONTAINER}" rm -f /tmp/enc_backup.sql.gz.enc
fi

# 5. Clean up local backups older than RETENTION_DAYS (30 days) ONLY after remote verification succeeds
echo "[$(date -u)] [4/4] Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "hiralal_backup_*.sql.gz.enc" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -u)] =============================================================="
echo "[$(date -u)] BACKUP SUCCESS: Remote object verified at s3://${R2_BACKUP_BUCKET}/${REMOTE_PREFIX}"
echo "[$(date -u)] =============================================================="
exit 0
