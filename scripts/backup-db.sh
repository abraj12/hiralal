#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Automated Database Backup Script
# Platform: AWS EC2 t4g.medium (ARM64 / Graviton2)
# ==============================================================================
#
# RESTORE INSTRUCTIONS:
# ---------------------
# 1. Unencrypt backup file:
#    openssl enc -d -aes-256-cbc -pbkdf2 -in hiralal_backup_YYYYMMDD_HHMMSS.sql.gz.enc \
#      -out hiralal_backup.sql.gz -pass pass:"$BACKUP_ENCRYPTION_PASSPHRASE"
#
# 2. Decompress:
#    gunzip hiralal_backup.sql.gz
#
# 3. Restore to PostgreSQL:
#    docker exec -i hiralal_postgres psql -U postgres -d hiralal_rewards < hiralal_backup.sql
#
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hiralal}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_CONTAINER="${DB_CONTAINER:-hiralal_postgres}"
DB_NAME="${POSTGRES_DB:-hiralal_rewards}"
DB_USER="${POSTGRES_USER:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:-hiralal_default_backup_encryption_pass}"

mkdir -p "${BACKUP_DIR}"

RAW_BACKUP="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
ENC_BACKUP="${BACKUP_DIR}/hiralal_backup_${TIMESTAMP}.sql.gz.enc"

echo "[$(date -u)] Starting database backup for '${DB_NAME}'..."

# Dump and compress directly from PostgreSQL container
docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${RAW_BACKUP}"

# Encrypt with AES-256-CBC using PBKDF2
openssl enc -aes-256-cbc -pbkdf2 -salt -in "${RAW_BACKUP}" -out "${ENC_BACKUP}" -pass pass:"${PASSPHRASE}"
rm -f "${RAW_BACKUP}"

BACKUP_SIZE=$(ls -lh "${ENC_BACKUP}" | awk '{print $5}')
echo "[$(date -u)] Backup completed and encrypted: ${ENC_BACKUP} (${BACKUP_SIZE})"

# Prune backups older than RETENTION_DAYS
find "${BACKUP_DIR}" -name "hiralal_backup_*.sql.gz.enc" -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date -u)] Cleaned up backups older than ${RETENTION_DAYS} days."
