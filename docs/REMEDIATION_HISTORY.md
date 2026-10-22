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
