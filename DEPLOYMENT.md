# Production Deployment Guide — Hostinger KVM 2 VPS
## Hiralal & Sons Sales Pvt. Ltd. — Plumber & Tile Worker Rewards Platform

**Target Production Architecture:**
- **Hosting Provider & Server:** Hostinger KVM 2 VPS
- **Specifications:** 2 vCPU Cores, 8 GB RAM, 100 GB NVMe Disk, 2 TB Bandwidth
- **Operating System:** Ubuntu 24.04 LTS / 22.04 LTS (x86_64 / amd64 architecture)
- **Containerization & Process Management:** Docker Engine with Compose Plugin, systemd (`hiralal-stack.service`), and PM2 (`ecosystem.config.js`)
- **Reverse Proxy & Edge TLS:** Nginx 1.25+ with Cloudflare Full (Strict) TLS Termination or Let's Encrypt Certbot
- **Firewall & Security:** UFW (Uncomplicated Firewall) with least-privilege incoming ports, Fail2ban SSH protection, sysctl kernel hardening
- **Database:** PostgreSQL 16 Alpine with durable volume persistence
- **Cache & Message Broker:** Redis 7 Alpine
- **Storage & Offsite Backups:** Cloudflare R2 (S3-compatible Object Storage with Authenticated AES-256-GCM encrypted dumps)
- **Authentication & OTP Gateway:** Meta WhatsApp Business Platform Cloud API (Authentication Template with One-Time Passcode)

---

## 1. Hostinger KVM 2 VPS Provisioning & Hardening

1. In the Hostinger VPS Dashboard:
   - Select **KVM 2 VPS** plan (2 vCPU, 8 GB RAM).
   - Select **Ubuntu 24.04 LTS 64-bit** (or Ubuntu 22.04 LTS 64-bit).
   - Set a strong root password and provision your SSH public key.
   - Note your dedicated IPv4 address (`KVM_HOST`).

2. Connect via SSH:
   ```bash
   ssh root@<KVM_HOST>
   ```

3. Run the automated server provisioning & firewall hardening script:
   ```bash
   # Clone repository or transfer scripts
   git clone https://github.com/abraj12/hiralal.git /opt/hiralal
   cd /opt/hiralal
   chmod +x scripts/*.sh

   # Execute server setup (firewall, fail2ban, Docker, sysctl hardening)
   sudo ./scripts/server-setup-kvm.sh
   ```

   **What `server-setup-kvm.sh` configures:**
   - **UFW Firewall Hardening**:
     - `default deny incoming`, `default allow outgoing`.
     - Port 22 (SSH) allowed for remote administration.
     - Port 80 (HTTP) allowed for ACME challenges and HTTP-to-HTTPS redirect.
     - Port 443 (HTTPS) allowed for production TLS traffic.
     - Ports 5432 (Postgres), 6379 (Redis), 5000 (Backend API), and 3000 (Admin) explicitly blocked from public WAN access.
   - **Docker `DOCKER-USER` chain**: ports 80/443 accepted only from Cloudflare ranges, bound to the public interface (auto-detected from the default route, or set `EXT_IF=eth0`). The interface binding is required so container egress to RazorpayX, SignCare, Google, Meta and R2 is not dropped. After running, verify egress: `docker exec hiralal_backend node -e "fetch('https://api.razorpay.com').then(r=>console.log(r.status))"`.
   - **Fail2ban SSH Protection**:
     - Protects against brute-force attempts (`bantime = 1h`, `findtime = 10m`, `maxretry = 5`).
   - **Kernel & Sysctl Hardening**:
     - TCP SYN cookie protection against SYN floods.
     - Reverse Path Filtering against IP spoofing.
     - ICMP broadcast echo request ignoring.
     - IP forwarding enabled for Docker bridge networking.
   - **Docker & Compose**:
     - Installs Docker Engine and Compose plugin from official Docker Ubuntu repository.
   - **Automated Security Updates**:
     - Enables `unattended-upgrades`.

---

## 2. Environment Configuration

1. In `/opt/hiralal`, create your production environment configuration:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
   Or maintain an external secure configuration in `/etc/hiralal/.env` (permissions `0600`).

2. Configure mandatory production environment variables in `.env`:
   - `NODE_ENV=production`
   - `POSTGRES_DB=hiralal_rewards`
   - `POSTGRES_USER=...`
   - `POSTGRES_PASSWORD=...` (Min 32 characters, high-entropy)
   - `REDIS_PASSWORD=...` (Min 24 characters, high-entropy)
   - `JWT_ACCESS_SECRET=...` (64+ character random string: `openssl rand -hex 32`)
   - `JWT_REFRESH_SECRET=...` (64+ character random string: `openssl rand -hex 32`)
   - `JWT_ADMIN_ACCESS_SECRET=...` (64+ character random string: `openssl rand -hex 32`)
   - `BILL_ADMIN_PREFIX=BADM`, `OPERATIONS_ADMIN_PREFIX=OADM`
   - `BILL_ADMIN_MOBILE=...`, `OPERATIONS_ADMIN_MOBILE=...` (Distinct 10-digit mobile numbers)
   - `BILL_ADMIN_INITIAL_PASSWORD=...`, `OPERATIONS_ADMIN_INITIAL_PASSWORD=...` (Distinct strong temporary passwords)
   - `ENCRYPTION_KEY=...` (32-byte secret for app-level encryption)
   - `FIELD_ENCRYPTION_KEY=...` (64-hex-character AES-256 key)
   - `STORAGE_HMAC_SECRET=...` (64-hex-character HMAC key)
   - `BLIND_INDEX_SECRET=...` (64-hex-character HMAC key for searchable encrypted indexes)
   - `OTP_HMAC_SECRET=...` (64-hex-character HMAC key for OTP challenge digests)
   - `BACKUP_ENCRYPTION_PASSPHRASE=...` (Mandatory strong cryptographic passphrase)
   - `R2_ACCESS_KEY_ID=...`, `R2_SECRET_ACCESS_KEY=...`, `R2_ENDPOINT=...`, `R2_BUCKET_NAME=...`
   - `RAZORPAYX_KEY_ID=...`, `RAZORPAYX_KEY_SECRET=...`, `RAZORPAYX_ACCOUNT_NUMBER=...`, `RAZORPAYX_WEBHOOK_SECRET=...`
   - `SIGNCARE_BASE_URL=https://api.signcare.in`, `SIGNCARE_API_KEY=...`, `SIGNCARE_APP_ID=...`
   - **WhatsApp Business Platform Cloud API**:
     ```env
     OTP_PROVIDER=WHATSAPP
     WHATSAPP_API_URL=https://graph.facebook.com
     WHATSAPP_API_VERSION=v21.0
     WHATSAPP_PHONE_NUMBER_ID=<your_meta_phone_number_id>
     WHATSAPP_ACCESS_TOKEN=<your_permanent_system_user_token>
     WHATSAPP_BUSINESS_ACCOUNT_ID=<your_waba_id>
     WHATSAPP_TEMPLATE_NAME=hiralal_auth_otp
     WHATSAPP_TEMPLATE_LANGUAGE=en_US
     WHATSAPP_AUTH_BUTTON_TYPE=COPY_CODE
     ```

---

## 3. SSL / TLS Certificate Setup

### Option A: Cloudflare Origin CA (Recommended for Cloudflare Proxied Domains)
1. In Cloudflare Dashboard, generate an Origin Certificate for `hsspl.algions.in` and `*.hsspl.algions.in`.
2. Save certificate files into `/opt/hiralal/nginx/ssl/`:
   ```bash
   mkdir -p /opt/hiralal/nginx/ssl
   nano /opt/hiralal/nginx/ssl/fullchain.pem
   nano /opt/hiralal/nginx/ssl/privkey.pem
   chmod 600 /opt/hiralal/nginx/ssl/privkey.pem
   chmod 644 /opt/hiralal/nginx/ssl/fullchain.pem
   ```
3. Run verification script:
   ```bash
   ./scripts/verify-nginx-ssl.sh ./nginx/ssl
   ```

### Option B: Let's Encrypt / Certbot (Direct DNS / Non-Cloudflare)
```bash
sudo certbot certonly --standalone -d hsspl.algions.in
sudo cp /etc/letsencrypt/live/hsspl.algions.in/fullchain.pem /opt/hiralal/nginx/ssl/
sudo cp /etc/letsencrypt/live/hsspl.algions.in/privkey.pem /opt/hiralal/nginx/ssl/
```

---

## 4. Multi-Container Deployment Sequence

1. Validate Docker Compose configuration:
   ```bash
   docker compose config
   ```

2. Build application container images (targeting `linux/amd64` native Hostinger architecture):
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
   - `hiralal_redis` (Redis Caching & BullMQ Queue)
   - `hiralal_backend` (Express TypeScript Backend API)
   - `hiralal_worker` (Background Payout & Outbox Processor)
   - `hiralal_admin` (Next.js Admin Frontend)
   - `hiralal_nginx` (Nginx TLS Reverse Proxy)

8. Seed initial administrative rules and accounts (first deployment only):
   ```bash
   docker compose exec backend npm run seed
   ```
   Seeded administrators are flagged `mustChangePassword`: after OTP sign-in they can only change their password (minimum 12 characters) until they do. Once both administrators have changed their passwords, remove `BILL_ADMIN_INITIAL_PASSWORD` and `OPERATIONS_ADMIN_INITIAL_PASSWORD` from the server `.env`; the API does not need them at runtime.

---

## 5. Reliable Node.js Process Management on Ubuntu

### Option 1: Docker Compose Stack Managed via Systemd (Recommended)
Install the systemd unit `hiralal-stack.service`:
```bash
sudo cp deploy/systemd/hiralal-stack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hiralal-stack.service
sudo systemctl start hiralal-stack.service
```
This guarantees:
- Stack starts automatically on server boot after Docker daemon is online.
- Graceful shutdown (`docker compose down --timeout 30`) on server reboot or poweroff.
- Automatic restart on failure.

### Option 2: PM2 Process Manager for Standalone Node.js Processes
If running Node.js services directly on Ubuntu (without Docker):
```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```
Configured via `ecosystem.config.js`:
- `hiralal-backend`: Cluster mode across 2 vCPUs, 1024 MB memory threshold.
- `hiralal-worker`: Dedicated worker daemon, 768 MB memory threshold.
- `hiralal-admin`: Next.js production server, 768 MB memory threshold.

---

## 6. WhatsApp Business Platform Setup & Authentication Template

### 1. Meta Developer App & WhatsApp Business Account (WABA)
1. Go to [Meta for Developers](https://developers.facebook.com/) and create a Business App.
2. Add the **WhatsApp** product to your app.
3. Link your official WhatsApp Business Account (WABA) and business phone number.
4. In Meta Business Manager (`business.facebook.com`), navigate to **System Users**:
   - Create a System User with Admin permissions.
   - Assign the WhatsApp app and assign permissions:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
   - Generate a **Permanent Access Token** with no expiry.
5. In Meta Developer Portal -> WhatsApp -> **API Setup**:
   - Copy the **Phone Number ID** (e.g., `100012345678901`).
   - Copy the **WhatsApp Business Account ID** (WABA ID).

### 2. Approved Authentication Template Setup
In Meta WhatsApp Manager -> **Message Templates**, create a template with category **Authentication**:
- **Template Name**: `hiralal_auth_otp`
- **Category**: `AUTHENTICATION`
- **Languages**: `en_US` (English - US) and optional `hi` (Hindi)
- **Body Content**:
  ```text
  {{1}} is your verification code for Hiralal & Sons Rewards Platform. For security reasons, do not share this code with anyone. Valid for 5 minutes.
  ```
- **Code Expiration**: Enable 5-minute code expiration (300 seconds).
- **Buttons**: Select **Copy Code** button (`sub_type: copy_code`).
  - Button text: "Copy Code"
- Submit template for approval (Authentication templates are automatically approved within minutes).

### 3. Application Security Invariants
- **Cryptographic OTP Generation**: 6-digit cryptographically random numeric OTP generated via `crypto.randomInt()`.
- **HMAC-SHA256 Storage**: Raw OTP is never stored in plaintext; hashed using server master secret HMAC key before persistence.
- **Single-Use Invalidation**: OTP is immediately marked `isUsed = true` upon successful verification.
- **Cooldown & Rate Limiting**: 60-second cooldown per mobile number; maximum 5 verification attempts per request.
- **Zero Token Leakage**: The access token (`WHATSAPP_ACCESS_TOKEN`) is strictly redacted from all application logs and exception messages.

---

## 7. Production Hostinger KVM 2 Deployment Pipeline (`deploy-kvm.yml`)

The production deployment workflow is strictly manual (`workflow_dispatch`) and bound to the canonical GitHub Environment `production-kvm`. Automatic triggers on CI completion (`workflow_run`) are disabled.

### Required Inputs
- **`confirm_deploy`**: Must be typed exactly as `DEPLOY`.
- **`release_sha`**: Exact 40-character hexadecimal Git commit SHA.

### Required GitHub Environment Secrets (`production-kvm`)
- `KVM_HOST`: Production Hostinger KVM 2 IPv4 address or hostname.
- `KVM_USER`: Production SSH user (default `ubuntu`).
- `KVM_SSH_KEY`: Ed25519 or RSA deployment private key (OpenSSH PEM).
- `KVM_SSH_KNOWN_HOSTS`: Pinned Hostinger VPS host key fingerprint line (`ssh-keyscan -H <KVM_HOST>`).

### Pre-Deployment Safety Gates
1. **GitHub Environment Protection**: Job is bound to `production-kvm` requiring manual reviewer authorization before secrets are injected.
2. **Branch Ref Enforcement**: Deployment executes only on `refs/heads/main`.
3. **Commit Lineage & Drift Verification**: Target commit must exist on `origin/main` and match `origin/main` HEAD (`RELEASE_SHA == MAIN_HEAD`).
4. **CI Pipeline Status Verification**: Asserts `ci.yml` passed with conclusion `success` for the exact `release_sha`.
5. **Mandatory Secret Validation**: Asserts `KVM_HOST`, `KVM_SSH_KEY`, and `KVM_SSH_KNOWN_HOSTS` are configured before SSH connection.
6. **Strict Host Key Checking**: Enforces `StrictHostKeyChecking=yes` using provisioned `known_hosts`.
7. **Pre-Migration Database Backup**: Executes `scripts/backup-db.sh` before running migrations (fails closed).
8. **Isolated Migration Runner**: Builds and runs migrations via dedicated container (`docker compose --profile tools run --rm migrate`).
9. **Immutable Container Image Tagging**: Application images tagged with `${RELEASE_SHA}` (`hiralal-backend:${RELEASE_SHA}`, `hiralal-worker:${RELEASE_SHA}`, `hiralal-admin:${RELEASE_SHA}`).
10. **Deployment State Records**: Atomically writes release record to `/opt/hiralal/deployment-state/active-release.json` and archives in `/opt/hiralal/releases/${RELEASE_SHA}/release.json`.
11. **Automated Rollback Helper**: On candidate health check failure, executes `./scripts/deploy/rollback-release.sh` to evaluate migration compatibility. If safe, restores previous immutable image tags without rebuild.
12. **Forward-Only Database Invariant**: Database backups are never restored over live writes or active user sessions. All schema changes must roll forward.

---

## 8. Android Release Candidate Pipeline (`android-release-candidate.yml`)

The production Android release build executes manually on demand:
- **Trigger**: Manual only (`workflow_dispatch`).
- **Required Inputs**: `release_sha` (40-char SHA), `confirm_release: 'RELEASE'`, `build_target: 'both' | 'aab' | 'apk'`.
- **Required GitHub Secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **API Endpoint Contract**: Binds strictly to `HSSPL_PRODUCTION_API_URL=https://hsspl.algions.in/api/v1`.
- **Attestation**: Verifies signatures with `apksigner` and generates SHA-256 digests (`SHA256SUMS.txt`). Keystore material is securely erased after build.
