# AWS Production Deployment Guide
## Hiralal & Sons Sales Pvt. Ltd. — Plumber & Tile Worker Rewards Platform

**Target Architecture:**
- **Infrastructure:** AWS EC2 Graviton2 (`t4g.medium`, ARM64 / Ubuntu 24.04 LTS)
- **Containerization:** Docker & Docker Compose multi-container stack
- **Reverse Proxy & Edge:** Nginx 1.25+ with Cloudflare Full (Strict) TLS Termination
- **Database:** PostgreSQL 16 Alpine with durable volume persistence
- **Cache & Message Broker:** Redis 7 Alpine
- **Storage & Offsite Backups:** Cloudflare R2 (S3-compatible Object Storage)

---

## 1. Prerequisites & AWS EC2 Provisioning

1. Launch an AWS EC2 instance:
   - **AMI:** Ubuntu 24.04 LTS (ARM64)
   - **Instance Type:** `t4g.medium` (2 vCPU, 4GB RAM)
   - **Storage:** 40GB+ gp3 EBS root volume
   - **Security Group:**
     - Port 22 (SSH) - restricted to management IPs
     - Port 80 (HTTP) - open to Cloudflare IP ranges
     - Port 443 (HTTPS) - open to Cloudflare IP ranges

2. Connect and install required packages:
   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   sudo apt-get install -y ca-certificates curl gnupg lsb-release git openssl gzip
   ```

3. Install Docker Engine & Compose plugin:
   ```bash
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   sudo chmod a+r /etc/apt/keyrings/docker.gpg
   echo \
     "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
     $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   sudo usermod -aG docker $USER
   ```

---

## 2. Repository Setup & Environment Configuration

1. Clone repository:
   ```bash
   git clone https://github.com/abraj12/hiralal.git /opt/hiralal
   cd /opt/hiralal
   ```

2. Copy production environment file:
   ```bash
   cp .env.example .env
   ```

3. Configure mandatory production environment variables in `.env`:
   - `NODE_ENV=production`
   - `POSTGRES_DB=hiralal_rewards`
   - `POSTGRES_USER=...`
   - `POSTGRES_PASSWORD=...`
   - `JWT_ACCESS_SECRET=...` (64+ character random string)
   - `JWT_REFRESH_SECRET=...` (64+ character random string)
   - `ENCRYPTION_KEY=...` (32-byte secret for app-level encryption)
   - `FIELD_ENCRYPTION_KEY=...` (64-hex-character AES-256 key)
   - `STORAGE_HMAC_SECRET=...`
   - `BACKUP_ENCRYPTION_PASSPHRASE=...` (Mandatory strong passphrase)
   - `R2_ACCESS_KEY_ID=...`, `R2_SECRET_ACCESS_KEY=...`, `R2_ENDPOINT=...`, `R2_BUCKET_NAME=...`
   - `RAZORPAYX_KEY_ID=...`, `RAZORPAYX_KEY_SECRET=...`, `RAZORPAYX_ACCOUNT_NUMBER=...`, `RAZORPAYX_WEBHOOK_SECRET=...`
   - `SIGNCARE_API_KEY=...`

---

## 3. SSL / TLS Certificate Setup (Cloudflare Origin CA)

1. In Cloudflare Dashboard, generate an Origin Certificate for `hiralal.co.in` and `*.hiralal.co.in`.
2. Save certificate files into `nginx/ssl/`:
   ```bash
   mkdir -p nginx/ssl
   nano nginx/ssl/origin.crt
   nano nginx/ssl/origin.key
   chmod 600 nginx/ssl/origin.key
   chmod 644 nginx/ssl/origin.crt
   ```
3. Run verification script:
   ```bash
   ./scripts/verify-nginx-ssl.sh ./nginx/ssl
   ```

---

## 4. Multi-Container Deployment

1. Validate Docker Compose configuration:
   ```bash
   docker compose config
   ```

2. Build and start services in background:
   ```bash
   docker compose up -d --build
   ```

3. Verify all 6 service containers are running and healthy:
   ```bash
   docker compose ps
   ```
   Services:
   - `hiralal_postgres` (PostgreSQL Database)
   - `hiralal_redis` (Redis Caching & Queue)
   - `hiralal_backend` (Express TypeScript Backend)
   - `hiralal_worker` (Background Payout & Outbox Processor)
   - `hiralal_admin` (Next.js Admin Frontend)
   - `hiralal_nginx` (Nginx TLS Reverse Proxy)

4. Run Prisma database migrations:
   ```bash
   docker compose exec backend npm run prisma:deploy
   ```

5. Seed initial administrative rules:
   ```bash
   docker compose exec backend npm run seed
   ```

---

## 5. Automated Backup & Disaster Recovery Schedule

1. Add daily cron job for encrypted offsite backups at 02:00 IST (20:30 UTC):
   ```bash
   sudo crontab -e
   ```
   Add the following entry:
   ```cron
   30 20 * * * /opt/hiralal/scripts/backup-db.sh >> /var/log/hiralal-backup.log 2>&1
   ```

2. Backup Verification Procedure:
   - Dumps database cleanly.
   - Encrypts via Authenticated AES-256-GCM.
   - Uploads to Cloudflare R2 bucket.
   - Reads back remote byte stream and verifies SHA-256 digest against local file before pruning local copies.

3. Disaster Recovery / Database Restoration:
   ```bash
   # Safe test restore into non-production database:
   ./scripts/restore-db.sh /var/backups/hiralal/hiralal_backup_20261010_020000.sql.gz.enc hiralal_test_restore

   # Authoritative production restore (requires explicit override flag):
   ./scripts/restore-db.sh /var/backups/hiralal/hiralal_backup_20261010_020000.sql.gz.enc hiralal_rewards --allow-production-overwrite
   ```

---

## 6. Health & Smoke Test Probes

Verify the deployed stack:
```bash
# HTTP Health probe (redirects to HTTPS or responds 200 OK)
curl -s http://localhost/health

# HTTPS Health probe (via Nginx TLS termination)
curl -k -s https://localhost/health

# API Endpoints
curl -k -s https://localhost/api/health
```
