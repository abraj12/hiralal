# Hiralal & Sons — Hostinger KVM 2 Production Systemd & Process Management

This directory contains systemd unit definitions and configurations to ensure reliable process management and automated daily offsite database backups on the production **Hostinger KVM 2 VPS** (2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu 24.04/22.04 LTS x86_64).

---

## 1. Process Management Architecture Overview

### Option A: Docker Compose Stack Service (Recommended for Container Deployments)
- **Unit**: `hiralal-stack.service`
- **Function**: Automatically launches `docker compose up -d` on system boot after the Docker daemon is ready, and cleanly shuts down containers with `docker compose down --timeout 30` during server maintenance or shutdown.

```bash
# Install and enable stack service:
sudo cp deploy/systemd/hiralal-stack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hiralal-stack.service
sudo systemctl start hiralal-stack.service
```

### Option B: Standalone Node.js & Next.js Services
For direct host execution without containers:
- `hiralal-backend.service`: Express API (Port 5000, 1024 MB RAM limit, auto-restart on failure).
- `hiralal-worker.service`: Payout & Outbox BullMQ worker (Port 5001, 768 MB RAM limit, auto-restart).
- `hiralal-admin.service`: Next.js Admin Panel (Port 3000, 768 MB RAM limit, auto-restart).

Alternatively, PM2 process management can be used via `ecosystem.config.js`:
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

---

## 2. Automated Offsite Database Backups

### Service & Timer Units
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
   - Sets `Persistent=true` so missed backups trigger immediately upon boot.

### Configuration & Environment Variables
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

### Installation & Activation
Deploy the backup systemd units to `/etc/systemd/system/`:

```bash
# 1. Copy unit definitions
sudo cp deploy/systemd/hiralal-backup.service /etc/systemd/system/
sudo cp deploy/systemd/hiralal-backup.timer /etc/systemd/system/

# 2. Set file permissions
sudo chmod 644 /etc/systemd/system/hiralal-backup.service
sudo chmod 644 /etc/systemd/system/hiralal-backup.timer

# 3. Reload systemd daemon
sudo systemctl daemon-reload

# 4. Enable and start the timer
sudo systemctl enable hiralal-backup.timer
sudo systemctl start hiralal-backup.timer

# 5. Verify timer status
sudo systemctl list-timers --all | grep hiralal
```
