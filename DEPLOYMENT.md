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
   - `JWT_ADMIN_ACCESS_SECRET=...` (64+ character random string)
   - `BILL_ADMIN_PREFIX=BADM`, `OPERATIONS_ADMIN_PREFIX=OADM`
   - `BILL_ADMIN_MOBILE=...`, `OPERATIONS_ADMIN_MOBILE=...` (Distinct 10-digit mobile numbers; demo numbers rejected)
   - `BILL_ADMIN_INITIAL_PASSWORD=...`, `OPERATIONS_ADMIN_INITIAL_PASSWORD=...` (Distinct strong temporary passwords; legacy `ADMIN_INITIAL_PASSWORD` rejected)
   - `ENCRYPTION_KEY=...` (32-byte secret for app-level encryption)
   - `FIELD_ENCRYPTION_KEY=...` (64-hex-character AES-256 key)
   - `STORAGE_HMAC_SECRET=...`
   - `BACKUP_ENCRYPTION_PASSPHRASE=...` (Mandatory strong passphrase)
   - `R2_ACCESS_KEY_ID=...`, `R2_SECRET_ACCESS_KEY=...`, `R2_ENDPOINT=...`, `R2_BUCKET_NAME=...`
   - `RAZORPAYX_KEY_ID=...`, `RAZORPAYX_KEY_SECRET=...`, `RAZORPAYX_ACCOUNT_NUMBER=...`, `RAZORPAYX_WEBHOOK_SECRET=...`
   - `SIGNCARE_API_KEY=...`, `SIGNCARE_APP_ID=...`
   - `MSG91_AUTH_KEY=...`, `MSG91_TEMPLATE_ID=...`

---

## 3. SSL / TLS Certificate Setup (Cloudflare Origin CA)

1. In Cloudflare Dashboard, generate an Origin Certificate for `hsspl.algions.in` and `*.hsspl.algions.in`.
2. Save certificate files into `nginx/ssl/`:
   ```bash
   mkdir -p nginx/ssl
   nano nginx/ssl/fullchain.pem
   nano nginx/ssl/privkey.pem
   chmod 600 nginx/ssl/privkey.pem
   chmod 644 nginx/ssl/fullchain.pem
   ```
3. Run verification script:
   ```bash
   ./scripts/verify-nginx-ssl.sh ./nginx/ssl
   ```

---

## 4. Multi-Container Deployment Sequence

1. Validate Docker Compose configuration:
   ```bash
   docker compose config
   ```

2. Build application container images:
   ```bash
   docker compose build
   ```

3. Start PostgreSQL and Redis data tier:
   ```bash
   docker compose up -d postgres redis
   ```

4. Execute Pre-Deployment Database Backup Gate:
   ```bash
   ./scripts/backup-db.sh
   ```

5. Run Prisma database migrations in an isolated container:
   ```bash
   docker compose --profile tools run --rm migrate
   ```

6. Start all application services:
   ```bash
   docker compose up -d
   ```

7. Verify all 6 service containers are running and healthy:
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

8. Seed initial administrative rules and accounts (first deployment only):
   ```bash
   docker compose exec backend npm run seed
   ```

6. Optional Legacy Admin Account Migration (Fail-Closed):
   If upgrading from legacy single `ADMIN` role schemas:
   ```bash
   # Dry-run inspection first:
   docker compose exec backend npm run admin:migrate-legacy -- --dry-run

   # Execute migration:
   docker compose exec backend npm run admin:migrate-legacy
   ```

---

## 5. Automated Backup & Disaster Recovery Schedule

1. Add daily cron job (or systemd timer) for encrypted offsite backups at 02:30 IST (21:00 UTC):
   ```bash
   sudo crontab -e
   ```
   Add the following entry (`0 21 * * *`):
   ```cron
   0 21 * * * /opt/hiralal/scripts/backup-db.sh >> /var/log/hiralal-backup.log 2>&1
   ```
   Alternatively, via systemd timer unit (`hiralal-backup.timer`):
   ```ini
   [Timer]
   OnCalendar=*-*-* 21:00:00 UTC
   Persistent=true
   ```

2. Backup Verification Procedure:
   - Dumps database cleanly via `pg_dump`.
   - Encrypts via Authenticated AES-256-GCM (`crypto-backup.js`).
   - Uploads to Cloudflare R2 bucket (`upload-backup.js`).
   - Reads back remote byte stream and verifies SHA-256 digest against local file before pruning local copies.

3. Disaster Recovery / Database Restoration:
   Usage: `./scripts/restore-db.sh <path_to_backup.sql.gz.enc> [TARGET_DB_NAME] [--allow-production-overwrite]`

   ```bash
   # Safe test restore into disposable non-production container (no overwrite flag required):
   export BACKUP_ENCRYPTION_PASSPHRASE="<SECURE_CRYPTO_PASSPHRASE>"
   export DB_CONTAINER="hiralal_test_restore"
   export POSTGRES_USER="postgres"
   ./scripts/restore-db.sh /var/backups/hiralal/hiralal_backup_TEST_TIMESTAMP.sql.gz.enc hiralal_test

   # Authoritative production restore (targets production db 'hiralal_rewards' and requires explicit overwrite flag):
   export BACKUP_ENCRYPTION_PASSPHRASE="<SECURE_CRYPTO_PASSPHRASE>"
   ./scripts/restore-db.sh /var/backups/hiralal/hiralal_backup_PRODUCTION_TIMESTAMP.sql.gz.enc hiralal_rewards --allow-production-overwrite
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

---

## 7. Production AWS Deployment Pipeline (`deploy-ec2.yml`)

The production deployment workflow is strictly manual (`workflow_dispatch`). Automatic triggers on CI completion (`workflow_run`) are disabled.

### Required Inputs
- **`confirm_deploy`**: Must be typed exactly as `DEPLOY`.
- **`release_sha`**: Exact 40-character hexadecimal Git commit SHA.

### Pre-Deployment Safety Gates
1. **Branch Ref Enforcement**: Deployment executes only on `refs/heads/main`.
2. **Commit Lineage & Drift Verification**: The target commit must exist on `origin/main` and match `origin/main` HEAD (`RELEASE_SHA == MAIN_HEAD`).
3. **CI Pipeline Status Verification**: Queries the GitHub API to assert that `ci.yml` passed with conclusion `success` for the exact `release_sha`.
4. **Mandatory Secret Validation**: Asserts `EC2_HOST`, `EC2_SSH_KEY`, and `EC2_SSH_KNOWN_HOSTS` are configured before initiating SSH.
5. **Strict Host Key Checking**: Enforces `StrictHostKeyChecking=yes` using provisioned `known_hosts`.
6. **Pre-Migration Database Backup**: Executes `scripts/backup-db.sh` before running migrations (fails closed).
7. **Isolated Migration Runner**: Builds and runs migrations via dedicated container (`docker compose --profile tools run --rm migrate`).

---

## 8. Android Release Candidate Pipeline (`android-release-candidate.yml`)

The production Android release build is decoupled from CI debug builds and executes manually on demand.

### Required Inputs
- **`release_sha`**: Exact 40-character Git commit SHA on `origin/main`.
- **`confirm_release`**: Must be typed exactly as `RELEASE`.
- **`build_target`**: `both`, `aab` (Google Play Store), or `apk` (direct test installation).

### Required GitHub Secrets
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### Build & Verification Process
1. Executes `expo prebuild --platform android --no-install --clean`.
2. Expo plugins (`withReleaseSigning.js` and `withPlayIntegrity.js`) inject reproducible signing and attestation settings into Gradle.
3. Builds signed `.aab` / `.apk` artifacts using Gradle.
4. Verifies signatures with `apksigner verify --verbose --print-certs`.
5. Generates SHA-256 digests (`SHA256SUMS.txt`) and uploads artifacts with 30-day retention.
6. Keystore file is securely shredded and deleted from the runner filesystem.
