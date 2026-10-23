# Production Deployment Guide
## Hiralal and Sons Sales Pvt. Ltd. — Platform Operations Runbook

This guide documents the production deployment architecture, prerequisites, build instructions, service orchestration, reverse proxy setup, database migration procedures, and disaster recovery runbooks.

---

## 1. Production Architecture Overview

The production platform is hosted on a **Hostinger KVM 2 VPS** running Ubuntu 24.04/22.04 LTS (x86_64).

```
                      INTERNET / CLIENTS
                              │
                    Cloudflare Edge Network
          (Full Strict TLS Termination, WAF, DDoS Protection)
                              │  HTTPS / Port 443
                              ▼
           Hostinger KVM 2 VPS (Ubuntu 24.04/22.04 LTS)
          ┌─────────────────────────────────────────────────┐
          │ Nginx Reverse Proxy (SSL Origin CA, Real-IP)    │
          │   - Port 443: Proxies to internal docker bridge │
          │   - Port 80: HTTP redirect to HTTPS             │
          └───────────────┬─────────────────┬───────────────┘
                          │                 │
             ┌────────────▼─────────┐ ┌─────▼───────────────┐
             │ Backend API (Node 22)│ │ Admin Next.js SPA   │
             │ Container :5000      │ │ Container :3000     │
             └────────────┬─────────┘ └─────────────────────┘
                          │
          ┌───────────────┴─────────────────┐
          │                                 │
┌─────────▼───────────────┐       ┌─────────▼───────────────┐
│ PostgreSQL 16 (Alpine)  │       │ Redis 7 (Alpine)        │
│ Container :5432         │       │ Container :6379         │
└─────────────────────────┘       └─────────────────────────┘
          ▲
          │ Outbox Polling & Job Leases
┌─────────┴───────────────┐
│ Background Worker       │
│ Payout & Reconciliation │
└─────────────────────────┘
```

---

## 2. Server Specifications & Memory Budget

- **Server:** Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM, 100 GB NVMe Disk).
- **Service Memory Reservations & Caps:**
  - PostgreSQL 16: Capped at 1,280 MB (`shared_buffers=512MB`, `work_mem=16MB`).
  - Backend API: Capped at 768 MB (`--max-old-space-size=512`).
  - Background Worker: Capped at 512 MB (`--max-old-space-size=384`).
  - Admin Portal: Capped at 512 MB.
  - Redis 7: Capped at 256 MB (`maxmemory 200mb`, `volatile-lru`).
  - Nginx: Capped at 128 MB.
  - Total Stack Usage: ~3.45 GB allocated, leaving ~4.5 GB headroom for OS cache, backups, and spikes.

---

## 3. Provisioning & Initial Server Hardening

1. **Run Automated Provisioning Script:**
   ```bash
   git clone https://github.com/abraj12/hiralal.git /opt/hiralal
   cd /opt/hiralal
   chmod +x scripts/*.sh
   sudo ./scripts/server-setup-kvm.sh
   ```
   *What this script configures:*
   - UFW Firewall: Defaults to `deny incoming`, opens ports 22 (SSH), 80 (HTTP), 443 (HTTPS). All backend and database ports (5432, 6379, 5000, 3000) are blocked from public WAN access.
   - Fail2ban: Hardens SSH against brute-force attempts.
   - Sysctl: SYN cookies, reverse path filtering, and IP forwarding for Docker bridge.
   - Docker & Docker Compose: Installs official engine packages.
   - Firewall Persistence: Installs `iptables-persistent` to prevent Docker from bypassing Cloudflare ingress rules across system reboots.

---

## 4. Production Deployment Workflow

### Step 1: Environment File Setup
Create and configure the production environment file:
```bash
cp .env.production.example /opt/hiralal/.env
chmod 600 /opt/hiralal/.env
```
Ensure all required secrets (database credentials, JWT secrets, encryption keys, WhatsApp Cloud API keys, RazorpayX secrets) are configured.

### Step 2: Build and Start Containers
```bash
cd /opt/hiralal
docker compose up -d --build
```

### Step 3: Execute Database Migrations
Migrations are applied idempotently using Prisma:
```bash
docker compose exec backend npx prisma migrate deploy
```

### Step 4: Verify Deployment Health
Check service container status and probe API health endpoints:
```bash
docker compose ps

# Health checks:
curl -k https://localhost/health/live
curl -k https://localhost/health/ready
```

---

## 5. Automated Backups & Disaster Recovery

### Creating an Encrypted Backup
The backup script generates an authenticated AES-256-GCM encrypted database dump and uploads it to private Cloudflare R2 storage:
```bash
export BACKUP_ENCRYPTION_PASSPHRASE="strong-cryptographic-passphrase"
./scripts/backup-db.sh
```
*Key features:*
- Uses temporary `chmod 600` `--env-file` to prevent database password exposure in process listings (`ps aux`).
- Compresses with `gzip -9` and encrypts with PBKDF2 salted AES-256-GCM.
- Automatically pushes to `backups/postgres/YYYY/MM/DD/` in Cloudflare R2.
- Local dumps older than 30 days are automatically pruned.

### Restoring from an Encrypted Backup
```bash
export BACKUP_ENCRYPTION_PASSPHRASE="strong-cryptographic-passphrase"
./scripts/restore-db.sh /path/to/backup.sql.gz.enc [TARGET_DATABASE]
```
*Safety features:*
- Takes a pre-restore safety snapshot before touching the active database.
- Runs with `set -euo pipefail`. If any restore step fails, operations halt immediately.
- Executes verification queries to ensure schema tables (`User`, `Wallet`, `_prisma_migrations`) are intact.

---

## 6. Rollback Procedures

If an issue occurs following a new deployment:
1. Trigger automated container rollback via the release rollback controller:
   ```bash
   ./scripts/deploy/rollback-release.sh <PREVIOUS_STABLE_SHA> <FAILED_CANDIDATE_SHA>
   ```
2. **Database Schema Forward-Only Policy**:
   - To preserve ledger integrity and prevent financial transaction loss, **never restore database snapshots over live production writes**.
   - Database schema changes follow an immutable, forward-only roll-forward strategy.
   - If an applied migration has breaking compatibility, `rollback-release.sh` blocks rollback and fails closed until a forward-fix migration is prepared.
3. Verify system health and queue resumption:
   ```bash
   curl -k https://localhost/health/ready
   docker compose logs -f worker
   ```
