# Remediation History & Engineering Log
## Hiralal and Sons Sales Pvt. Ltd. — Platform Hardening & Bug Fixes

This document records the chronological history of all security remediations, financial logic corrections, architectural refactorings, and infrastructure hardening across the platform.

---

### Record 1: Mandatory Exact Bank Account Holder Name Matching Against PAN
- **Date:** October 2026
- **Finding Identifier:** `NAME-MATCH-01`
- **Severity:** Critical
- **Affected Files:**
  - `backend/src/utils/name.utils.ts`
  - `backend/src/services/payment.service.ts`
  - `backend/src/services/kyc/index.ts`
  - `backend/src/tests/exact_name_matching.spec.ts`
  - `backend/src/tests/global_reward_cap.spec.ts`
  - `backend/src/tests/final_audit_remediation_regression.spec.ts`
- **Root Cause:**
  The platform previously allowed non-exact identity verification, including Jaro-Winkler similarity thresholds (>= 0.75), subset matching, token swapping, initials expansion, and middle-name omissions. This created severe financial liability where payouts could be disbursed to bank accounts not belonging to the verified PAN holder.
- **Implementation Approach:**
  1. Centralized name comparison strictly into `normalizeName` and `areNamesMatching` in `backend/src/utils/name.utils.ts`.
  2. Implemented strict uppercase trimming and whitespace collapsing.
  3. Stripped approved initial prefixes (`MR`, `MRS`, `MS`, `DR`, `SHRI`, `SHREE`, `SRI`, `SMT`, `KUMARI`, `M/S`, `M.S.`) solely when followed by whitespace at the start of the string.
  4. Preserved genuine name tokens where prefix syllables are embedded (e.g., `SRIDHAR`, `KUMAR`, `ANITA KUMARI`).
  5. Required strict normalized string equality (`normAccount === normPan`).
  6. Completely removed all fuzzy, subset, token-reordered, and middle-name-omitted matching.
- **Regression Tests & Verification Results:**
  - Authored `backend/src/tests/exact_name_matching.spec.ts` testing 21 distinct positive and negative test cases.
  - Verified:
    - `RAHUL KUMAR SINGH` vs `RAHUL KUMAR SINGH` -> **PASS**
    - `MR RAHUL KUMAR SINGH` vs `RAHUL KUMAR SINGH` -> **PASS**
    - `RAHUL KUMAR SINGH` vs `RAHUL SINGH` -> **REJECTED (FAIL)**
    - `RAHUL SINGH` vs `RAHUL KUMAR SINGH` -> **REJECTED (FAIL)**
    - `AMIT KUMAR` vs `AMIT KUMAR VERMA` -> **REJECTED (FAIL)**
    - `HITESH RAMESHBHAI PATEL` vs `RAMESHBHAI PATEL` -> **REJECTED (FAIL)**
    - `RAHUL KUMAR SINGH` vs `SINGH RAHUL KUMAR` -> **REJECTED (FAIL)**
    - `RAHUL KUMAR SINGH` vs `RAHUL KUMAR SHARMA` -> **REJECTED (FAIL)**
    - `RAJESH KUMAR SHARMA` vs `R K SHARMA` -> **REJECTED (FAIL)**
  - Execution Result: 21/21 tests passed. All legacy tests updated and passing.

---

### Record 2: Payout Worker Pre-Dispatch Gateway State Double-Reversal & Fund Lock
- **Date:** October 2026
- **Finding Identifier:** `VERIF-01` / `FIN-BUG-01`
- **Severity:** High
- **Affected Files:**
  - `backend/src/worker/payout.worker.ts`
  - `backend/src/services/payout.service.ts`
- **Root Cause:**
  When RazorpayX contact creation or fund account creation threw an exception during pre-dispatch in `payout.worker.ts`, the payout record remained trapped in `PROCESSING` status indefinitely. Craftsman wallet balances remained locked, requiring manual database intervention.
- **Implementation Approach:**
  1. Updated pre-dispatch exception handling in `backend/src/worker/payout.worker.ts` to call `PayoutService.failBeforeDispatch(payoutId, reason)`.
  2. In `backend/src/services/payout.service.ts`, implemented `failBeforeDispatch` which delegates to `reversePayout` inside a transaction.
  3. Enforced strict pessimistic row-level locking (`SELECT ... FOR UPDATE`) on the user's `Wallet` row before incrementing `availableBalance` and decrementing `processingAmount`.
  4. Added `queryGatewayByReference` to verify that RazorpayX has no record of the payout before in-flight rejection.
- **Regression Tests & Verification Results:**
  - Verified through `src/tests/final_audit_remediation_regression.spec.ts` and `src/tests/payout_safety_worker.spec.ts`.

---

### Record 3: Mononymous KYC Approval Name Locking & Post-Verification Tampering
- **Date:** October 2026
- **Finding Identifier:** `VERIF-02` / `SEC-KYC-01`
- **Severity:** High
- **Affected Files:**
  - `backend/src/routes/admin.routes.ts`
  - `backend/src/services/auth.service.ts`
- **Root Cause:**
  Craftsmen whose single names were approved via mononymous KYC exception could subsequently call `PATCH /auth/profile` (`updateUserName`), mutating their profile name to match a third party's bank account.
- **Implementation Approach:**
  1. Updated `POST /users/:id/verify-mononymous-kyc` in `backend/src/routes/admin.routes.ts` to atomically set `isNameLocked = true` and `nameLockedAt = new Date()`.
  2. In `backend/src/services/auth.service.ts` (`updateUserName`), added guard checks: if `user.isNameLocked` is true, or if verified KYC records exist, reject the name modification with `400 BAD_REQUEST`.
- **Regression Tests & Verification Results:**
  - Verified through `src/tests/final_audit_remediation_regression.spec.ts`.

---

### Record 4: Bill Upward Deviation Floor Enforced & GST Rule Snapshot Drift
- **Date:** October 2026
- **Finding Identifier:** `VERIF-03`, `VERIF-15`
- **Severity:** Medium
- **Affected Files:**
  - `backend/src/services/bill.service.ts`
  - `backend/src/routes/bill.routes.ts`
  - `admin/src/lib/components.test.ts`
- **Root Cause:**
  1. Upward bill deviation lacked an upper-bound cap, permitting arbitrary bill inflation.
  2. Toggling `isGstIncluded` to `false` in bill review preserved the previously selected `gstRuleId` and rate, corrupting tax breakdown snapshots.
- **Implementation Approach:**
  1. Enforced `newAmount <= originalAmount * 1.5` and non-negative boundaries in `bill.service.ts`.
  2. Atomically reset `selectedGstRuleId = null` and `effectiveGstRate = 0.0` when `isGstIncluded` is `false`.
  3. Restored `requireBillAdmin` middleware on bill review and verification endpoints.
- **Regression Tests & Verification Results:**
  - Verified in `src/tests/final_audit_remediation_regression.spec.ts` and `admin/src/lib/components.test.ts`.

---

### Record 5: Reconciliation Worker Atomic CAS Leases & Financial Invariant Assertions
- **Date:** October 2026
- **Finding Identifier:** `VERIF-04`, `FIN-BUG-03`, `VERIF-05`, `VULN-FIN-01`
- **Severity:** High
- **Affected Files:**
  - `backend/src/worker/reconciliation.worker.ts`
  - `backend/src/routes/webhook.routes.ts`
- **Root Cause:**
  Concurrent reconciliation runs risked race conditions on unleased webhook events. Furthermore, lack of strict currency and amount equality checks allowed potential gateway callback manipulation or discrepancy.
- **Implementation Approach:**
  1. Implemented a 60-second atomic CAS lease in `backend/src/worker/reconciliation.worker.ts` via `WebhookEvent.updateMany` setting `lockedUntil`.
  2. Added assertion invariants checking `payoutEntity.currency === 'INR'` and `Number(payoutEntity.amount) === Number(toPaise(payoutRecord.amount))`.
  3. Added double-entry `WalletTransaction` with type `MANUAL_ADJUSTMENT` on financial drift, marking terminal `payout.failed` / `payout.rejected` events with `requiresManualReview: true`.
- **Regression Tests & Verification Results:**
  - Verified in `src/tests/final_audit_remediation_regression.spec.ts` and `src/tests/payout_restore_reconciliation.spec.ts`.

---

### Record 6: 3-Tier Admin Authentication Hardening & Token Binding
- **Date:** October 2026
- **Finding Identifier:** `VERIF-06`, `VERIF-07`, `VERIF-09`, `VERIF-11`, `VERIF-12`
- **Severity:** High
- **Affected Files:**
  - `backend/src/routes/auth.routes.ts`
  - `backend/src/services/auth.service.ts`
  - `backend/src/server.ts`
  - `mobile-admin/src/services/api.ts`
  - `mobile-admin/src/screens/AdminLoginScreen.tsx`
  - `mobile-admin/src/context/AdminAppContext.tsx`
- **Root Cause:**
  Admin prefix validation endpoint leaked whether a prefix existed without binding to the subsequent login request. Password lockouts were permanent without a sliding window.
- **Implementation Approach:**
  1. Created `verifyTier1Token` middleware in `auth.routes.ts`, requiring `X-Tier1-Token` on `/admin-portal/login` and `/admin/otp/request`.
  2. Propagated `tier1Token` from `verifyPrefix` through `mobile-admin` API client.
  3. Added 15-minute sliding window query for failed password attempts (`clock.now - INTERVAL '15 minutes' THEN 1`).
  4. Decoupled OTP rate limits from password lockouts.
  5. Scoped 15MB express body parser exclusively to `POST /api/v1/bills` and preserved 100KB globally.
- **Regression Tests & Verification Results:**
  - Verified in `src/tests/admin_otp_enforcement.spec.ts` and `mobile-admin/tests/adminAuth.test.js`.

---

### Record 7: Database Schemas, R2 Presigned URLs, and DevOps Security
- **Date:** October 2026
- **Finding Identifier:** `VERIF-10`, `VERIF-14`, `VERIF-16`, `VERIF-17`, `INFRA-01` to `INFRA-05`, `MOB-02`
- **Severity:** Medium
- **Affected Files:**
  - `backend/prisma/schema.prisma`
  - `backend/src/utils/crypto.utils.ts`
  - `backend/src/services/storage/r2.provider.ts`
  - `nginx/nginx.conf`
  - `scripts/backup-db.sh`
  - `scripts/restore-db.sh`
  - `scripts/server-setup-kvm.sh`
  - `mobile/src/services/adminPrefixes.ts` (deleted)
- **Implementation Approach:**
  1. Cleaned 12 redundant indexes in `schema.prisma`.
  2. Set `Wallet.user` relation to `onDelete: Restrict`.
  3. Overloaded `generateBlindIndex()` to return `null` on blank strings.
  4. Set `ResponseContentType` and `inline` disposition in S3 `GetObjectCommand`.
  5. Configured dynamic WebSocket upgrades in Nginx (`map $http_upgrade $connection_upgrade`).
  6. Rewrote backup and restore scripts to use ephemeral `chmod 600` `--env-file` rather than CLI parameters.
  7. Added `iptables-persistent` to preserve Cloudflare firewall rules across reboots.
  8. Deleted unused admin prefix code from customer mobile package.
- **Verification Results:**
  - All 40 backend test suites (741 tests), Admin (18 tests), Mobile (29 tests), Mobile Admin (28 tests) passing (100% green).

---

### Record 8: Immutable Invoice Submissions, Upward Deviation Escalations & Production Security Hardening
- **Date:** October 2026
- **Finding Identifier:** `RES-01`, `SEC-LEGALHOLD-01`, `ADV-01` through `ADV-13`, `VULN-FIN-01`, `VULN-FIN-02`, `VULN-FIN-04`, `SEC-FINFENCE-02`, `PERF-01`, `RES-02`, `RES-05`, `VULN-DB-01`, `VULN-SUPPLY-01`, `SEC-AUDIT-01`, `VULN-FRONT-01`
- **Severity:** Critical
- **Affected Files:**
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20261022120000_immutable_invoices_and_remediation/migration.sql`
  - `backend/src/services/bill.service.ts`
  - `backend/src/services/account-deletion.service.ts`
  - `backend/src/services/payout.service.ts`
  - `backend/src/routes/admin.routes.ts`
  - `backend/src/routes/auth.routes.ts`
  - `backend/src/routes/bill.routes.ts`
  - `backend/src/routes/reward.routes.ts`
  - `backend/src/routes/webhook.routes.ts`
  - `admin/src/components/BillVerificationModal.tsx`
  - `admin/src/pages/bills.tsx`
  - `admin/src/pages/users.tsx`
  - `admin/src/lib/api.ts`
  - `admin/src/lib/financial-utils.ts`
  - `mobile-admin/src/screens/BillReviewScreen.tsx`
  - `shared/types/index.ts`
  - `docker-compose.yml`
  - `.github/workflows/ci.yml`
  - `backend/src/tests/immutable_invoices_and_findings_regression.spec.ts`
- **Implementation Approach:**
  1. **Immutable Invoices:** Excised `correctedGrossAmount` completely from the backend service, routes, admin API client, and frontend modal. Bill Admin cannot alter submitted gross amounts via API or UI. Reward calculation is strictly computed from submitter-uploaded gross amounts.
  2. **Revision Workflow & Escalation:** Added `parentBillId`, `revisionNumber`, and `requiresSecondaryApproval` to `Bill`. Craftsmen resubmit rejected bills as revisions. If a revision exceeds prior gross amount by >25%, status is set to `UNDER_REVIEW` with `requiresSecondaryApproval = true`, requiring `OPERATIONS_ADMIN` sign-off.
  3. **Bill Cancellation:** Added `CANCELLED` status and `cancelBill` method with mandatory cancellation reasons.
  4. **Legal Hold Enforcement:** Enforced `legalHold: false` check in `requestDeletion`, `confirmDeletion`, and background processing jobs.
  5. **Gateway Ambiguity Defense:** Differentiated gateway not-found from timeout/network failures in `rejectRedemption`, keeping funds reserved on gateway errors.
  6. **Resource & DB Resilience:** Configured Redis `--maxmemory-policy volatile-lru`, Prisma `connection_limit=30`, PostgreSQL check constraint `chk_wallet_total_redeemed_non_negative`, and bounded query pagination limits.
- **Verification Results:**
  - `src/tests/immutable_invoices_and_findings_regression.spec.ts`: 11/11 tests passed (100%).
  - `src/tests/shared_contract_parity.spec.ts`: 7/7 tests passed (100%).
  - `src/tests/final_audit_remediation_regression.spec.ts`: 21/21 tests passed (100%).
  - `admin` unit tests: 18/18 passed (100%).
  - `mobile` unit tests: 29/29 passed (100%).
  - `mobile-admin` unit tests: 28/28 passed (100%).
  - Total Verified Tests: **827 / 827 tests passing (100% green)** across all workspaces.

---

### Record 9: Residual Platform & Security Hardening (Residual Items DEF-EXT-01 to RED-01)
- **Date:** October 2026
- **Finding Identifier:** `DEF-EXT-01`, `DEF-EXT-02`, `CRYPTO-AUDIT-01`, `PERF-RES-01`, `PERF-RES-02`, `RED-01`
- **Severity:** High
- **Affected Files:**
  - `backend/src/routes/webhook.routes.ts`
  - `backend/src/worker/payout.worker.ts`
  - `backend/src/worker/account-deletion.worker.ts`
  - `backend/src/utils/crypto.utils.ts`
  - `backend/src/routes/bill.routes.ts`
  - `backend/src/middleware/integrity.middleware.ts`
  - `backend/src/routes/admin.routes.ts`
  - `admin/src/lib/financial-utils.ts`
  - `admin/src/utils/url.utils.ts`
  - `admin/src/lib/components.test.ts`
- **Root Cause:**
  1. **DEF-EXT-01:** Webhook callback handling on currency or paise mismatch returned HTTP 200 without flagging the specific payout record with `requiresManualReview: true` and an explanatory reason.
  2. **DEF-EXT-02:** Background workers lacked continuous heartbeat lease renewal and Redis scan cursor tracking, risking duplicate execution or premature lock loss during prolonged tasks.
  3. **CRYPTO-AUDIT-01:** AES-256-GCM decrypt routines did not explicitly assert byte lengths on IV (12 bytes) and Auth Tag (16 bytes), permitting potential malformed payload processing.
  4. **PERF-RES-01:** Disk-stored invoice uploads leaked temporary files in `uploads/tmp` when requests failed during early input validation or Play Integrity verification.
  5. **PERF-RES-02:** Monthly dashboard metrics retrieved all transactions into Node.js heap memory to iterate and sum via JavaScript loops, creating heap exhaustion risks.
  6. **RED-01:** Document viewer URL sanitizer used single-pass decoding susceptible to multi-nested percent-encoded directory traversal bypasses while rejecting valid relative paths with query parameters.
- **Implementation Approach:**
  1. **Webhook Invariant Review Flagging (DEF-EXT-01):** Marked payout record with `requiresManualReview: true` and detailed mismatch reasons before returning HTTP 200.
  2. **Worker Heartbeat & Cursor Tracking (DEF-EXT-02):** Integrated periodic Redis heartbeat lease renewal (`assertLease` and 15s interval) with unref timers and deterministic cursor tracking.
  3. **Explicit Crypto Length Validation (CRYPTO-AUDIT-01):** Injected strict assertions (`iv.length !== 12` and `tag.length !== 16`) before decipher initialization.
  4. **Disk File Cleanup on Validation Failures (PERF-RES-01):** Added `cleanupUploadedFile(req)` to all early rejection and error branches in bill upload routes and integrity middleware.
  5. **Database Aggregation Parallelization (PERF-RES-02):** Converted in-memory JS loops to `Promise.all([prisma.walletTransaction.aggregate(...)])` grouped by profession (`PLUMBER`, `TILE_INSTALLER`).
  6. **Iterative URL Decoding & Parameter Support (RED-01):** Implemented a 5-iteration decoding loop to catch nested traversals while permitting safe query strings and hash parameters (`/^(?:\/(?!\/|\\)|\?|#)[\w\-.~%!$&'()*+,;=:@/?#]*$/`).
- **Verification Results:**
  - `admin/src/lib/components.test.ts`: 22/22 passed.
  - `backend/src/tests/pan_migration.spec.ts`: 8/8 passed.
  - Verified all residual edge cases resolved.

---

### Record 10: Test Suite Hardening, Rate-Limit Isolation & Legacy Invariant Alignment
- **Date:** October 2026
- **Finding Identifier:** `TEST-HARNESS-01`, `TEST-LEGACY-01` through `TEST-LEGACY-07`
- **Severity:** Medium
- **Affected Files:**
  - `backend/src/tests/admin_otp_enforcement.spec.ts`
  - `backend/src/tests/pan_migration.spec.ts`
  - `backend/src/tests/phase0_remediation.spec.ts`
  - `backend/src/tests/phase2_remediation.spec.ts`
  - `backend/src/tests/exact_name_matching.spec.ts`
  - `backend/src/tests/immutable_invoices_and_findings_regression.spec.ts`
  - `backend/src/tests/account_deletion_and_threshold.spec.ts`
- **Root Cause:**
  Legacy test suites contained outdated assertions predating master security remediations, including expecting 401 instead of 403 `ADMIN_TIER_REQUIRED` on `/login`, testing fuzzy PAN name matches, expecting mutable gross amounts, and encountering cross-suite rate limit pollution.
- **Implementation Approach:**
  1. **TEST-HARNESS-01 (Rate-Limit Isolation):** Isolated Redis rate limiting buckets and cooldown timers between sequential test suites.
  2. **TEST-LEGACY-01 (Admin Route Gating):** Updated legacy authentication tests to expect 403 `ADMIN_TIER_REQUIRED` when administrative prefixes hit the craftsman login route.
  3. **TEST-LEGACY-02 (Exact PAN Matching):** Aligned all verification tests with strict normalized string equality (`normAccount === normPan`).
  4. **TEST-LEGACY-03 (Immutable Invoices):** Updated bill submission and review payloads to excise `correctedGrossAmount`.
  5. **TEST-LEGACY-04 (Deviation Escalation):** Added tests validating >25% upward revisions escalate to `OPERATIONS_ADMIN`.
  6. **TEST-LEGACY-05 (Legal Hold Enforcement):** Verified account deletion blocks users with active `legalHold`.
  7. **TEST-LEGACY-06 (Crypto Length Invariants):** Added test coverage for invalid IV and Auth Tag lengths in `pan_migration.spec.ts`.
  8. **TEST-LEGACY-07 (Audit Scrubbing Alignment):** Updated consolidated PII scrub string expectations in `phase2_remediation.spec.ts`.
- **Verification Results:**
  - **Backend Suites:** 46 suites, 793 passed (100%).
  - **Admin Suites:** 2 suites, 22 passed (100%).
  - **Mobile Suites:** 5 suites, 29 passed (100%).
  - **Mobile Admin Suites:** 5 suites, 28 passed (100%).
  - **Total Verified Tests:** **872 / 872 tests passing across 58 suites (100% green)**.

---

### Record 11: Chained Revision Upward Creeping & Parent Linkage Hardening
- **Date:** October 2026
- **Finding Identifier:** `ADV-CHAIN-01`, `ADV-PARENT-01`
- **Severity:** Medium
- **Affected Files:**
  - `backend/src/services/bill.service.ts`
  - `backend/src/tests/immutable_invoices_and_findings_regression.spec.ts`
- **Root Cause:**
  1. `ADV-CHAIN-01`: Upward deviation checks were evaluated solely against the immediately preceding rejected revision (`latestRejected`), allowing craftsmen to submit multiple incremental revisions (+20% each) that cumulatively exceeded 25% relative to the root invoice without triggering secondary approval.
  2. `ADV-PARENT-01`: Client-submitted `data.parentBillId` was accepted as a fallback/override, permitting arbitrary linkage to unrelated bill records.
- **Implementation Approach:**
  1. In `BillService.submitBill`, hardened parent pointer assignment to `parentBillId = latestRejected.id`, completely disregarding any client-supplied parent pointers.
  2. Evaluated upward deviation against both `latestRejected` AND the root submission revision (`revisionNumber: 1`). If `newGross > parentGross * 1.25` OR `newGross > rootGross * 1.25`, the revision is escalated with `requiresSecondaryApproval: true` and `status: 'UNDER_REVIEW'`.
- **Verification Results:**
  - `src/tests/immutable_invoices_and_findings_regression.spec.ts`: 11/11 passed.
  - TypeScript compilation: 100% clean.

---

### Record 12: Independent Audit Finding Remediation (Financial Drift, Complete Statutory Purge & Parity Hardening)
- **Date:** October 2026
- **Finding Identifier:** `AUDIT-CRIT-01`, `AUDIT-HIGH-01`, `AUDIT-MED-01`, `AUDIT-LOW-01`
- **Severity:** Critical / High / Medium / Low
- **Affected Files:**
  - `backend/src/worker/reconciliation.worker.ts`
  - `backend/src/routes/webhook.routes.ts`
  - `backend/src/services/account-deletion.service.ts`
  - `.github/workflows/deploy-kvm.yml`
  - `backend/src/tests/auditor_reconciliation_and_retention_regression.spec.ts`
- **Root Cause:**
  1. `AUDIT-CRIT-01`: Reconciliation worker late-success payout drift handler wiped `availableBalance` to 0 and recorded `amount: 0` in ledger rather than deducting the exact payout amount and updating status to `SUCCESS`.
  2. `AUDIT-HIGH-01`: Statutory retention purge selected users outside a transaction without re-verifying `legalHold: false` inside the transaction (TOCTOU race), and left legacy unencrypted PAN and bank columns intact.
  3. `AUDIT-MED-01`: Webhook handler failed to flag `payoutRecord.requiresManualReview = true` when amount was NaN/missing. Gateway polling lacked currency and amount parity assertions before finalizing payout success.
  4. `AUDIT-LOW-01`: Deployment workflow fell back to legacy EC2 secrets.
- **Implementation Approach:**
  1. Aligned `reconciliation.worker.ts` with `webhook.routes.ts`: locks wallet, deducts exact `payoutAmt` (`Math.max(0, currentAvail - payoutAmt)`), increments `totalRedeemed`, updates `payout.status: 'SUCCESS'` with `requiresManualReview: true`, and logs `PAYOUT_DEBIT` with `amount: payoutAmt`.
  2. Hardened `AccountDeletionService.purgeExpiredStatutoryRecords()`: re-asserts `legalHold: false` inside `$transaction` and scrubs all legacy and encrypted PII/financial columns across `KycRecord` and `PaymentAccount`.
  3. Updated `webhook.routes.ts` to flag manual review on NaN/missing amounts, and added strict currency (`INR`) and paise amount parity assertions in `ReconciliationWorker.reconcileStuckPayouts` and `reconcileSinglePayout`.
  4. Purged legacy `secrets.EC2_*` fallbacks in `.github/workflows/deploy-kvm.yml`.
- **Verification Results:**
  - `backend/src/tests/auditor_reconciliation_and_retention_regression.spec.ts`: 4/4 passed.
  - **Backend Suites:** 47 suites, 797 passed (100%).
  - **Admin Suites:** 2 suites, 22 passed (100%).
  - **Mobile Suites:** 5 suites, 29 passed (100%).
  - **Mobile Admin Suites:** 5 suites, 28 passed (100%).
  - **Total Verified Tests:** **876 / 876 tests passing across 59 suites (100% green)**.

---

### Record 13: Comprehensive Autonomous Remediation (Wave 1 to Wave 4 RC1)
- **Date:** October 2026
- **Finding Identifiers:**
  - `REG-HASH-01`: Android Registration Request Hash Missing Password & Verification Token
  - `LEDGER-DRIFT-01`: Financial Drift Ledger Clamping Violation Eliminated
  - `CONFIG-PREFLIGHT-01`: Pre-Flight Validation for Secrets and Admin Mobiles
  - `BILL-DEADLOCK-01`: Secondary Bill Review Deadlock Resolution
  - `ANDROID-PERMS-01`: Explicit Android Permissions in Expo Manifest
  - `KYC-PROACTIVE-01`: Proactive KYC Submission and Account Linking Modal Flow
  - `PAYOUT-CEILING-01`: Hard ₹50,000 Per-Redemption Ceiling & Configurable Maximum
  - `MONONYMOUS-KYC-01`: Mononymous (Single Name) User Verification UI Support
  - `PUSH-NOTIF-01`: Push Notifications Dispatch Restored on Bill & Payout Actions
  - `AUTH-LOGOUT-01`: Admin Logout Cookie Clearing & Anti-Spoofing Fix
  - `GRACEFUL-SHUTDOWN-01`: Graceful Process Termination with 10s Connection Drain
  - `NO-NEFT-01`: Strict Payout Rail Enforcement (UPI & IMPS Only, Zero NEFT)
  - `ROUND-FLOOR-01`: Frontend Reward Rounding Synchronized to Exact ROUND_DOWN Floor
  - `MOBILE-REGEX-01`: Mobile Number Regex Harmonized to `/^[6-9]\d{9}$/`
  - `QUERY-STATUS-01`: Sanitization of `req.query.status` Query Parameters
  - `SCHEMA-MIGRATION-01`: Composite Database Indexes & PostgreSQL Append-Only Audit Immutability Trigger
  - `LEGAL-HOLD-TOCTOU-01`: Atomic Row-Level Lock Check on Statutory Legal Holds
  - `LOGOUT-DOS-01`: Prevention of Unauthenticated Session DoS on Logout
  - `NGINX-CATCHALL-01`: Hardened Nginx Configuration with default_server Catch-All Block
  - `DAILY-LIMIT-01`: Concurrency-Safe Per-User Daily Payout Limit (₹50,000 IST)
  - `TIMEZONE-IST-01`: Explicit Timezone Offset Formatting Across Clients
  - `ERROR-MIDDLEWARE-01`: Centralized Express Error Handling Middleware
- **Affected Subsystems:** Backend API, Admin Web App, Mobile Customer App, Mobile Admin App, PostgreSQL Schema, Nginx Proxy
- **Implementation Approach:**
  1. Updated `mobile/src/services/api.ts` to include `data.password` and `data.verificationToken` in `createRegistrationRequestHash`.
  2. In `webhook.routes.ts` and `reconciliation.worker.ts`, removed balance clamping (`Math.max(0, ...)`), allowing exact deficit debt modeling when payouts exceed available balance. Created DDL migration dropping `chk_wallet_available_balance_non_negative`.
  3. Added pre-flight startup assertions in `config/index.ts` ensuring `BLIND_INDEX_SECRET` is at least 32 characters and admin mobiles are valid 10-digit Indian numbers.
  4. Resolved secondary bill review deadlock by granting `OPERATIONS_ADMIN` read and verification access for escalated bills in `Sidebar.tsx`, `bills.tsx`, `App.tsx`, and `AdminBottomNav.tsx`.
  5. Added `CAMERA`, `POST_NOTIFICATIONS`, and `READ_MEDIA_IMAGES` to `mobile/app.json`.
  6. Added `setupOnly` and `initialStep` to `RedemptionModal.tsx` in `mobile/src/components/`, enabling proactive KYC and payment account setup.
  7. Enforced immutable hard ceiling of ₹50,000 (5,000,000 paise) in `payout.service.ts`. Constrained configurable maximum to ₹0–₹50,000 where ₹0 disables redemptions. Removed all NEFT references and enforced strictly UPI and IMPS payout rails.
  8. Implemented mononymous KYC manual review UI in `admin/src/pages/users.tsx` and `mobile-admin/src/screens/OpsAdminUsersScreen.tsx`.
  9. Restored `NotificationService.dispatchPushForUser` on all bill and payout lifecycle state transitions.
  10. Cleared cookies reliably on `/logout` in `auth.routes.ts` without vulnerable browser header spoof checks.
  11. Implemented `SIGTERM`/`SIGINT` graceful shutdown in `server.ts` draining connections with 10s timeout.
  12. Synchronized frontend reward calculation in `admin/src/lib/financial-utils.ts` to `ROUND_DOWN` floor parity.
  13. Created migration `20261022190000_redemption_limits_composite_indexes_audit_immutability` adding composite indexes and PostgreSQL trigger `trg_audit_log_immutable`.
  14. Enforced concurrency-safe per-user daily payout limit (₹50,000 per IST calendar day) in `payout.service.ts`.
  15. Created centralized `errorHandler` in `backend/src/middleware/error.middleware.ts` with correlation request IDs and safe error messages.
- **Verification Results:**
  - Dedicated regression test suite: `backend/src/tests/audit_remediation_rc1.spec.ts` (10/10 passed).
  - Admin unit tests: `npm --prefix admin test` (22/22 passed).
  - Mobile tests: `npm --prefix mobile test` (29/29 passed).
  - Mobile Admin tests: `npm --prefix mobile-admin test` (28/28 passed).
  - Migration compatibility tests: `python scripts/test_migration_compatibility.py` (6/6 passed).
  - Deployment health tests: `python scripts/test_verify_deployment_health.py` (61/61 passed).
  - Security floor tests: `node scripts/test-next-security-floor.cjs` (22/22 passed).

---

### Record 15: Deep Code Audit, 5 Specialized Subagents & Controlled Remediation (Wave 7)
- **Date:** October 2026
- **Finding Identifiers:**
  - `FIN-FINDING-01`: Clamping 100% full balance redemption to `dailyRemaining`
  - `FIN-FINDING-02`: Redemption settings strict regex rejecting scientific notation and leading signs
  - `FIN-FINDING-03`: Null `maximumRedemptionAmount` normalization to ₹50,000 backend ceiling
  - `FIN-FINDING-04`: Deficit liability offset on bill approval with double-entry ledger recovery notes
  - `FIN-FINDING-05`: Schema validation parity for `'BANK_ACCOUNT'` in `PaymentTypeEnum`
  - `FIN-FINDING-06`: PostgreSQL advisory transaction lock on redemption settings updates
  - `SEC-AUDIT-01`: Key-to-role binding for Tier-1 tokens via `config.admin.accessSecret || config.jwt.accessSecret`
  - `SEC-AUDIT-02`: Role segregation on `/bills/:id/document-url` strictly restricting `OPERATIONS_ADMIN` to secondary review bills
  - `SEC-AUDIT-04`: Input validation for device token and platform on `POST /push-token/register`
  - `SEC-AUDIT-05`: Check existing pending mononymous KYC records before creating a new pending record
  - `AUDIT-DB-01`: Decoupling binary R2 file upload outside interactive database transaction in `submitBill`
  - `AUDIT-DB-02`: Decoupling physical storage deletion outside statutory purge database transaction
  - `AUDIT-DB-03` / `AUDIT-RED-06`: In-flight task tracking, graceful drain barriers (`drainInFlightTasks`), and payout worker positive finite amount assertions
  - `AUDIT-DB-04`: Asynchronous chunked fan-out (`chunkSize = 500`) for push notification campaigns
  - `AUDIT-DB-05`: Composite OTP provider trying WhatsApp first with automated MSG91 SMS fallback
  - `AUDIT-DB-06` / `AUDIT-DB-08`: Forward-only migration adding CHECK constraints on non-negative wallet balances and restricting campaign target users
  - `AUDIT-RED-01`: Updated `docs/API_DOCUMENTATION.md` to canonical `/api/v1/webhooks/razorpayx`
  - `AUDIT-RED-02`: Segregated role enforcement preventing same-admin secondary approval
  - `AUDIT-RED-03`: Fixed global teardown cascade hierarchy in Jest teardown hooks
  - `F-01-ADMIN-ERR-BOUNDARY`: React Error Boundary for Next.js Admin SPA (`AdminErrorBoundary.tsx`)
  - `F-02-MOB-ERR-BOUNDARY`: React Native Error Boundaries for customer mobile and mobile-admin apps
  - `F-03-ADMIN-URL-WILDCARD`: Restricted S3 host regex pattern in `safeDocumentUrl`
  - `F-04-ADMIN-APPROVAL-GATING`: Visual role gating banner and approval button disabled state in `BillVerificationModal.tsx`
  - `F-05-INFRA-DUP-HEADERS`: Nginx `proxy_hide_header` directives eliminating duplicate upstream headers
- **Affected Subsystems:** Backend Services, Worker Queues, Database Migrations, Next.js Admin Panel, Expo Mobile Applications, Infrastructure / Nginx Configuration, Living Documentation.
- **Implementation Approach:**
  1. Clamped `PayoutService.requestRedemption` to `Math.min(currentAvailable, effectiveMax, dailyRemaining)`.
  2. In `backend/src/routes/admin.routes.ts`, enforced strict regex `STRICT_CURRENCY_REGEX = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/` rejecting scientific notation and leading signs, normalized null to ₹50,000 ceiling, and acquired `pg_advisory_xact_lock(hashtext('redemption_settings_' + settingId))`.
  3. In `backend/src/services/bill.service.ts`, implemented automatic deficit liability offset: `deficitOffset = Math.min(currentDeficit, finalReward)` crediting only net surplus to `availableBalance` and recording `DEFICIT_RECOVERY` notes in `WalletTransaction`.
  4. Decoupled Cloudflare R2 uploads and physical deletions outside interactive PostgreSQL database transactions in `submitBill` and `purgeExpiredStatutoryRecords`.
  5. Implemented `inFlightTasks` tracking and `drainInFlightTasks(15000)` in `payout.worker.ts`, `reconciliation.worker.ts`, `account-deletion.worker.ts`, and `worker/index.ts`. Asserted positive finite amount on payout dispatch.
  6. Enforced key-to-role binding for Tier-1 tokens via `config.admin.accessSecret || config.jwt.accessSecret` in `auth.routes.ts`.
  7. Created migration `20261023180000_wallet_check_constraints_and_campaign_restrict` deploying CHECK constraints on `availableBalance >= 0`, `processingAmount >= 0`, and `deficitLiability >= 0`. Registered in `deployment-compatibility.json`.
  8. Created React error boundaries (`AdminErrorBoundary.tsx`, mobile `ErrorBoundary.tsx`) wrapping root components in Next.js admin, customer mobile, and mobile-admin apps.
  9. Added visual role gating and informative alert banners in `BillVerificationModal.tsx`.
  10. Added `proxy_hide_header` for Next.js security headers in `nginx/nginx.conf`.
- **Verification Results:**
  - **Backend Suites:** 49 suites, 833 passed / 833 total (100% green, 0 failures).
  - **Admin Suites:** 2 suites, 22 passed / 22 total (100% green, 0 failures).
  - **Mobile Suites:** 5 suites, 29 passed / 29 total (100% green, 0 failures).
  - **Mobile Admin Suites:** 6 suites, 32 passed / 32 total (100% green, 0 failures).
  - **Migration Compatibility Tests:** 1 suite, 6 passed / 6 total (100% green).
  - **Deployment Health Tests:** 1 suite, 61 passed / 61 total (100% green).
  - **Security Floor Tests:** 1 suite, 22 passed / 22 total (100% green).
  - **Workspace Subtotal:** **916 / 916 passed across 62 test files**.
  - **Repository Total:** **1,005 / 1,005 tests passing across 65 suites (100% green, 0 failures)**.
- **Date:** October 2026
- **Finding Identifiers:**
  - `DEFECT-VERIF-01` / `SEC-AUTH-01`: Logout Contract F Compliance on Missing Credentials (HTTP 400)
  - `DEFECT-VERIF-02` / `SEC-AUTH-02`: Admin Lockout Status & Error Message Preservation (HTTP 423)
  - `DEFECT-VERIF-03` / `FIN-01`: Redemption Scheduling Fail-Closed Timestamp Validation
  - `AUDIT-FIN-01`: Safe In-Flight Payout Rejection Prevention on Gateway Inquiry Ambiguity
  - `VULN-MOB-BIO-01`: Server-Side Password Verification on Mobile Redemption Biometric Fallback
  - `FEAT-MOB-RED-01`: Mobile UI ₹50,000 Hard Redemption Ceiling Clamp
  - `VULN-ADM-URL-01`: Admin Document URL Sanitizer Hostname Whitelist Parity
  - `AUDIT-DEL-01`: Legal Hold Pre-Check Ordering in Account Deletion Before Cloudflare R2 Purge
  - `FIN-02`: Admin Maximum Redemption Setting Support for ₹0 Disablement
  - `SEC-ROLE-01`: Strict Separation of Duties on Bill Rejection and Cancellation Actions
  - `PERF-DB-01`: Case-Insensitive Functional Unique Index for Approved Invoices
  - `STAT-PURGE-01`: Cloudflare R2 Document Purge & Safe `fileKey` Handling in Statutory Purge
- **Affected Subsystems:** Backend API, Authentication Services, Payout & Ledger Services, Account Deletion Engine, Admin Web Portal, Customer Mobile App, PostgreSQL Migrations
- **Implementation Approach:**
  1. Updated `backend/src/routes/auth.routes.ts` to inspect incoming credentials on `POST /api/auth/logout`. Rejects unauthenticated requests lacking refresh tokens with HTTP 400 (`No active session or refresh token provided`).
  2. In `backend/src/services/auth.service.ts`, ensured `requestAdminOtp` re-checks `admin.lockedUntil` and throws HTTP 423 `Account is temporarily locked. Try again later.`.
  3. In `backend/src/routes/admin.routes.ts`, added fail-closed validation when `isEnabled: true` is sent on redemption settings without valid `startAt` and `endAt` timestamps.
  4. In `backend/src/services/payout.service.ts`, prevented rejection of in-flight `PAYOUT_INITIATED` disbursements when gateway returns `found: false`, unless flagged for manual review (`requiresManualReview: true`), preventing double-refund exploits.
  5. In `backend/src/routes/payout.routes.ts` and `mobile/src/components/RedemptionModal.tsx`, implemented server-side password verification when mobile clients fall back from biometric authentication.
  6. In `mobile/src/components/RedemptionModal.tsx`, clamped initial redemption amount to `Math.min(balance, 50000)`.
  7. In `admin/src/lib/financial-utils.ts`, added active production hostname `hsspl.algions.in` and `*.r2.dev` to `ALLOWED_DOMAINS` in `safeDocumentUrl`.
  8. In `backend/src/services/account-deletion.service.ts`, placed `user.legalHold` assertion prior to executing external R2 file deletions.
  9. In `backend/src/routes/admin.routes.ts` and `admin/src/pages/settings.tsx`, allowed ₹0 maximum redemption setting to cleanly disable redemptions and removed HTML5 `required` attribute.
  10. In `backend/src/routes/admin.routes.ts`, strictly enforced `requireRole(['BILL_ADMIN'])` on `/bills/:id/reject` and `requireRole(['OPERATIONS_ADMIN'])` on `/bills/:id/cancel`.
  11. Created migration `20261023120000_add_lower_invoice_index` adding functional unique index `CREATE UNIQUE INDEX IF NOT EXISTS "Bill_lower_invoice_number_approved_idx" ON "Bill" (LOWER(TRIM("invoiceNumber"))) WHERE "status" = 'APPROVED'`. Registered in `deployment-compatibility.json`.
  12. In `backend/src/services/account-deletion.service.ts`, purged files from R2 during 8-year statutory expiry and updated `fileKey: 'PURGED'` safely.
- **Verification Results:**
  - **Backend Suites:** 48 suites, 820 passed / 820 total (100% green, 0 failures).
  - **Admin Suites:** 2 suites, 22 passed / 22 total (100% green).
  - **Mobile Suites:** 5 suites, 29 passed / 29 total (100% green).
  - **Mobile Admin Suites:** 6 suites, 32 passed / 32 total (100% green).
  - **Migration Compatibility Tests:** 1 suite, 6 passed / 6 total (100% green).
  - **Deployment Health Tests:** 1 suite, 61 passed / 61 total (100% green).
  - **Security Floor Tests:** 1 suite, 22 passed / 22 total (100% green).
  - **Workspace Subtotal:** **903 / 903 passed across 61 test files**.
  - **Repository Total:** **992 / 992 tests passing across 64 suites (100% green, 0 failures)**.
