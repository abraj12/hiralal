# Hiralal & Sons — Automated Database Backup Systemd Automation

This directory contains systemd unit files to automate daily offsite database backups on the production AWS EC2 instance (`t4g.medium` Graviton2 ARM64).

---

## 1. Architecture Overview

1. **Service Unit (`hiralal-backup.service`):**
   - Runs `/opt/hiralal/scripts/backup-db.sh` as a `Type=oneshot` task.
   - Dumps PostgreSQL database via `docker exec hiralal_postgres pg_dump`.
   - Compresses via `gzip -9`.
   - Encrypts via Authenticated AES-256-GCM using PBKDF2 (`scripts/crypto-backup.js`).
   - Uploads to Cloudflare R2 bucket (`scripts/upload-backup.js`).
   - Verifies remote object integrity (`HeadObject` check) before declaring success (fail closed).
   - Prunes local encrypted dumps older than 30 days.

2. **Timer Unit (`hiralal-backup.timer`):**
   - Triggers daily at 02:30 AM IST (21:00 UTC).
   - Includes `RandomizedDelaySec=300` to prevent load spikes.
   - Sets `Persistent=true` so missed backups (e.g. during maintenance or reboot) trigger immediately upon boot.

---

## 2. Configuration & Environment Variables

Place production backup credentials in `/etc/hiralal/backup.env` (permissions `0600`):

```bash
sudo mkdir -p /etc/hiralal
sudo chmod 700 /etc/hiralal

sudo tee /etc/hiralal/backup.env << 'EOF'
BACKUP_ENCRYPTION_PASSPHRASE="<SECURE_CRYPTO_PASSPHRASE>"
POSTGRES_DB="hiralal_rewards"
POSTGRES_USER="postgres"
DB_CONTAINER="hiralal_postgres"
BACKUP_DIR="/var/backups/hiralal"
RETENTION_DAYS="30"
R2_BACKUP_BUCKET="hiralal-backups-production"
R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="<R2_ACCESS_KEY_ID>"
R2_SECRET_ACCESS_KEY="<R2_SECRET_ACCESS_KEY>"
EOF

sudo chmod 600 /etc/hiralal/backup.env
```

---

## 3. Installation & Activation

Deploy the systemd units to `/etc/systemd/system/`:

```bash
# 1. Copy unit definitions
sudo cp deploy/systemd/hiralal-backup.service /etc/systemd/system/
sudo cp deploy/systemd/hiralal-backup.timer /etc/systemd/system/

# 2. Set file permissions
sudo chmod 644 /etc/systemd/system/hiralal-backup.service
sudo chmod 644 /etc/systemd/system/hiralal-backup.timer

# 3. Reload systemd manager configuration
sudo systemctl daemon-reload

# 4. Enable and start the timer
sudo systemctl enable --now hiralal-backup.timer
```

---

## 4. Verification & Operational Commands

### Check Timer Status
```bash
sudo systemctl status hiralal-backup.timer
sudo systemctl list-timers --all | grep hiralal
```

### Trigger Manual Backup Run
```bash
sudo systemctl start hiralal-backup.service
```

### Inspect Execution Status and Logs
```bash
# Check service exit status
sudo systemctl status hiralal-backup.service

# View latest 100 log lines
sudo journalctl -u hiralal-backup.service -n 100 --no-pager

# Follow live output during manual run
sudo journalctl -u hiralal-backup.service -f
```

---

## 5. Disaster Recovery & Test Restore

To verify backup restore integrity without touching production data, use `scripts/restore-db.sh` targeting a disposable container:

```bash
export BACKUP_ENCRYPTION_PASSPHRASE="<SECURE_CRYPTO_PASSPHRASE>"
export DB_CONTAINER="hiralal_test_restore"
export POSTGRES_USER="postgres"
export POSTGRES_DB="hiralal_test"

# 1. Spin up a temporary disposable PostgreSQL test container
docker run -d --name hiralal_test_restore -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=hiralal_test postgres:16-alpine

# 2. Restore the latest backup into the disposable container
./scripts/restore-db.sh /var/backups/hiralal/hiralal_backup_<TIMESTAMP>.sql.gz.enc hiralal_test

# 3. Verify row counts and integrity
docker exec -i hiralal_test_restore psql -U postgres -d hiralal_test -c "SELECT count(*) FROM \"User\";"

# 4. Tear down the test container
docker rm -f hiralal_test_restore
```
