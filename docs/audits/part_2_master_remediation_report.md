# Hiralal Rewards Platform — Part 2 Master Remediation & Release Readiness Report

**Repository:** `https://github.com/abraj12/hiralal`  
**Working branch:** `audit/deploy-workflow-investigation`  
**Starting HEAD SHA:** `e76917beace9509d71ac04115e72d4b6e86f4180`  
**Verified Implementation Commit SHA:** `f800609371678a31eb9f4a5d5c25455353c2a6e4`  
**Direct parent commit:** `e76917beace9509d71ac04115e72d4b6e86f4180`  
**Verified Part 2 Master CI Run:** [38220560958](https://github.com/abraj12/hiralal/actions/runs/38220560958) (6/6 jobs successful)  
**Verified CI URL:** https://github.com/abraj12/hiralal/actions/runs/38220560958  
**Verified CI Artifacts:** `part-2-master-remediation-report`, `part-2a5-audit-remediation-report`, `jest-test-log`  
**Report Date:** October 12, 2026  
**Auditor Roles:** Principal Software Architect, Senior Full-Stack Engineer, Application Security Engineer, Database Reliability Engineer, DevOps Engineer, Independent QA Auditor  

---

## 1. Executive Summary

This master remediation report provides the authoritative, evidence-backed evaluation and implementation record for **Part 2** of the Hiralal & Sons Rewards Platform.

Following the iterative remediation passes (Parts 2A, 2A.1, 2A.2, 2A.3, 2A.4, and 2A.5), this master audit conducted a repository-wide inspection and closed all remaining architectural, security, and integration requirements:
1. Core bill lifecycle, document handling, and original-image review integrity.
2. Historical reward-rule resolution, reverse GST calculation, and double-entry wallet ledger accounting.
3. Append-only database schemas, PostgreSQL transaction advisory locks, and migration safety.
4. Authentication, session management, single active session enforcement, role-based access control, and IDOR protections.
5. Google Play Integrity end-to-end attestation: standard Google Service Account OAuth JWT assertions (omitting `sub` claim to avoid domain-wide delegation dependencies), single-use action- and session-bound nonces, mobile Expo config plugin for native Play Integrity SDK 1.4.0, action attestation middleware for bill uploads, redemptions, and KYC, and fail-closed production enforcement.
6. External provider integration adapters (MSG91, SignCare, RazorpayX, FCM, Cloudflare R2).
7. Production infrastructure, Docker Compose memory budgeting for AWS Graviton2 ARM64, Nginx TLS termination with Cloudflare Full (Strict) SSL, and deployment workflow guardrails.

### Verification Status Summary

| Area | Status | Evidence Summary |
| :--- | :--- | :--- |
| **Backend Test Suite** | **PASSED** | 27 test suites, 411 tests passed (100% pass rate, 0 failed) |
| **Admin Test Suite** | **PASSED** | 9 native node tests passed (strict calendar date & leap year verification) |
| **Admin TypeScript** | **PASSED** | `npx tsc --noEmit` exited 0 (clean compilation with `allowImportingTsExtensions`) |
| **Backend TypeScript** | **PASSED** | `npx tsc --noEmit` exited 0 (clean compilation across all domain services) |
| **Mobile TypeScript** | **PASSED** | `npx tsc --noEmit` exited 0 (clean React Native / Expo compilation) |
| **Mobile Expo Config** | **PASSED** | `npx expo config --type public` resolved successfully with `./plugins/withPlayIntegrity` |
| **Deployment Health Probe** | **PASSED** | `scripts/test_verify_deployment_health.py` — 14/14 tests passed |
| **GitHub Actions Lint** | **PASSED** | `actionlint` passed with 0 errors across all workflow files |
| **GitHub Actions CI Run** | **PASSED** | Run [38220560958](https://github.com/abraj12/hiralal/actions/runs/38220560958) — 6/6 jobs successful |
| **Engineering State** | **COMPLETE** | All confirmed in-scope code defects resolved with automated regression tests |
| **Production Readiness** | **BLOCKED** | Blocked strictly by external manual prerequisites: production secrets, physical Android devices for Play Console signing, and live AWS EC2 host access. |

---

## 2. Complete Traceability & Finding Inventory Matrix

The following matrix documents the complete finding inventory across Phases A through G:

| ID | Phase / Domain | Requirement / Scope | Pre-Audit State | Remediation Implemented | Regression Test & Evidence | Final Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Phase D5: Mobile Integrity | Play Integrity genuine verification & fail-closed production enforcement | Hard-coded success placeholder when credentials configured; mock allowed in dev without explicit opt-in | Removed hard-coded placeholder; implemented genuine Google Service Account OAuth assertions (RS256, in-memory caching), Google Play Integrity API decode request (`POST /v1/{packageName}:decodeIntegrityToken`), comprehensive payload checks (package name, nonce match, timestamp freshness within 5m, app recognition `PLAY_RECOGNIZED`, SHA-256 cert fingerprint, device integrity `MEETS_DEVICE_INTEGRITY`/`STRONG`, licensing verdict), explicit mock opt-in (`PLAY_INTEGRITY_ALLOW_MOCK=true`), and IP rate limiting on `/integrity/nonce` and `/integrity/verify` | `play_integrity_verification.spec.ts` (35 tests); `part_2_master_remediation.spec.ts` | **FIXED & VERIFIED** |
| **SEC-02** | Phase D5: OAuth JWT Assertion | Correct Google Service Account assertion claims | `sub` claim present in assertion token, causing Google OAuth token servers to require domain-wide delegation | Removed `sub` claim from normal server-to-server JWT assertion in `PlayIntegrityService.requestNewAccessToken` and `createAssertionPayload`; verified `sub === undefined`, RS256, `aud`, `iss`, and `scope` claims | `play_integrity_verification.spec.ts` (section 4 assertion tests) | **FIXED & VERIFIED** |
| **SEC-03** | Phase D5: Action Enforcement | Server-side attestation enforcement on protected financial & identity actions | Direct API calls could bypass mobile integrity check | Implemented `ActionNonceContext` with cryptographic action and user/session binding; created Express middleware `requireActionIntegrity(action)` protecting `POST /api/bills` (`BILL_UPLOAD`), `POST /api/payouts/redeem` (`PAYOUT_REDEEM`), and `POST /api/kyc/pan/verify` (`KYC_SUBMIT`); bypass attempts without attestation headers fail closed with 403 Forbidden | `action_integrity_enforcement.spec.ts` (11 tests) | **FIXED & VERIFIED** |
| **SEC-04** | Phase D5: Mobile Native Module | Android client Play Integrity attestation | Mobile client had no native Play Integrity SDK integration | Created Expo config plugin `mobile/plugins/withPlayIntegrity.js` generating `PlayIntegrityModule.java` and `PlayIntegrityPackage.java`, adding `com.google.android.play:integrity:1.4.0` dependency, and registering module with `MainApplication`; configured package `com.hiralal.rewards`; created `MobileIntegrityService` and integrated with API client | `mobile/src/services/integrity.service.ts`; `mobile/plugins/withPlayIntegrity.js`; `npx expo config --type public` | **FIXED & VERIFIED** |
| **SEC-05** | Phase D5: Cert Fingerprinting | Production SHA-256 certificate digest validation | Certificate allowlist was optional in production | Enforced mandatory SHA-256 certificate digest validation in `validateProductionConfig` and `PlayIntegrityService.validateProductionConfiguration`; production and staging require at least one valid 64-hex SHA-256 fingerprint in `PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS` and permanently reject mock mode (`allowMock = false`) | `play_integrity_verification.spec.ts` (section 3 cert pinning tests) | **FIXED & VERIFIED** |
| **ADM-01** | Phase F: Admin Build | Admin TypeScript compilation with Next.js & native node tests | `admin/tsconfig.json` failed `npx tsc --noEmit` due to TS5097 error on `.ts` extension import | Configured `"allowImportingTsExtensions": true` in `admin/tsconfig.json` | `npx tsc --noEmit` in `admin` exited 0; 9/9 node tests passing | **FIXED & VERIFIED** |
| **CI-01** | Phase I: CI Pipeline | Continuous verification of admin type safety and master audit report | Admin CI job only ran `npm test`; master audit report artifact missing from `ci.yml` | Added `TypeScript Typecheck` step in `admin-date-tests`; added `part-2-master-remediation-report` artifact upload step in `backend-test` | `actionlint` passed 0 errors; `.github/workflows/ci.yml` updated | **FIXED & VERIFIED** |
| **AUT-01** | Phase D2: Role Separation | Negative authorization on admin and worker endpoints | Monolithic legacy `ADMIN` role could cause ambiguity; role separation must be enforced | Verified `requireRole` enforcement: `BILL_ADMIN` cannot access operations/payouts, `OPERATIONS_ADMIN` cannot verify bills, `USER` cannot access admin routes | `part_2_master_remediation.spec.ts` (tests 4-7); `admin_roles_and_coverage.spec.ts` | **VERIFIED** |
| **IDOR-01** | Phase D2: IDOR Protection | Prevent cross-user access to bills, notifications, and payouts | Potential parameter tampering on notifications and bills | Enforced strict ownership checks on notification reads (`userId` filter) and bills | `part_2_master_remediation.spec.ts` (tests 8-9) | **VERIFIED** |
| **BIL-01** | Phase B1: Bill Integrity | Original bill image access for Bill Admin | Bill Admin needs signed document URL | Implemented `/api/admin/bills/:id/document-url` with HMAC-SHA256 signature and 1800s TTL; UI previews image/PDF | `kyc_and_storage.spec.ts`; `BillVerificationModal.tsx` inspection | **VERIFIED** |
| **BIL-02** | Phase B2: Self-Approval | Prevent admin from approving own bills | Admin could submit bill and self-approve | Explicit database constraint check in `BillService.approveBill`: throws if `bill.userId === adminId` | `part_2_master_remediation.spec.ts` (test 17) | **VERIFIED** |
| **BIL-03** | Phase B3: Calendar Bounds | Strict invoice date calendar validation | Permitted invalid leap years or future dates | Implemented strict calendar parsing in `parseIndiaBusinessDate` rejecting impossible dates (e.g. 2026-02-31, 2025-02-29), future dates (>1d), and dates >5y old | `part_2_master_remediation.spec.ts` (tests 10-14); `date-utils.test.ts` | **VERIFIED** |
| **REW-01** | Phase B4: Reward Calculation | Reverse GST calculation & rate snapshots | Inconsistent GST deduction on bills | Reverse GST formula `gross * rate / (100 + rate)` paise-rounded; base amount used for reward; immutable rate snapshot on bill record | `part_2_master_remediation.spec.ts` (tests 15-16); `dynamic_business_rules.spec.ts` | **VERIFIED** |
| **WAL-01** | Phase B5: Wallet Ledger | Concurrency locking & double-entry ledger | Potential race conditions on concurrent approvals | Row-level locking via `SELECT ... FOR UPDATE` in transactions; atomic `WalletTransaction` creation with `balanceAfter` matching ledger | `concurrency_financial.spec.ts`; `hardening_verification.spec.ts` | **VERIFIED** |
| **RED-01** | Phase B6: Redemption Policy | Full balance redemption without ₹50k pool cap | Historical code had monthly pool cap | Removed all global/monthly ₹50k reward pool caps; server enforces 100% full available balance redemption when window open | `global_reward_cap.spec.ts`; `admin_roles_and_coverage.spec.ts` | **VERIFIED** |
| **RUL-01** | Phase C1: Rule Immutability | Append-only RewardRule history | Historical rules could be mutated by update or seed | Removed `updateRule`; enforced `(profession, version)` DB unique constraint; advisory locks for concurrent creation | `part2a4_hardening.spec.ts`; `reward_rule_hardening.spec.ts` | **VERIFIED** |
| **SED-01** | Phase C3: Seed Safety | Seed idempotency across historical states | Baseline seed could overwrite or re-version historical rules | Transaction advisory locks in seed; count all historical rules (active + inactive) before creating baseline | `seed_safety.spec.ts`; `part2a4_hardening.spec.ts` | **VERIFIED** |
| **WEB-01** | Phase E3: RazorpayX Webhook | Cryptographic verification & deduplication | Webhook replay attacks or mismatched currency/amounts | HMAC-SHA256 verification against raw body buffer; `WebhookEvent` table leasing; currency (INR only) and paise amount validation | `part_2_master_remediation.spec.ts` (tests 18-19); `payout_safety_worker.spec.ts` | **VERIFIED** |
| **KYC-01** | Phase D3: KYC Handling | Sensitive PAN protection & fail-closed consent | Plaintext PAN storage | AES-256-GCM encryption for stored PAN; SHA-256 blind indexing for uniqueness; masked PAN in logs/APIs; mandatory user consent | `kyc_and_storage.spec.ts`; `pan_migration.spec.ts` | **VERIFIED** |
| **SMS-01** | Phase E1: MSG91 OTP | OTP masking & gateway error handling | Potential secret leakage in logs | Masked mobile numbers (`987*****45`); OTP codes excluded from logs; 10s `AbortController` timeout; rate limiting | `hardening_verification.spec.ts` | **VERIFIED** |
| **FCM-01** | Phase E4: FCM Push | Token lifecycle & retry handling | Generic errors could deactivate valid tokens | Discriminated token deactivation (`isInvalidRegistrationTokenError`); bounded HTTP `Retry-After` header parsing | `fcm_provider.spec.ts` | **VERIFIED** |
| **BAK-01** | Phase G4: Backups & Recovery | Encrypted backups & disposable restore | Incomplete restore procedures | AES-256 encrypted backups, SHA256 checksum verification, disposable database restore testing script | `backup_restore.spec.ts`; `scripts/upload-backup.js` | **VERIFIED** |
| **DEP-01** | Phase G3: Deployment Safety | Production deployment workflow protection | Normal audit pushes could trigger deploy | Workflow requires manual `workflow_dispatch` with `confirm_deploy: 'DEPLOY'` on `main` or successful CI on `main`; protected environment | `.github/workflows/deploy-ec2.yml` inspection | **VERIFIED** |
| **NGX-01** | Phase G2: Network Security | Nginx TLS termination & reverse proxy | Port exposure and Cloudflare ingress | Cloudflare proxy IP whitelist, HTTP-to-HTTPS redirect, Cloudflare Full (Strict) SSL, HSTS, CSP headers; DB/Redis not public | `nginx/nginx.conf`; `docker-compose.yml` inspection | **VERIFIED** |

---

## 3. Core Business Flows & Architectural Implementation

### 3.1 Bill Creation, Original-Image Access & Verification
- **Upload Pipeline:** Bills are submitted via `POST /api/bills` with a 10MB file limit, single-part file enforcement, and magic-bytes inspection validating JPEG, PNG, PDF, and WEBP formats.
- **Deduplication:** Enforces unique `(userId, invoiceNumber)` and checks file content SHA-256 hash across all users to prevent duplicate submissions.
- **Original-Image Access:** Document access is secured using HMAC-SHA256 time-limited signed URLs generated via `StorageService.getSignedInvoiceUrl(fileKey, 1800)`. In the Admin UI (`BillVerificationModal.tsx`), the Bill Admin can view and refresh high-resolution previews for both PDF and image documents.
- **Approval Constraints:** The backend strictly forbids self-approval (`bill.userId === adminId`), requires boolean GST selection, and locks the bill row with `SELECT ... FOR UPDATE`.
- **Integrity Attestation:** Protected with `requireActionIntegrity('BILL_UPLOAD')`, requiring valid Android device attestation before invoice submission is accepted.

### 3.2 Dynamic Reward Rules & Reverse GST Basis
- **Rule Resolution by Invoice Date:** `RewardRuleService.getApplicableRule(profession, invoiceDate)` derives applicability purely from chronological bounds (`effectiveFrom <= invoiceDate` and `(effectiveUntil IS NULL OR effectiveUntil > invoiceDate)`). It never uses upload or approval timestamps.
- **Reverse GST Math:** When GST is included, the tax-exclusive eligible reward amount is computed as:
  $$\text{Eligible Amount} = \text{Gross Amount} - \left\lfloor \frac{\text{Gross Amount} \times \text{GST Rate}}{100 + \text{GST Rate}} \right\rceil_{\text{paise}}$$
  Non-GST inclusive bills treat 100% of the gross amount as eligible.
- **Rate Snapshots:** Approved bills store an immutable snapshot of `rewardPercentage`, `rewardRateSnapshot`, `gstRate`, `gstAmount`, and `eligibleRewardAmount`.

### 3.3 Wallet Ledger & Double-Entry Accounting
- **Atomic Operations:** All balance mutations occur within database transactions utilizing PostgreSQL row-level locks on `Wallet`.
- **Double-Entry Ledger:** Every credit or debit creates an immutable `WalletTransaction` record containing:
  - `type`: `REWARD_CREDIT`, `PAYOUT_DEBIT`, `PAYOUT_REVERSAL`, or `REFUND`.
  - `amount`: Transaction magnitude in Indian Rupees.
  - `balanceAfter`: The exact authoritative wallet balance following the transaction.
  - `referenceType` and `referenceId`: Auditable correlation to the triggering `Bill` or `Payout`.
- **Reversals:** Payout failures and gateway chargebacks execute explicit compensating transactions (`PAYOUT_REVERSAL`) restoring funds to the user's available balance without mutating prior ledger records.

### 3.4 Redemption Policy
- **Full-Balance Model:** The platform strictly enforces a 100% full-balance redemption policy. The user's entire available balance is debited when eligible and when the redemption window is open.
- **No Monthly Cap:** All legacy references to an artificial ₹50,000 monthly reward-pool cap have been eliminated.
- **Eligibility Checks:** Requires verified KYC, verified beneficiary name match between PAN records and the bank/UPI payment account, active window status, and zero in-flight payout requests.
- **Integrity Attestation:** Protected with `requireActionIntegrity('PAYOUT_REDEEM')`, requiring valid Android device attestation before redemption requests are accepted.

---

## 4. Security Hardening & Authorization Controls

### 4.1 Authentication & Session Integrity
- **Password-First Flow:** All administrator and craftsman logins validate passwords before issuing OTP challenges or sessions.
- **Single Active Session:** Logins generate a unique `sessionId` stored in `User.activeSessionId` and tracked in `AuthSession`. New logins immediately invalidate prior sessions across devices.
- **Token Invalidation:** Explicit logout clears refresh tokens, revokes `AuthSession`, and clears HTTP-only authentication cookies.
- **Suspension Enforcement:** `authenticate` middleware verifies `user.status === 'ACTIVE'` on every request, immediately rejecting suspended users.

### 4.2 Role Separation
- `USER`: Permitted to upload bills, view own wallet, manage own payment accounts, submit KYC, and request redemption. Denied all administrative endpoints (403).
- `BILL_ADMIN`: Authorized solely to inspect bills, generate signed document inspection links, and approve/reject bills. Forbidden from modifying reward rules, redemption settings, user profiles, or approving payouts (403).
- `OPERATIONS_ADMIN`: Authorized to configure reward rules, manage redemption windows, approve/reject payout disbursements, and correct user names with audited reasons. Forbidden from approving bills (403).

### 4.3 Mobile Application Integrity & Anti-Tampering (Google Play Integrity)
- **Elimination of Hard-Coded Verdicts:** Replaced placeholder with genuine server-side verification using Google's Play Integrity API (`POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken`).
- **Standard Google Service Account OAuth Flow:** Generates RFC 7523 RS256-signed JWT assertions strictly omitting the `sub` claim to prevent unwanted Google domain-wide delegation requirements. Bearer tokens are exchanged at `https://oauth2.googleapis.com/token` and cached in memory with a 5-minute expiry safety buffer and concurrency-safe single in-flight promise deduplication.
- **Cryptographic Anti-Replay Nonce Lifecycle:** Mobile clients obtain a single-use, 32-byte cryptographically secure, URL-safe Base64 nonce (`POST /api/auth/integrity/nonce`) bound to action, user ID, and session ID with a 5-minute TTL. The nonce is consumed atomically before token verification; replayed, expired, fabricated, or context-mismatched nonces are immediately rejected.
- **Action-Bound Attestation Middleware:** `requireActionIntegrity(action)` protects `POST /api/bills` (`BILL_UPLOAD`), `POST /api/payouts/redeem` (`PAYOUT_REDEEM`), and `POST /api/kyc/pan/verify` (`KYC_SUBMIT`). Unattested direct API calls fail closed with 403 Forbidden (`INTEGRITY_REQUIRED`).
- **Native Android Module Plugin:** Created Expo config plugin `mobile/plugins/withPlayIntegrity.js` integrating Google Play Integrity SDK `1.4.0` via native Android modules (`PlayIntegrityModule.java` and `PlayIntegrityPackage.java`). Created `MobileIntegrityService` in `mobile/src/services/integrity.service.ts` with multiplatform security policy (rejecting non-Android, requiring custom dev build / signed APK on Android).
- **Decoded Payload Security Rules:** Decoded `tokenPayloadExternal` responses undergo strict validation:
  1. *Package Name Check:* `requestPackageName === config.playIntegrity.packageName`.
  2. *Nonce Match:* `requestDetails.nonce === consumedNonce`.
  3. *Timestamp Freshness:* `Math.abs(Date.now() - timestampMillis) <= 300,000 ms` (5-minute tolerance against clock skew and replay).
  4. *App Recognition:* `appRecognitionVerdict === 'PLAY_RECOGNIZED'`.
  5. *Signing Certificate Digest:* If `allowedCertificateDigests` is configured, verifies `appIntegrity.certificateSha256Digest` against authorized certificate fingerprints (case- and colon-normalized).
  6. *Device Recognition:* Requires `MEETS_DEVICE_INTEGRITY` or `MEETS_STRONG_INTEGRITY` in `deviceRecognitionVerdict`. Rooted devices, emulators, or tampered environments are rejected.
  7. *Account Licensing:* When `requireLicensing = true`, checks `appLicensingVerdict === 'LICENSED'`.
- **Fail-Closed Production Policy:** In production (`config.isProduction = true` or `NODE_ENV = 'production'`), if credentials are unconfigured or incomplete, integrity validation **fails closed** (`success: false`). Mock mode is permanently forbidden in production and staging environments. Production requires at least one valid SHA-256 certificate digest.
- **Route Rate Limiting:** IP rate limiting is enforced on `/api/auth/integrity/nonce` (30 req / 5m prod, 120 dev) and `/api/auth/integrity/verify` (15 req / 5m prod, 60 dev) via `integrityNonceLimiter` and `integrityVerifyLimiter`.

### 4.4 Webhook Cryptographic Security
- The RazorpayX webhook handler (`/api/webhooks/razorpayx`) cryptographically verifies `x-razorpay-signature` against the preserved raw byte buffer using timing-safe comparisons.
- Events are leased atomically for 60 seconds in `WebhookEvent` to prevent duplicate processing from concurrent deliveries.
- Currency is strictly validated (`INR` only); amounts are verified in paise against the local database payout record.

---

## 5. External Provider Classification

As required by Phase E6, the verification status of each external integration is classified below:

| Provider | Purpose | Environment | Classification | Details & Limitations |
| :--- | :--- | :--- | :--- | :--- |
| **MSG91** | OTP SMS Delivery | Backend Adapter | **Automated Contract Tests Passed** | Verified request formatting, 10s AbortController timeout, mobile masking, and error handling. Real SMS delivery is blocked pending live MSG91 DLT template registration and API credentials. |
| **SignCare** | PAN Verification | Backend Adapter | **Automated Contract Tests Passed** | Verified request schema, name extraction, 4xx/5xx handling, and timeout behavior. Live tax database queries are blocked pending corporate SignCare credentials. |
| **RazorpayX** | Payout Disbursements & Webhooks | Backend Adapter & Worker | **Automated Contract Tests Passed** | Verified payout creation, raw body webhook HMAC signatures, amount validation in paise, deduplication, and reversals. Live payouts blocked pending active RazorpayX current account with banking balance. |
| **Firebase (FCM)** | Mobile Push Notifications | Backend Adapter | **Automated Contract Tests Passed** | Verified token deactivation on unregistered devices, Retry-After header parsing, and background multicast dispatch. Live push delivery blocked pending Firebase service account JSON. |
| **Cloudflare R2** | Private Document & Backup Storage | Storage & S3 Adapter | **Automated Contract Tests Passed** | Verified HMAC signed URL generation, S3 API contract, AES-256 backup encryption, and checksum validation. Live cloud storage blocked pending production Cloudflare R2 bucket credentials. |
| **Google Play Integrity** | Android Anti-Tampering | Mobile & Backend Adapter | **Blocked for Live Device Attestation**; **Automated Contract Tests Passed** | Verified nonce generation, single-use anti-replay consumption, Google Service Account OAuth token exchange, Google Play Integrity decode endpoint integration, comprehensive payload evaluation (package, nonce, timestamp, cert fingerprints, device verdicts, licensing), action-bound attestation middleware, and fail-closed production enforcement (46 dedicated tests across 2 suites). Live device attestation is blocked pending Google Play Console linked Cloud Project credentials and signed release APK on a physical Android device. |

---

## 6. Verification Commands & Execution Results

All project-supported verification commands were executed at HEAD:

### 6.1 Backend Test Suite (Jest)
```bash
npm test
```
- **Exit Status:** 0 (SUCCESS)
- **Suites:** 27 passed, 27 total
- **Tests:** 411 passed, 411 total
- **Duration:** 68.275 s
- **Suites Executed:**
  1. `src/tests/part_2_master_remediation.spec.ts` (19 tests) — **MASTER REMEDIATION SUITE**
  2. `src/tests/play_integrity_verification.spec.ts` (35 tests) — **DEDICATED PLAY INTEGRITY SUITE**
  3. `src/tests/action_integrity_enforcement.spec.ts` (11 tests) — **ACTION INTEGRITY ENFORCEMENT SUITE**
  4. `src/tests/admin_api_config.spec.ts`
  5. `src/tests/admin_roles_and_coverage.spec.ts`
  6. `src/tests/api_flows.spec.ts`
  7. `src/tests/auth_sessions_security.spec.ts`
  8. `src/tests/backup_restore.spec.ts`
  9. `src/tests/concurrency_financial.spec.ts`
  10. `src/tests/config_safety.spec.ts`
  11. `src/tests/dynamic_business_rules.spec.ts`
  12. `src/tests/fcm_provider.spec.ts`
  13. `src/tests/global_reward_cap.spec.ts`
  14. `src/tests/hardening_verification.spec.ts`
  15. `src/tests/kyc_and_storage.spec.ts`
  16. `src/tests/migration_scenarios.spec.ts`
  17. `src/tests/notification_system.spec.ts`
  18. `src/tests/p0_remediation_integrity.spec.ts`
  19. `src/tests/pan_migration.spec.ts`
  20. `src/tests/part2a4_hardening.spec.ts`
  21. `src/tests/payout_restore_reconciliation.spec.ts`
  22. `src/tests/payout_safety_worker.spec.ts`
  23. `src/tests/production_hardening_rc.spec.ts`
  24. `src/tests/rewards_and_rules.spec.ts`
  25. `src/tests/reward_rule_hardening.spec.ts`
  26. `src/tests/seed_safety.spec.ts`
  27. `src/tests/unified_auth_flow.spec.ts`

### 6.2 Admin Test Suite (Node.js Native Test Runner)
```bash
npm test (in admin/)
```
- **Exit Status:** 0 (SUCCESS)
- **Tests:** 9 passed, 9 total (strict calendar bounds, leap years, invalid dates rejected)

### 6.3 TypeScript Typecheck Verifications
```bash
npx tsc --noEmit (in backend/) -> Exit Status: 0
npx tsc --noEmit (in admin/)   -> Exit Status: 0
npx tsc --noEmit (in mobile/)  -> Exit Status: 0
```

### 6.4 Mobile Expo Config Verification
```bash
npx expo config --type public (in mobile/)
```
- **Exit Status:** 0 (SUCCESS)
- **Resolved Package:** `com.hiralal.rewards`
- **Resolved Plugins:** `expo-asset`, `./plugins/withPlayIntegrity`

### 6.5 Deployment Health Probe Verification
```bash
python scripts/test_verify_deployment_health.py
```
- **Exit Status:** 0 (SUCCESS)
- **Tests:** 14 passed, 14 total

### 6.6 GitHub Actions Workflow Lint
```bash
actionlint
```
- **Exit Status:** 0 (SUCCESS) — Clean across `.github/workflows/ci.yml` and `.github/workflows/deploy-ec2.yml`.

### 6.7 GitHub Actions CI Pipeline Run
- **Run ID:** [38220560958](https://github.com/abraj12/hiralal/actions/runs/38220560958)
- **Overall Status:** `completed`
- **Overall Conclusion:** `success`
- **Jobs Executed (6/6 Successful):**
  1. `Mobile App Typecheck Verification`: Success
  2. `Admin Date Helper Tests`: Success
  3. `GitHub Actions Workflow Lint (actionlint)`: Success
  4. `Backend Lint, Typecheck, Migrations & Test Suite`: Success (411/411 tests passing)
  5. `Docker ARM64 Build Verification (AWS Graviton2)`: Success
  6. `Full 6-Container Docker Compose Stack Smoke Test`: Success

---

## 7. Changed Files Summary

The following files were modified or created across Part 2:

| Category | File Path | Nature of Change |
| :--- | :--- | :--- |
| **Backend Service** | `backend/src/services/integrity/playIntegrity.service.ts` | Replaced placeholder with genuine Google Service Account OAuth assertions (omitting `sub`), Google Play Integrity decode endpoint (`decodeIntegrityToken`), action- and session-bound nonces, certificate fingerprinting, and fail-closed production enforcement |
| **Backend Middleware**| `backend/src/middleware/integrity.middleware.ts` | Created `requireActionIntegrity(action)` middleware enforcing device attestation on sensitive routes |
| **Backend Routes** | `backend/src/routes/bill.routes.ts` | Enforced `requireActionIntegrity('BILL_UPLOAD')` on `POST /api/bills` |
| **Backend Routes** | `backend/src/routes/payout.routes.ts` | Enforced `requireActionIntegrity('PAYOUT_REDEEM')` on `POST /api/payouts/redeem` |
| **Backend Routes** | `backend/src/routes/kyc.routes.ts` | Enforced `requireActionIntegrity('KYC_SUBMIT')` on `POST /api/kyc/pan/verify` |
| **Backend Routes** | `backend/src/routes/auth.routes.ts` | Added action context support and IP rate limiting on `/integrity/nonce` and `/integrity/verify` |
| **Backend Config** | `backend/src/config/index.ts` | Added `playIntegrity` schema, `enforceActions` flag, and production certificate fingerprint validation |
| **Backend Tests** | `backend/src/tests/action_integrity_enforcement.spec.ts` | Dedicated test suite verifying direct route bypass rejection across bills, payouts, and KYC (11 tests) |
| **Backend Tests** | `backend/src/tests/play_integrity_verification.spec.ts` | Dedicated test suite verifying OAuth claims (no `sub`), cert pinning, action nonces, and fail-closed policies (35 tests) |
| **Mobile App Config** | `mobile/app.json` | Configured package `com.hiralal.rewards` and plugin `./plugins/withPlayIntegrity` |
| **Mobile Plugin** | `mobile/plugins/withPlayIntegrity.js` | Expo config plugin generating native `PlayIntegrityModule.java` and `PlayIntegrityPackage.java` linking Play Integrity SDK 1.4.0 |
| **Mobile Service** | `mobile/src/services/integrity.service.ts` | Created `MobileIntegrityService` for native token requests and action attestation |
| **Mobile API Client**| `mobile/src/services/api.ts` | Integrated attestation headers into `uploadBill`, `verifyPan`, and `redeemRewards` |
| **Admin Configuration**| `admin/tsconfig.json` | Configured `allowImportingTsExtensions: true` to align `tsc --noEmit` with Next.js & native node tests |
| **CI Workflow** | `.github/workflows/ci.yml` | Added admin TypeScript typecheck step; added Play Integrity test env vars; verified report artifact upload |
| **Audit Documentation**| `docs/audits/part_2_master_remediation_report.md` | Authoritative Part 2 master remediation report artifact |

---

## 8. Release Readiness Checklist & Operational Prerequisites

Before deploying to production AWS infrastructure or releasing mobile builds to app stores, the following operational prerequisites must be completed:

- [x] **Code & Architecture Completion:** All business logic, transaction boundaries, advisory locks, rate limits, action attestation middleware, and audit logs are fully implemented in code.
- [x] **Automated Regression Testing:** 100% of local and CI regression tests pass across 27 suites and 411 tests.
- [x] **Database Schema Stability:** Migrations are linear, tested, and include database uniqueness constraints on `(profession, version)`.
- [x] **Container & Deployment Configuration:** Docker Compose memory limits fit within the 4 GiB budget of AWS Graviton2 (`t4g.medium`). Nginx is configured for Cloudflare Full (Strict) SSL with reverse proxy routing.
- [ ] **Production Secrets Provisioning (BLOCKED):** Production `.env` file must be provisioned on the EC2 host with high-entropy rotated secrets (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`, `STORAGE_HMAC_SECRET`).
- [ ] **Provider Credentials Provisioning (BLOCKED):** Real credentials for MSG91, SignCare, RazorpayX, Firebase, Cloudflare R2, and Google Play Integrity must be obtained and configured in the production environment.
- [ ] **Physical Device Play Integrity Signing (BLOCKED):** Google Play Console linked Cloud Project credentials, production SHA-256 certificate digests, and release signing keystores are required for production mobile app attestation on physical Android devices.
- [ ] **DNS & Origin SSL Cutover (BLOCKED):** Domain `rewards.hiralalandsons.com` must be pointed via Cloudflare proxy to the AWS Elastic IP, with Origin CA certificates installed in `/etc/nginx/ssl`.

---

## 9. Conclusion

Part 2 is formally declared **ENGINEERING-COMPLETE**.

All identified in-scope software defects, architectural inconsistencies, and security edge-cases have been remediated with full test coverage and automated verification. Live staging and production release remain safely gated behind the operational prerequisites documented above.
