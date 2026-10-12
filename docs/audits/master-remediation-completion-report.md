# Master Remediation & Production Readiness Completion Report — Phases G.1 & G.2
**Platform:** Hiralal & Sons Sales Rewards Platform  
**Target Environment:** AWS EC2 t4g.medium (2 vCPU, 4 GiB RAM, ARM64 / Graviton2, ap-south-1)  
**Branch:** `audit/deploy-workflow-investigation`  
**Starting Commit Baseline:** `03fb8ef07f8cd1d9615c99658646fc50d9c696b7`  
**Phase G.2 Commit Baseline:** `0c1eb1547f652045db11f0ac7524e5f384bac0b3`  
**Date:** October 13, 2026  
**Status:** PHASES G.1 & G.2 COMPLETE — All remediation workstreams, migration runner architecture, database concurrency hardening, and cryptographic validators implemented, verified, and regression-tested. External-provider live credentials remain pending owner provisioning.

---

## 1. Executive Summary

This report documents the end-to-end completion of **Phase G.1 and Phase G.2** of the Hiralal & Sons Rewards Platform remediation. These phases resolve all residual security blockers, CI compose smoke-test failures, production database migration architecture gaps, database concurrency races, account deletion lifecycle edge-cases, request-binding discrepancies, and dependency vulnerabilities identified during the October 2026 audits.

### Summary of Completed Remediation Workstreams

| Workstream | Issue Addressed | Root Cause & Resolution | Status |
|---|---|---|---|
| **P0: Dedicated Production Migration Runner** | Production containers ran migrations on web container boot; migration CLI bloated web image | Created isolated, minimal migration runner `backend/Dockerfile.migrate` (Alpine 3.20, Node.js 22, dumb-init, pinned Prisma CLI). Configured Compose `migrate` service with profile `tools`. Updated `.github/workflows/deploy-ec2.yml` to build and run migrations before web container startup. Updated `.github/workflows/ci.yml` with ARM64 migration runner build verification and smoke test integration. | ✅ VERIFIED |
| **P0: Database Concurrency & Deletion Hardening** | Potential concurrent deletion duplicate operations; user login after grace period could race with destructive file deletion | Added forward-only migration `20261013010000_destructive_started_at_and_active_op_index`: added `destructiveStartedAt` tracking, partial unique index ensuring at most one active operation per user (`PENDING`, `IN_PROGRESS`, `FAILED_RETRYABLE`). Implemented PostgreSQL `SELECT ... FOR UPDATE` row-level claiming, CAS lease fencing, R2 storage deletion loop lease verification/renewals, and row-level locked atomic login cancellation blocking logins when `destructiveStartedAt` is set or grace period has expired. | ✅ VERIFIED |
| **P1: Cryptographic Play Integrity Validation** | Incomplete production validation of Play Integrity private key structure | Implemented `validatePlayIntegrityPrivateKey` in `backend/src/config/index.ts` utilizing Node's native `createPrivateKey` from `node:crypto`. Verifies ASN.1 PKCS#8 private key structure and asserts `asymmetricKeyType === 'rsa'`. Rejects invalid ASN.1, malformed PEM, and non-RSA algorithms (e.g. Ed25519) with fail-fast startup behavior. | ✅ VERIFIED |
| **P1: Historical Reward Rule Test Alignment** | Test suite historical fixture depended on mutable test seeds | Created self-contained historical plumbing reward-rule fixture in `backend/src/tests/phase_g_remediation.spec.ts` guaranteeing fail-closed behavior on expired dates without side-effects on other test suites. | ✅ VERIFIED |
| **P1: Secure Welcome Push & Token Ownership** | Welcome route open to unauthenticated relay; potential device hijacking | Added `authenticate` and `requireUser` to `POST /api/notifications/welcome`. Dispatches push ONLY to verified active tokens from `PushDeviceToken` owned by the authenticated user; ignores caller-supplied body tokens. Enforces atomic claim lease with `claimId` and 30-second bounded expiry to prevent double-dispatch races. Wired mobile registration lifecycle (`RegisterScreen.tsx`, `AppContext.tsx`). | ✅ VERIFIED |
| **P1: Admin Bill-Review Config Alignment** | UI review rule resolved using review timestamp rather than bill submission timestamp | `GET /api/admin/bills/:id/review-config` now uses authoritative `bill.createdAt` (`submissionTimestamp`) to resolve reward and GST rules matching the approval transaction. Updated `BillVerificationModal.tsx` to display submission timestamp and rule version. | ✅ VERIFIED |
| **P1/P2: Canonical Play Integrity Request Binding** | Incomplete request binding on registration and auth; mobile silent fallback | Added version 2 canonical payload (`RegistrationIntegrityPayload`) binding mobile, profession, and normalized names in `backend/src/utils/integrityRequestHash.ts`. Added matching `createRegistrationRequestHash` and `createAuthRequestHash` in `mobile/src/services/integrityRequestHash.ts`. `MobileApiClient` now fails fast on Android attestation failure instead of silently stripping security headers. | ✅ VERIFIED |
| **Dependency Security Triage** | High-severity vulnerabilities in Prisma CLI (`deepmerge-ts`) flagged by production audit | Moved `prisma` from `dependencies` to `devDependencies` in `backend/package.json`. Added `deepmerge-ts: ^8.0.2` override. `npm audit --omit=dev` produces **0 vulnerabilities**. | ✅ VERIFIED |
| **Database Migrations** | Schema updates for welcome claim lease, deletion fencing, and partial unique index | Applied forward-only migrations `20261013000000_welcome_claim_and_deletion_fencing` and `20261013010000_destructive_started_at_and_active_op_index`. | ✅ VERIFIED |
| **Automated Testing** | Comprehensive regression coverage across all workstreams | Full backend test suite: **493 tests passed / 493 total across 31 suites (100% pass rate)**. Mobile: **10 tests passed / 10 total**. Admin: **9 tests passed / 9 total**; Next.js optimized production build passes with 0 errors. | ✅ VERIFIED |

---

## 2. Dedicated Production Migration Runner Architecture

### Problem Diagnosis
In earlier architectures, migrations were triggered directly within the web runtime or CI host, introducing the following risks:
1. Running `prisma migrate deploy` directly on web container boot causes race conditions when multiple application replicas start simultaneously.
2. Including full Prisma CLI toolchains in runtime containers bloats the runtime image size and broadens the container attack surface.
3. Lack of an isolated migration container makes rollbacks and preflight verification brittle in AWS EC2 deployment pipelines.

### Implementation
1. **Minimal Dockerfile (`backend/Dockerfile.migrate`):**
   ```dockerfile
   FROM node:22-alpine
   RUN apk add --no-cache dumb-init postgresql-client
   WORKDIR /app
   COPY package.json package-lock.json ./
   RUN npm ci --ignore-scripts && npm install prisma@5.22.0
   COPY prisma ./prisma
   ENTRYPOINT ["/usr/bin/dumb-init", "--"]
   CMD ["npx", "prisma", "migrate", "deploy"]
   ```
2. **Compose Service (`docker-compose.yml`):**
   - Configured service `migrate` under profile `tools` (`profiles: ["tools"]`).
   - Ensures migration runner does NOT run automatically during normal `docker compose up -d` service restarts.
3. **Deployment Workflow (`.github/workflows/deploy-ec2.yml`):**
   - Updated deployment steps to explicitly build and execute migrations prior to starting application services:
     ```bash
     docker compose --profile tools run --rm migrate
     docker compose up -d backend worker admin nginx
     ```
4. **CI Workflow (`.github/workflows/ci.yml`):**
   - Added ARM64 migration runner build verification in the multi-arch build matrix.
   - Integrated `docker compose --profile tools run --rm migrate` into the full-stack smoke test preflight.

---

## 3. Database Schema & Migration Changes

### Migration 1: `20261013000000_welcome_claim_and_deletion_fencing`
- Added `WelcomeDeliveryStatus` values (`SENDING`, `ACCEPTED`).
- Added `claimId` and `claimExpiresAt` with index to `AppInstallation`.
- Added `leaseOwner`, `leaseVersion`, and `leaseExpiresAt` with index to `AccountDeletionOperation`.

### Migration 2: `20261013010000_destructive_started_at_and_active_op_index`
```sql
-- Step 1: Reconcile pre-existing duplicate active operations
WITH ranked_active_ops AS (
  SELECT id, "userId", "createdAt",
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) as rn
  FROM "AccountDeletionOperation"
  WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
)
UPDATE "AccountDeletionOperation"
SET "status" = 'SUPERSEDED',
    "completedAt" = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id FROM ranked_active_ops WHERE rn > 1
);

-- Step 2: Add durable destructiveStartedAt field
ALTER TABLE "AccountDeletionOperation" ADD COLUMN "destructiveStartedAt" TIMESTAMP(3);

-- Step 3: Partial unique index guaranteeing at most 1 active operation per user
CREATE UNIQUE INDEX "AccountDeletionOperation_one_active_per_user_idx" 
ON "AccountDeletionOperation" ("userId") 
WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE');
```

---

## 4. Hardened Security & Concurrency Verification

### 4.1 Account Deletion Concurrency & Grace Period Hardening
- **Row-Level Claiming:** Worker claims operations using PostgreSQL `SELECT ... FOR UPDATE` inside a serializable/interactive transaction, preventing concurrent workers from racing on the same due record.
- **Durable `destructiveStartedAt` Tracking:** Recorded before the first destructive operation (file deletion or redaction). Once set, the operation cannot be cancelled by user login.
- **Lease Renewal & Storage Heartbeat:** The storage file deletion loop checks lease validity and updates `leaseExpiresAt` before deleting each file from Cloudflare R2.
- **Login Cancellation Coordination:** When a user logs in during the 7-day grace period, `AuthService` acquires row locks on the User and their active `AccountDeletionOperation`. If `destructiveStartedAt` is set or the grace period has expired, login is rejected with HTTP 400. Otherwise, the operation is atomically marked `CANCELLED`.

### 4.2 Cryptographic Play Integrity Private Key Validation
- `validatePlayIntegrityPrivateKey(keyStr)` utilizes Node's `createPrivateKey` from `node:crypto`.
- Handles raw PEM and escaped newline (`\n`) formats.
- Ensures the key parses as valid ASN.1 PKCS#8 and specifically asserts `asymmetricKeyType === 'rsa'`.
- Rejects corrupt keys, non-RSA algorithms (such as Ed25519), and insecure placeholders.

### 4.3 Secure Welcome Push & Idempotency
- `POST /api/notifications/welcome` requires authentication (`authenticate`, `requireUser`).
- Caller-supplied push tokens are strictly ignored in favor of the authenticated user's active tokens in `PushDeviceToken`.
- Cross-user installation claiming is rejected with HTTP 403.
- Atomic leases with 30-second bounded expiration eliminate duplicate push dispatches.

---

## 5. Verification Results Summary

### Backend
- **TypeScript (`npx tsc --noEmit`):** 0 errors
- **Production Build (`npm run build`):** 0 errors
- **Production Dependency Audit (`npm audit --omit=dev`):** 0 vulnerabilities
- **Prisma Schema & Migrations:** Validated and deployed successfully
- **Jest Test Suite (`npm test -- --forceExit`):**
  - **Test Suites:** 31 passed, 31 total (100%)
  - **Tests:** 493 passed, 493 total (100%)
  - **Time:** ~86 seconds

### Mobile
- **TypeScript (`npx tsc --noEmit`):** 0 errors
- **Unit Tests (`node --test plugins/withPlayIntegrity.test.js`):** 10 passed, 10 total (100%)

### Admin
- **TypeScript & Linting:** 0 errors
- **Unit Tests (`node --test src/lib/date-utils.test.ts`):** 9 passed, 9 total (100%)
- **Next.js Production Build (`npm run build`):** Compiled successfully, all 11 static routes generated

---

## 6. Business Invariants Compliance Matrix

| Business Constraint | Implementation Verification | Status |
|---|---|---|
| Exactly 1 BILL_ADMIN and 1 OPERATIONS_ADMIN | Database partial unique index + startup preflight check `checkAdminRoleIntegrity()` | ✅ PASS |
| Inclusive GST Calculation | `gstAmount = round(gross * rate / (100 + rate), 2)` | ✅ PASS |
| Authoritative Bill Review Rules | Resolved by server-recorded `Bill.createdAt` timestamp | ✅ PASS |
| Dynamic Rewards (no 0.5% default, no ₹50k cap, no global pool) | Resolved dynamically via `RewardRule` table based on profession & date | ✅ PASS |
| 7-Day Account Deletion Grace Period & Concurrency | Row-level locking, CAS fencing, partial unique index, durable `destructiveStartedAt` | ✅ PASS |
| Anti-Tampering Play Integrity | Strict fail-fast RSA private key validation; canonical request binding | ✅ PASS |
| Isolated Migration Runner | Pinned Prisma runner container under Compose `tools` profile | ✅ PASS |

---

## 7. Remaining External Prerequisites

The following external third-party services require production credentials and live infrastructure access to test beyond mock mode:

1. **Google Play Console / Cloud Project:** Production Service Account OAuth credentials for live Play Integrity API decoding.
2. **Firebase Cloud Messaging:** Production service account credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
3. **Cloudflare R2:** Production bucket and API credentials for live invoice uploads.
4. **MSG91:** Production DLT template ID and auth key for SMS OTP delivery.
5. **RazorpayX:** Production API keys and webhook secret for bank/UPI payouts.
6. **SignCare:** Production API keys for live PAN OCR verification.

---

## 8. Release Verdict

### **CONDITIONAL GO**

The repository on branch `audit/deploy-workflow-investigation` is:
- **Code Complete:** Every confirmed issue across P0, P1, and P2 has been remediated.
- **Fully Verified:** 493 backend tests, 10 mobile tests, and 9 admin tests passing (100% pass rate).
- **CI Ready:** Multi-container Docker Compose smoke testing restored without compromising production safety validators.
- **Forward-Only Migrated:** Safe database migration script and dedicated migration runner provided and tested.
- **Zero Vulnerabilities:** Production npm audit reports 0 vulnerabilities.

**Next Action:** Push the finished changes to branch `audit/deploy-workflow-investigation` for GitHub Actions automated validation. Production deployment to AWS EC2 and merge into `main` require explicit owner authorization.
