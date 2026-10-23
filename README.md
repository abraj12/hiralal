# HIRALAL AND SONS SALES PVT. LTD.
## Plumber & Tile Worker Rewards / Incentive Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20Alpine-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4-teal.svg)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)
[![CI](https://github.com/abraj12/hiralal/actions/workflows/ci.yml/badge.svg)](https://github.com/abraj12/hiralal/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/Architecture-Hostinger%20KVM%202%20(Ubuntu%20x86__64)-blue.svg)]()

Production rewards and loyalty management platform engineered specifically for **HIRALAL AND SONS SALES PVT. LTD.** (CIN: U51909BR2020PTC046116) by **ALGIONS AI LABS PRIVATE LIMITED** (CIN: U62011BR2026PTC088473).

---

## 1. Architecture Overview

### Single-Company Scope
This platform is strictly **single-company** (no multi-tenancy, no `tenant_id`, no `SUPER_ADMIN`). It services exactly two trade professions:
- **Plumbers** (`PLUMBER`): Plumbing fixtures, pipes, fittings, sanitaryware.
- **Tile Installers** (`TILE_INSTALLER`): Ceramic tiles, floorings, adhesive and grout.

Rewards are strictly **cash incentives** credited to user wallets upon verified GST invoice uploads and disbursed via RazorpayX (UPI / Bank Accounts).
Invoice submissions are **immutable**; administrators cannot alter invoice amounts or replace receipts. Corrections require linked child revisions with secondary review escalation for significant upward deviations (>25%).

### System Data Flow
```
Internet
   ↓ HTTPS
Cloudflare (Full Strict TLS + DDoS Protection + WAF)
   ↓ HTTPS (Cloudflare Origin CA / TLS Termination)
Hostinger KVM 2 VPS (Ubuntu 24.04/22.04 LTS x86_64, 2 vCPU, 8 GiB RAM, 100 GB NVMe)
   ↓ Port 443 (UFW Firewall & Fail2ban Hardened)
Nginx Reverse Proxy (Cloudflare Real-IP Restoration, HSTS, 15MB Upload Limit)
   ↓ Internal Bridge Network (hiralal_net)
Node.js 22 Express API (Port 5000)
   ├── PostgreSQL 16 (Authoritative Financial Ledger & Schema)
   ├── Redis 7 (Sliding Window Rate Limiting & BullMQ Queue)
   └── Outbox Background Workers (Payout Worker & Reconciliation Daemon)

External Enterprise Integrations:
   ├── Cloudflare R2: Private object storage for bills (HMAC signed URL access)
   ├── SignCare: PAN tax database validation (AES-256-GCM encrypted at rest)
   ├── WhatsApp Business Platform: Cloud API OTP transport (cryptographic OTP + COPY_CODE button)
   └── RazorpayX: Bank / UPI fund account validation, payouts & webhook reconciliation
```

---

## 2. Service Dependencies & Hardware Profile

- **Host Instance**: Hostinger KVM 2 VPS (2 vCPU, 8 GiB RAM, 100 GB NVMe, Ubuntu x86_64)
- **Database**: PostgreSQL 16 (Alpine container, port 5432 bound strictly internal)
- **In-Memory Cache**: Redis 7 (Alpine container, AOF persistence enabled, maxmemory 200MB)
- **Application Runtime**: Node.js 22 LTS Alpine with `dumb-init` (PID 1 process manager)
- **Reverse Proxy**: Nginx Alpine fronting Cloudflare with published IPv4/IPv6 CIDRs
- **Process Management**: Systemd (`hiralal-stack.service`) or PM2 (`ecosystem.config.js`)
- **Firewall**: UFW hardened (least privilege: ports 22, 80, 443 only; internal services blocked)

---

## 3. Memory Budget (8 GiB Hostinger KVM 2 Profile)

With 8 GiB physical memory on Hostinger KVM 2 VPS, resource stability is maintained with generous headroom:

| Service / Process | Allocation Limit | Reservation | Configuration Rationale |
|:---|:---|:---|:---|
| **PostgreSQL 16** | 1,280 MB | 512 MB | `shared_buffers=512MB`, `work_mem=16MB`, `maintenance_work_mem=128MB` |
| **Backend API** | 768 MB | 256 MB | `--max-old-space-size=512`, Express event loop |
| **Worker Daemon** | 512 MB | 128 MB | `--max-old-space-size=384`, Outbox & Reconciliation runners |
| **Admin Panel** | 512 MB | 128 MB | Next.js production SSR runtime |
| **Redis 7** | 256 MB | 64 MB | `--maxmemory 200mb`, `--maxmemory-policy volatile-lru` |
| **Nginx** | 128 MB | 32 MB | Event-driven reverse proxy, SSL cache |
| **Host OS & Kernel** | ~700 MB | - | Linux kernel, page cache, Docker daemon |
| **Available Headroom** | **~4.6 GB** | - | Buffer for spikes, builds, and automated backups |
| **Total Stack Limit** | **~3.45 GB** | **~1.12 GB** | **Safely below 8,192 MB physical memory** |

---

## 4. Environment Variables Reference

See `.env.production.example` for the complete production template.

### Mandatory Production Variables
```env
# Database & Network
DATABASE_URL="postgresql://user:pass@postgres:5432/hiralal_rewards?schema=public"
POSTGRES_USER=hiralal_db_user
POSTGRES_PASSWORD=STRONG_RANDOM_PASSWORD_MIN_32_CHARS
REDIS_HOST=redis
REDIS_PORT=6379

# Cryptography & Security
JWT_ACCESS_SECRET=HIGH_ENTROPY_64_CHAR_SECRET
JWT_REFRESH_SECRET=HIGH_ENTROPY_64_CHAR_SECRET
ENCRYPTION_KEY=64_HEX_CHARACTERS_FOR_AES256_GCM
FIELD_ENCRYPTION_KEY=64_HEX_CHARACTERS_FOR_FIELD_DATA
STORAGE_HMAC_SECRET=64_HEX_CHARACTERS_FOR_SIGNED_URLS
BACKUP_ENCRYPTION_PASSPHRASE=STRONG_PASSPHRASE_FOR_AES256_BACKUPS

# Cloudflare R2
R2_ACCESS_KEY_ID=cf_r2_access_key
R2_SECRET_ACCESS_KEY=cf_r2_secret_key
R2_BUCKET_NAME=hiralal-invoices-private
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# SignCare KYC
SIGNCARE_BASE_URL=https://api.signcare.in
SIGNCARE_API_KEY=signcare_live_key
SIGNCARE_APP_ID=signcare_live_app_id

# RazorpayX Payouts
RAZORPAYX_KEY_ID=rzp_live_key
RAZORPAYX_KEY_SECRET=rzp_live_secret
RAZORPAYX_ACCOUNT_NUMBER=2323230041123456
RAZORPAYX_WEBHOOK_SECRET=webhook_secret_rzpx

# WhatsApp Business Platform Cloud API (Phone Verification OTP)
OTP_PROVIDER=WHATSAPP
WHATSAPP_API_URL=https://graph.facebook.com
WHATSAPP_API_VERSION=v21.0
WHATSAPP_PHONE_NUMBER_ID=100012345678901
WHATSAPP_ACCESS_TOKEN=EAAB...permanent_system_user_token
WHATSAPP_BUSINESS_ACCOUNT_ID=200012345678901
WHATSAPP_TEMPLATE_NAME=hiralal_auth_otp
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_AUTH_BUTTON_TYPE=COPY_CODE

# Admin Bootstrapping (Separate credentials required; legacy ADMIN_INITIAL_PASSWORD rejected)
BILL_ADMIN_MOBILE=REPLACE_WITH_PRODUCTION_BILL_ADMIN_10DIGIT_MOBILE
OPERATIONS_ADMIN_MOBILE=REPLACE_WITH_PRODUCTION_OPERATIONS_ADMIN_10DIGIT_MOBILE
BILL_ADMIN_INITIAL_PASSWORD=GENERATE_STRONG_TEMPORARY_BILL_ADMIN_PASSWORD
OPERATIONS_ADMIN_INITIAL_PASSWORD=GENERATE_STRONG_TEMPORARY_OPERATIONS_ADMIN_PASSWORD
CORS_ALLOWED_ORIGINS=https://hsspl.algions.in

# Firebase Cloud Messaging (FCM v1 Push Notifications)
FCM_PROJECT_ID=hiralal-rewards-prod
FCM_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"hiralal-rewards-prod",...}'

# Google Play Integrity API (Android App Attestation)
PLAY_INTEGRITY_PACKAGE_NAME=com.hiralal.rewards
PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012
```

---

## 5. Local Development & Testing

### 1. Install Dependencies
```bash
# In backend
cd backend
npm install
npx prisma generate
```

### 2. Run Database Migrations
```bash
npx prisma migrate deploy
```

### 3. Seed Initial Records
```bash
npm run seed
```

### 4. Execute Full Test Suite
```bash
npm test -- --runInBand --forceExit
```
All unit, integration, and security test suites run in-band and maintain a **100% pass rate** (949/949 tests passing across all workspaces: 848 backend, 22 admin, 47 mobile, 32 mobile-admin; 1,038 total verified tests repository-wide across 68 suites):
- `wave8_audit_remediation_regression.spec.ts` (Master Code Audit remediations: bill document presigned URL isolation, dual-control revision approval, finite positive bill amount bounds, and Zod schema alignment)
- `audit_remediation_rc1.spec.ts` (Phase 1–4 audit remediations: Play Integrity registration request hash, un-clamped deficit debt balance modeling, hard ₹50,000 per-redemption ceiling, strictly UPI/IMPS rails with zero NEFT, and centralized error middleware)
- `exact_name_matching.spec.ts` (**Mandatory exact PAN card to bank account holder name matching policy**; approved prefix stripping only, complete rejection of fuzzy, subset, swapped, or omitted names)
- `final_audit_remediation_regression.spec.ts` (Comprehensive regression suite covering findings `VERIF-01` through `VERIF-17`)
- `global_reward_cap.spec.ts` (Pool-free reward credit integrity, volume scaling, concurrent race condition approval, providerNameVerified checks)
- `config_safety.spec.ts` (Strict environment validation, admin credential segregation, demo number rejection)
- `migration_scenarios.spec.ts` (Fresh deployment, idempotent migrations, fail-closed legacy admin migration)
- `admin_api_config.spec.ts` (Secure origin resolution and URL sanitization)
- `auth_sessions_security.spec.ts` (OTP tokens, rotating refresh tokens, replay attack defense)
- `concurrency_financial.spec.ts` (Race-condition approvals, double-redemption prevention)
- `rewards_and_rules.spec.ts` (Dynamic incentive math, versioned rules, rejection reasons)
- `payout_safety_worker.spec.ts` (Network timeout safety, 4xx refunds, webhook deduplication)
- `kyc_and_storage.spec.ts` (Magic bytes inspection, PAN regex validation, AES-256-GCM)
- `hardening_verification.spec.ts` (SignCare adapter, MSG91 transport, state machine, ledger audit)
- `backup_restore.spec.ts` (OpenSSL AES-256-GCM authenticated encryption/decryption integrity)
- `pan_migration.spec.ts` (Forward-only schema migration tests)
- `payout_restore_reconciliation.spec.ts` (Reconciliation edge cases and disaster recovery integrity)
- `seed_safety.spec.ts` (Production seed safety barriers and environment checks)
- Additional business logic, security middleware, and end-to-end suites

For comprehensive documentation, see [**Documentation Index (`docs/README.md`)**](docs/README.md).

---

## 6. Production Docker Deployment

Deploy the complete multi-service stack with resource limits:

```bash
# 1. Ensure production environment file is configured
cp .env.production.example .env

# 2. Build and launch container stack
docker compose up -d --build

# 3. Verify health probes
curl -k https://localhost/health/live
curl -k https://localhost/health/ready
```

Containers launched:
- `hiralal_postgres`: PostgreSQL 16 (Alpine, resource capped to 1.28 GB)
- `hiralal_redis`: Redis 7 (Alpine, resource capped to 256 MB)
- `hiralal_backend`: Node 22 API (Alpine, non-root, resource capped to 768 MB)
- `hiralal_worker`: Background Payout & Reconciliation daemon (512 MB)
- `hiralal_admin`: Next.js Admin portal (512 MB)
- `hiralal_nginx`: Reverse proxy with SSL 443 termination (128 MB)

---

## 7. Automated Backups & Disaster Recovery

### Automated Encrypted Backup
```bash
export BACKUP_ENCRYPTION_PASSPHRASE="your-cryptographic-passphrase"
./scripts/backup-db.sh
```
1. Dumps PostgreSQL database using `pg_dump --clean --if-exists`.
2. Compresses using `gzip -9`.
3. Encrypts using AES-256-GCM with PBKDF2 salted key derivation (`openssl enc`).
4. Automatically uploads to private Cloudflare R2 prefix: `backups/postgres/YYYY/MM/DD/hiralal_backup_*.sql.gz.enc`.
5. Prunes local backups older than 30 days.

### Tested Restore Procedure
```bash
export BACKUP_ENCRYPTION_PASSPHRASE="your-cryptographic-passphrase"
./scripts/restore-db.sh /path/to/hiralal_backup_YYYYMMDD_HHMMSS.sql.gz.enc [TARGET_DB]
```
The script decrypts, decompresses, restores the SQL dump via `psql`, and executes verification queries across `User`, `Wallet`, `WalletTransaction`, `Bill`, `Payout`, and `_prisma_migrations`.

---

## 8. Hostinger VPS UFW Firewall & Network Configuration

| Port | Protocol | Source | Purpose |
|:---|:---|:---|:---|
| **443** | TCP | Cloudflare IPv4 & IPv6 CIDRs (Restricted Ingress) | Production HTTPS ingress strictly via Cloudflare Proxy (direct public ingress blocked) |
| **80** | TCP | Cloudflare IPv4 & IPv6 CIDRs | HTTP redirect to HTTPS / ACME challenges |
| **22** | TCP | `ADMIN_OFFICE_IP/32` or AWS SSM | SSH administration (prefer AWS Session Manager) |
| **5432** | TCP | *None (Strictly Closed)* | Internal PostgreSQL container communication |
| **6379** | TCP | *None (Strictly Closed)* | Internal Redis container communication |
| **5000** | TCP | *None (Strictly Closed)* | Internal Backend container communication |
| **3000** | TCP | *None (Strictly Closed)* | Internal Admin container communication |

---

## 9. Cloudflare Configuration & SSL Setup

1. **SSL/TLS Mode**: **Full (Strict)**.
2. **Origin Certificate**: Generate Cloudflare Origin CA certificate valid for `*.hsspl.algions.in` and `hsspl.algions.in`.
3. Place certificate in `/etc/nginx/ssl/fullchain.pem` and private key in `/etc/nginx/ssl/privkey.pem`.
4. **Real IP Resolution**: Nginx restores the original client IP from `CF-Connecting-IP` strictly when requests originate from Cloudflare's published IPv4 and IPv6 CIDR ranges.

---

## 10. Operational Troubleshooting

| Symptom | Probable Cause | Diagnostic Command & Fix |
|:---|:---|:---|
| **API fails on startup** | Missing mandatory env variable | Check `docker logs hiralal_backend`. Ensure all keys from `.env.production.example` are defined. |
| **Payout remains in `PROCESSING`** | Payment gateway timed out | PayoutWorker holds funds in `PROCESSING` to prevent double-spending. Reconciliation worker resolves status within 5 minutes. |
| **Upload rejected with 400** | Spoofed MIME type or magic bytes mismatch | StorageService enforces deep magic-byte inspection (`FF D8 FF` for JPG, `89 50 4E 47` for PNG, `%PDF` for PDF). |
| **Redis memory warning** | Queue accumulation | Inspect queue: `docker exec hiralal_redis redis-cli info memory`. `--maxmemory 200mb` ensures memory boundary. |

---

## 📄 Ownership & Legal Notice
**Client:** HIRALAL AND SONS SALES PVT. LTD. (CIN: U51909BR2020PTC046116)  
**Engineering:** ALGIONS AI LABS PRIVATE LIMITED (CIN: U62011BR2026PTC088473)
