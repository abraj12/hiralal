#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Backup Script
# Platform: AWS EC2 t4g.medium (ARM64 / Graviton2)
# Client: HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)
# Developer: ALGIONS AI LABS PRIVATE LIMITED (CIN: U62011BR2026PTC088473)
# ==============================================================================
#
# RESTORE INSTRUCTIONS:
# ---------------------
# Run the automated restore script:
#   ./scripts/restore-db.sh /path/to/hiralal_backup_YYYYMMDD_HHMMSS.sql.gz.enc [TARGET_DB]
#
# ==============================================================================

set -euo pipefail

# Mandatory Encryption Passphrase (Zero Fallback)
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

echo "[$(date -u)] Starting database backup for '${DB_NAME}'..."

# 1. Dump and compress directly from PostgreSQL container
docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${RAW_BACKUP}"

# 2. Encrypt with AES-256-CBC using PBKDF2 (salted)
openssl enc -aes-256-cbc -pbkdf2 -salt -in "${RAW_BACKUP}" -out "${ENC_BACKUP}" -pass pass:"${BACKUP_ENCRYPTION_PASSPHRASE}"
rm -f "${RAW_BACKUP}"

BACKUP_SIZE=$(ls -lh "${ENC_BACKUP}" | awk '{print $5}')
echo "[$(date -u)] Backup completed and encrypted: ${ENC_BACKUP} (${BACKUP_SIZE})"

# 3. Offsite / External Storage Sync (Cloudflare R2 or AWS S3)
R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET:-${R2_BUCKET_NAME:-}}"
if [ -n "${R2_BACKUP_BUCKET}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  REMOTE_PREFIX="backups/postgres/${YEAR}/${MONTH}/${DAY}/$(basename "${ENC_BACKUP}")"
  echo "[$(date -u)] Uploading backup to external storage: s3://${R2_BACKUP_BUCKET}/${REMOTE_PREFIX}..."
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "${ENC_BACKUP}" "s3://${R2_BACKUP_BUCKET}/${REMOTE_PREFIX}" --endpoint-url "${R2_ENDPOINT}"
    echo "[$(date -u)] External backup upload completed."
  elif [ -f "$(dirname "$0")/upload-backup.js" ]; then
    node "$(dirname "$0")/upload-backup.js" "${ENC_BACKUP}" "${REMOTE_PREFIX}" "${R2_BACKUP_BUCKET}"
    echo "[$(date -u)] External backup upload completed via Node.js runner."
  else
    echo "[WARN] Neither AWS CLI nor upload-backup.js found. Retaining encrypted backup locally."
  fi
fi

# 4. Prune local backups older than RETENTION_DAYS (30 days minimum)
find "${BACKUP_DIR}" -name "hiralal_backup_*.sql.gz.enc" -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date -u)] Cleaned up local backups older than ${RETENTION_DAYS} days."
