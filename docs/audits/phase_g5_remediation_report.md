# Phase G.5 Implementation Closure & Production Security Audit Report
## Hiralal & Sons Sales Pvt. Ltd. — Plumber & Tile Worker Rewards Platform

**Audit & Remediation Phase:** Phase G.5 (Production Security Closure, Database-Clock Consistency, Android Release Workflow Hardening, Dependency Vulnerability Remediation, and Deployment Recovery)  
**Developer:** ALGIONS AI LABS PRIVATE LIMITED  
**Working Branch:** `audit/deploy-workflow-investigation`  
**Audited Starting Commit:** `f7d4ee1e2747c5bca78e2d919727c23723199701`  
**Target Main Commit:** `b90136ccc046dbc1f3f50f3e0993cb1c21375789` (untouched)  
**Verification Status:** **REMEDIATION COMPLETE — ALL SAFETY GATES & TESTS VERIFIED**  

---

## 1. Executive Summary & Git Verification

This report provides complete engineering verification and architectural evidence for all findings resolved during Phase G.5 for the Hiralal & Sons Rewards Platform.

All release-blocking security findings have been resolved with production source code modifications, automated regression tests, CI pipeline hardening, and architectural documentation.

### Repository Verification Baseline
| Property | Value | Verification Status |
|---|---|---|
| **Repository** | `https://github.com/abraj12/hiralal` | Verified |
| **Working Branch** | `audit/deploy-workflow-investigation` | Verified (isolated; no direct merge to `main`) |
| **Base Commit (Phase G.4 Verified)** | `f7d4ee1e2747c5bca78e2d919727c23723199701` | Verified clean base |
| **Main Branch Head** | `b90136ccc046dbc1f3f50f3e0993cb1c21375789` | Intact and untouched |
| **Backend Test Suite** | 533 / 533 passed (31 test suites) | Verified 100% passing |
| **Admin Test Suite** | 9 / 9 passed (`npm test`), build passing | Verified 100% passing |
| **Workflow Safety Static Suite** | 31 / 31 passed (`test_verify_deployment_health.py`) | Verified 100% passing |
| **Production Dependency Audit** | 0 vulnerabilities (backend, migration-runner, admin) | Verified (`npm audit --omit=dev --audit-level=high`) |

---

## 2. Comprehensive Remediation Matrix

### Finding 1: Database-Clock Consistency across Deletion Lifecycle & Authentication Grace Periods (P0)
- **Problem Statement:** While worker batch processing previously adopted `clock_timestamp()`, initial deletion requests, OTP confirmations, deletion status queries, and login cancellation logic still sampled local application wall clocks (`new Date()`, `Date.now()`). In distributed multi-instance clusters, node NTP skew or misconfigured container host clocks could permit unauthorized requests during the 30-day cooldown, miscalculate the 7-day grace period, or falsely lock active accounts.
- **Root Cause:** Wall-clock sampling in Node.js runtime code in `AccountDeletionService.requestDeletion`, `AccountDeletionService.confirmDeletion`, `AccountDeletionService.getDeletionStatus`, and `AuthService.login`.
- **Implementation & Remediation:**
  1. In `backend/src/services/account-deletion.service.ts`:
     - In `requestDeletion()`, atomic transaction query evaluates `clock.now < u."lastDeletionRequestAt" + (30 * INTERVAL '1 day')` and remaining cooldown days directly in SQL via `clock_timestamp() AT TIME ZONE 'UTC'`.
     - In `confirmDeletion()`, atomic transaction samples `now` and `scheduledAt` (+7 days) together from PostgreSQL `clock_timestamp() AT TIME ZONE 'UTC'` under `User` row lock. Re-verifies state, cooldown, and active operations atomically under lock before creating `AccountDeletionOperation`.
     - In `getDeletionStatus()`, computes `isPendingDeletion`, `cooldownRemainingDays`, and `canRequestDeletion` via PostgreSQL SQL expressions.
     - In scheduled worker tasks, replaced `Date.now()` with `crypto.randomUUID()` for unique worker lease ownership and `crypto.randomBytes(4).toString('hex')` for anonymized mobile numbers.
  2. In `backend/src/services/auth.service.ts`:
     - In `login()`, `gracePeriodExpired` is derived directly within the `User` row-lock SQL query: `(u."deletionScheduledAt" IS NOT NULL AND u."deletionScheduledAt" <= clock.now)`.
     - Deletion cancellation updates `AccountDeletionOperation.completedAt` using `clock_timestamp() AT TIME ZONE 'UTC'`.
  3. **Regression Tests Added:**
     - Tests K, L, M, and N in `backend/src/tests/phase_g_remediation.spec.ts`:
       - **Test K:** Cooldown calculation is immune to ±45-day application clock skew.
       - **Test L:** 7-day grace period scheduling and `getDeletionStatus` are immune to +1 year application clock skew.
       - **Test M:** Login grace period expiration vs. cancellation strictly governed by PostgreSQL clock under clock skew.
       - **Test N:** High-concurrency `confirmDeletion` race condition: 10 concurrent requests serialize cleanly under row lock; exactly 1 operation created.

### Finding 2: Admin Next.js Security Floor Closure & Advisory Floor Guard (P0)
- **Problem Statement:** The `admin` panel was pinned to `next@14.2.35`, which was vulnerable to published security advisories (GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36, GHSA-p9j2-gv94-2wf4, GHSA-vcvr-r3jv-pc5j).
- **Remediation:**
  1. Upgraded `admin` to `next@15.5.27` (stable, maintained patched release addressing all four advisories while retaining full compatibility with `react@18.3.1`).
  2. Created `scripts/check-next-security-floor.cjs` enforcing a strict numerical semver check (`>= 15.5.24`).
  3. Integrated `check-next-security-floor.cjs`, `npm audit --omit=dev --audit-level=high`, and `npm run build` into `.github/workflows/ci.yml` under the `admin-date-tests` job.
  4. Verified `npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities** in `admin`.
  5. Verified all 9 unit tests pass and all 11 admin pages compile statically with zero errors.

### Finding 3: Android Release Candidate Workflow Hardening (P0)
- **Problem Statement:** `.github/workflows/android-release-candidate.yml` contained unescaped inline expression expansions (`${{ github.event.inputs... }}`) vulnerable to script injection, lacked GitHub Environment protection for release signing secrets, did not enforce `refs/heads/main` execution, and lacked independent APK and AAB signature verification.
- **Remediation:**
  1. Eliminated all inline script expansions in `run:` blocks by binding inputs strictly through `env:` step variables.
  2. Bound the job to protected environment `environment: android-release-signing` with read-only permissions (`contents: read, actions: read`).
  3. Enforced `refs/heads/main` execution and exact commit match: `RELEASE_SHA == MAIN_HEAD`.
  4. Implemented structured GitHub API query (`gh run list`) verifying that a successful completed `ci.yml` run exists for the exact commit SHA before any build begins.
  5. Added post-build signature verification using both `apksigner verify` (for APKs) and `jarsigner -verify` (for AABs), package name validation (`com.hiralal.rewards`), and SHA-256 manifest generation.
  6. Added guaranteed keystore shredding on runner filesystem via `shred -u` in `if: always()`.
  7. Authored operator setup documentation in `docs/security/GITHUB_ENVIRONMENT_SETUP.md`.

### Finding 4: SignCare Production URL Validation & SSRF Prevention (P0)
- **Problem Statement:** `SIGNCARE_BASE_URL` in production could theoretically be configured with internal IP addresses, deceptive subdomains, non-standard ports, URL credentials, or query strings, creating Server-Side Request Forgery (SSRF) and redirect risks.
- **Remediation:**
  1. In `backend/src/config/index.ts`, hardened `validateProductionSignCare`:
     - Mandatory HTTPS scheme.
     - Strict hostname allowlist: strictly `api.signcare.in`.
     - Comprehensive IP rejection via `node:net`'s `isIP`: blocks IPv4 loopback (`127.0.0.0/8`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), current network (`0.0.0.0/8`), multicast (`224.0.0.0/4`), broadcast (`255.255.255.255`), IPv6 loopback (`::1`), link-local (`fe80::/10`), unique-local (`fc00::/7`), and IPv4-mapped IPv6.
     - Rejects non-standard ports (must be port 443 or default).
     - Rejects URL credentials, query strings, and URL fragments.
  2. In `backend/src/services/kyc/signcare.provider.ts`, added `redirect: 'error'` to HTTP fetch options to block redirect bypasses.
  3. Verified across 10 unit tests in `backend/src/tests/config_safety.spec.ts`.

### Finding 5: Firebase Cloud Messaging (FCM) Configuration & Key Validation (P1)
- **Problem Statement:** Mode A and Mode B FCM credentials could be ambiguously mixed or partially configured in production, leading to unexpected runtime failure during push dispatch.
- **Remediation:**
  1. In `backend/src/config/index.ts`, updated `validateProductionFcm`:
     - Enforces mutual exclusivity: either complete Mode A triplet (`PROJECT_ID`, `CLIENT_EMAIL`, `PRIVATE_KEY`) OR complete Mode B service account (`SERVICE_ACCOUNT_KEY` JSON or path).
     - Rejects mixed configurations or partial triplets.
     - Validates Mode B `token_uri` against Google OAuth endpoint (`https://oauth2.googleapis.com/token`).
     - Uses `node:crypto`'s `createPrivateKey` to cryptographically validate that the private key is a valid RSA PKCS#8 key.
  2. Verified across 11 unit tests in `backend/src/tests/config_safety.spec.ts`.

### Finding 6: Deployment Rollback Recovery & Schema Preservation (P1)
- **Problem Statement:** The EC2 deployment workflow lacked explicit rollback coordination in the event of health check failure, and risk existed of applying destructive database restores over forward-only migrations.
- **Remediation:**
  1. In `.github/workflows/deploy-ec2.yml`:
     - Captures `PREVIOUS_SHA` from running containers before updating.
     - Retains previous immutable container image tags (`:prev-${PREVIOUS_SHA}`).
     - In the deployment health gate, if `verify-deployment-health.py` fails, rolls back application containers (`backend`, `admin`, `worker`, `nginx`) to previous immutable images.
     - Strictly preserves forward-only database schema; prohibits destructive database restores over live writes.
  2. Verified static workflow safety via `scripts/test_verify_deployment_health.py` (31/31 tests passing).

---

## 3. Verification Test Evidence Summary

### Suite 1: Full Backend Test Execution
```
Test Suites: 31 passed, 31 total
Tests:       533 passed, 533 total
Snapshots:   0 total
Time:        145.6s
```
Includes:
- `phase_g_remediation.spec.ts`: 50/50 tests passed (Tests A through N)
- `config_safety.spec.ts`: 49/49 tests passed
- `fcm_provider.spec.ts`: 11/11 tests passed
- `account_deletion_and_threshold.spec.ts`: 11/11 tests passed
- All financial, ledger, KYC, and authentication test suites: 100% passing

### Suite 2: Admin Panel Verification
- TypeScript compilation: `npx tsc --noEmit` — 0 errors
- Next.js Security Floor Guard: `node scripts/check-next-security-floor.cjs` — PASSED (15.5.27 >= 15.5.24)
- Production Dependency Audit: `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities
- Unit tests: `npm test` — 9/9 passed
- Production build: `npm run build` — 11/11 static pages generated successfully

### Suite 3: Static Workflow Safety Suite
- Script: `python scripts/test_verify_deployment_health.py` — 31/31 passed
- YAML Syntax: `ci.yml`, `deploy-ec2.yml`, `android-release-candidate.yml` — 100% valid YAML

---

## 4. Release Readiness Conclusion

All Phase G.5 requirements have been completely implemented, verified, and locked in the repository. The working branch `audit/deploy-workflow-investigation` is fully prepared for final review and pull request creation to `main`.
