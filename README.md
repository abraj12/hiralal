# HIRALAL AND SONS SALES PVT. LTD.
## Plumber & Tile Worker Rewards / Incentive Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20Alpine-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4-teal.svg)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)
[![Tests](https://img.shields.io/badge/Tests-59%20Passing%20(100%25)-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Architecture-AWS%20Graviton2%20ARM64-orange.svg)]()

Production rewards and loyalty management platform engineered specifically for **HIRALAL AND SONS SALES PVT. LTD.** (CIN: U51909BR2020PTC046116) by **ALGIONS AI LABS PRIVATE LIMITED** (CIN: U62011BR2026PTC088473).

---

## 1. Architecture Overview

### Single-Company Scope
This platform is strictly **single-company** (no multi-tenancy, no `tenant_id`, no `SUPER_ADMIN`). It services exactly two trade professions:
- **Plumbers** (`PLUMBER`): Plumbing fixtures, pipes, fittings, sanitaryware.
- **Tile Installers** (`TILE_INSTALLER`): Ceramic tiles, floorings, adhesive and grout.

Rewards are strictly **cash incentives** credited to user wallets upon verified GST invoice uploads and disbursed via RazorpayX (UPI / Bank Accounts).

### System Data Flow
```
Internet
   ↓ HTTPS
Cloudflare (Full Strict TLS + DDoS Protection + WAF)
   ↓ HTTPS (Cloudflare Origin CA)
AWS EC2 t4g.medium (ap-south-1 Mumbai, Graviton2 ARM64, 4 GiB RAM)
   ↓ Port 443
Nginx Reverse Proxy (Cloudflare Real-IP Restoration, HSTS, 15MB Upload Limit)
   ↓ Internal Bridge Network (hiralal_net)
Node.js 22 Express API (Port 5000)
   ├── PostgreSQL 16 (Authoritative Financial Ledger & Schema)
   ├── Redis 7 (Sliding Window Rate Limiting & BullMQ Queue)
   └── Outbox Background Workers (Payout Worker & Reconciliation Daemon)

External Enterprise Integrations:
   ├── Cloudflare R2: Private object storage for bills (HMAC signed URL access)
   ├── SignCare: PAN tax database validation (AES-256-GCM encrypted at rest)
   ├── MSG91: SMS OTP transport (backend generates & verifies cryptographically)
   └── RazorpayX: Bank / UPI fund account validation, payouts & webhook reconciliation
```

---

## 2. Service Dependencies & Hardware Profile

- **Host Instance**: AWS EC2 `t4g.medium` (2 vCPU, 4 GiB RAM, ARM64 / Graviton2)
- **EBS Storage**: 30 GB `gp3` (3000 IOPS, 125 MB/s baseline)
- **Database**: PostgreSQL 16 (Alpine container, port 5432 bound strictly internal)
- **In-Memory Cache**: Redis 7 (Alpine container, AOF persistence enabled, maxmemory 200MB)
- **Application Runtime**: Node.js 22 LTS Alpine with `dumb-init` (PID 1 process manager)
- **Reverse Proxy**: Nginx Alpine fronting Cloudflare with published IPv4/IPv6 CIDRs

---

## 3. Memory Budget (4 GiB EC2 Profile)

To guarantee stability on the 4 GiB instance and eliminate OOM crashes:

| Service / Process | Allocation Limit | Reservation | Configuration Rationale |
|:---|:---|:---|:---|
| **PostgreSQL 16** | 1,280 MB | 512 MB | `shared_buffers=512MB`, `work_mem=16MB`, `maintenance_work_mem=128MB` |
| **Backend API** | 768 MB | 256 MB | `--max-old-space-size=512`, Express event loop |
| **Worker Daemon** | 512 MB | 128 MB | `--max-old-space-size=384`, Outbox & Reconciliation runners |
| **Admin Panel** | 512 MB | 128 MB | Next.js production SSR runtime |
| **Redis 7** | 256 MB | 64 MB | `--maxmemory 200mb`, `--maxmemory-policy noeviction` |
| **Nginx** | 128 MB | 32 MB | Event-driven reverse proxy, SSL cache |
| **Host OS & Kernel** | ~700 MB | - | Linux kernel, page cache, Docker daemon |
| **Total Stack** | **~3.45 GB** | **~1.12 GB** | **Safely below 4,096 MB physical memory** |

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

# MSG91 SMS Transport
SMS_PROVIDER=MSG91
MSG91_AUTH_KEY=msg91_auth_key
MSG91_TEMPLATE_ID=msg91_template_id
MSG91_SENDER_ID=HIRLAL

# Admin Bootstrapping
ADMIN_INITIAL_PASSWORD=STRONG_TEMPORARY_PASSWORD_FOR_SEED
CORS_ALLOWED_ORIGINS=https://admin.hiralalandsons.com
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

### 4. Execute Full Test Suite with Coverage
```bash
npm test -- --coverage
```
All **59 tests across 9 test suites** run in-band and enforce coverage thresholds:
- `auth_sessions_security.spec.ts` (OTP tokens, rotating refresh tokens, replay attack defense)
- `concurrency_financial.spec.ts` (Race-condition approvals, double-redemption prevention)
- `rewards_and_rules.spec.ts` (0.5% incentive math, pool ceiling, rejection reasons)
- `payout_safety_worker.spec.ts` (Network timeout safety, 4xx refunds, webhook deduplication)
- `kyc_and_storage.spec.ts` (Magic bytes inspection, PAN regex validation, AES-256-GCM)
- `hardening_verification.spec.ts` (SignCare adapter, MSG91 transport, state machine, ledger audit)
- `migration_scenarios.spec.ts` (Fresh DB deployment Scenario A & stability Scenario B)
- `backup_restore.spec.ts` (OpenSSL AES-256 PBKDF2 encryption/decryption integrity)
- `api_flows.spec.ts` (End-to-end API workflows)

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
3. Encrypts using AES-256-CBC with PBKDF2 salted key derivation (`openssl enc`).
4. Automatically uploads to private Cloudflare R2 prefix: `backups/postgres/YYYY/MM/DD/hiralal_backup_*.sql.gz.enc`.
5. Prunes local backups older than 30 days.

### Tested Restore Procedure
```bash
export BACKUP_ENCRYPTION_PASSPHRASE="your-cryptographic-passphrase"
./scripts/restore-db.sh /path/to/hiralal_backup_YYYYMMDD_HHMMSS.sql.gz.enc [TARGET_DB]
```
The script decrypts, decompresses, restores the SQL dump via `psql`, and executes verification queries across `User`, `Wallet`, `WalletTransaction`, `Bill`, `Payout`, and `_prisma_migrations`.

---

## 8. AWS Security Group & Network Configuration

| Port | Protocol | Source | Purpose |
|:---|:---|:---|:---|
| **443** | TCP | `0.0.0.0/0` (Cloudflare Proxy Only) | Production HTTPS ingress |
| **80** | TCP | `0.0.0.0/0` | HTTP redirect to HTTPS / ACME challenges |
| **22** | TCP | `ADMIN_OFFICE_IP/32` or AWS SSM | SSH administration (prefer AWS Session Manager) |
| **5432** | TCP | *None (Strictly Closed)* | Internal PostgreSQL container communication |
| **6379** | TCP | *None (Strictly Closed)* | Internal Redis container communication |
| **5000** | TCP | *None (Strictly Closed)* | Internal Backend container communication |
| **3000** | TCP | *None (Strictly Closed)* | Internal Admin container communication |

---

## 9. Cloudflare Configuration & SSL Setup

1. **SSL/TLS Mode**: **Full (Strict)**.
2. **Origin Certificate**: Generate Cloudflare Origin CA certificate valid for `*.hiralalandsons.com` and `hiralalandsons.com`.
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
