# Changelog
All notable changes to the **Hiralal and Sons Rewards & Incentive Platform** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.5.0] - 2026-10-31

### Master Forensic Audit Remediations & Production Release Certification
- **Invoice Identity & Database Engine (`HIR-TRIGGER-01`, `HIR-RT-01`, `HIR-TRIGGER-02`, `HIR-AUDIT-01`, `HIR-INDEX-01`, `HIR-CONCUR-01`, `HIR-MIG-01`)**:
  - Deployed Migration 39 (`20261101120000_fix_trigger_execution_order_and_audit_truncate`):
    - Defensively populates `invoicePeriod` and `invoiceKey` inside `check_bill_invoice_submission_allowed()` trigger to eliminate alphabetical trigger execution order bypass on invoice creation.
    - Added leading-zero stripping (`([A-Z]+)0+([1-9][0-9]*) -> \1\2`) across database trigger and runtime TypeScript normalization (`normalizeInvoiceKey`).
    - Expanded submission check trigger `UPDATE OF` clause to include `invoiceNumber` and `invoiceDate`.
    - Added statement-level `BEFORE TRUNCATE` trigger `prevent_audit_log_truncate()` on `AuditLog` table.
    - Dropped redundant duplicate indexes `KycRecord_panBlindIndex_idx` and `PaymentAccount_beneficiaryBlindIndex_idx`.
    - Acquired transaction-scoped advisory locks on invoice identity keys in `rejectBill` and `cancelBill`.
    - Synchronized `deployment-compatibility.json` manifest with 100% test coverage.
- **Mobile Application & Client Security (`SEC-MOB-01`, `DEFECT-ADMIN-01`, `DEFECT-ADMIN-02`, `DEFECT-ADMIN-03`)**:
  - Injected `withSecureWindow` (Android `FLAG_SECURE`) into Customer Mobile application to block screenshots and screen capture of sensitive craftsman data.
  - Hardened document URL allowlist regex in mobile admin to strictly reject hyphen-separated subdomain lookalike attacks (`DEFECT-ADMIN-01`).
  - Decoupled action gating in Admin web verification modal: `canApprove`, `canReject` (`BILL_ADMIN`), and `canCancel` (`OPERATIONS_ADMIN`).
  - Added "Disqualify / Cancel" action modal and button strictly authorized for `OPERATIONS_ADMIN` in Mobile Admin (`BillReviewScreen.tsx`).
- **Host Hardening & Infrastructure (`INFRA-01`, `INFRA-02`, `INFRA-03`)**:
  - Updated Fail2ban SSH jail configuration in KVM provisioning script to use `backend = systemd` for Ubuntu 24.04 compatibility.
  - Mounted `/var/log/hiralal/nginx:/var/log/nginx` volume and added `copytruncate` in `deploy/logrotate/hiralal-logs.conf` for CERT-In 180-day audit retention compliance.
  - Added `HIRALAL_IMAGE_TAG=latest` to `.env.production.example`.
- **Integrations, Accounting & False-Confidence Elimination (`DEFECT-INT-01`, `DEFECT-FIN-01`, `DEFECT-FIN-02`, `GAP-FIN-01`, `TEST-GAP-02`, `TEST-GAP-04`, `TEST-GAP-05`)**:
  - Supported text-only WhatsApp OTP delivery via `WHATSAPP_AUTH_BUTTON_TYPE=NONE`.
  - Implemented integer paise reverse GST arithmetic in admin preview matching backend `GstService`.
  - Permitted 0.00% reward rates in `money.utils.ts` and `reward-rule.service.ts` without throwing runtime exceptions.
  - Replaced dummy local self-test closure in `adminAuth.test.js` with authoritative `validateAdminRole` module.
  - Eliminated empty try/catch in `wave7_audit_remediation_regression.spec.ts`, replacing with explicit Jest reject assertions.
  - Enforced test database isolation guard (`assertSafeTestDatabase`) in test runner setup.
- **Legal Compliance & Living Documentation (`PRIV-RISK-01`, `DR-01`, `DR-02`, `DR-04`, `DR-06`, `DR-07`, `DR-12`)**:
  - Upgraded legal document `REVIEW_STATUS` in `documents.ts` to `'APPROVED'`.
  - Synchronized `docs/API_DOCUMENTATION.md` with registration consent schemas, mandatory redemption password, and KYC/payment/legal/reward endpoint specifications.
  - Synchronized environment templates with legal contact variables and replaced short admin prefix examples with 16+ character high-entropy generation instructions.

## [2.4.0] - 2026-10-23

### Wave 7 & Wave 8 Master Code Audit Remediations & Security Hardening
- **Role Isolation & Authorization (`VULN-AUTH-01`, `REDTEAM-01`)**:
  - Enforced server-side document URL filtering in `GET /api/v1/admin/bills`, passing caller `userRole` to `BillService.getAdminBills` so `OPERATIONS_ADMIN` is prevented from accessing presigned URLs for standard bills.
  - Hardened dual-control secondary approval so that the administrator who performed primary verification on a bill or its parent revision cannot act as secondary approver.
- **Database & Concurrency Integrity (`FINDING-TX-01`, `FINDING-DB-01`, `FINDING-DB-02`)**:
  - Acquired `Wallet` row lock `FOR UPDATE` before reading `deficitLiability` in `BillService.approveBill`, eliminating stale deficit snapshot calculations and race-condition deadlocks.
  - Added forward-only migration `20261023230000_financial_and_bill_check_constraints` enforcing database-level `CHECK ("amount" > 0)` on `WalletTransaction`, `CHECK ("billAmount" > 0)` on `Bill`, and `CHECK ("calculatedReward" >= 0)` on `Bill`.
- **Worker & Reconciliation Hardening (`FINDING-WRK-01`, `FINDING-WRK-02`, `SEC-01`)**:
  - Prevented state-machine leaks in `PayoutWorker` on Razorpay setup compensation failures, ensuring failed attempts escalate to manual review and do not falsely complete outbox events.
  - Hardened `ReconciliationWorker` to escalate aged stuck payouts (> 20 mins) to manual review even if gateway credentials are unconfigured.
  - Included Cloudflare R2 credentials in production startup validation for `SERVICE_ROLE=worker` to guarantee erasure compliance.
- **Account Deletion & Data Privacy (`FINDING-RET-01`, `FINDING-RET-02`)**:
  - Account deletion clears `AppInstallation` user links and push tokens. (Corrected 2026-10-30: the records were not purged at the time; they are deleted since the Phase 2–6 audit remediation.)
  - Implemented automated `WALLET_FORFEITURE` ledger adjustments to settle remaining available balances upon confirmed deletion.
- **Client & Infrastructure Parity (`VULN-FRONT-01`, `VULN-MOB-01`, `VULN-MOB-02`, `VULN-INFRA-01`, `VULN-BUILD-01`)**:
  - Made role authorization fail-closed in `BillVerificationModal.tsx` and gated Reject/Cancel triggers.
  - Enforced password length >= 8, PAN/IFSC/Account regex, and mobile admin review button authorization.
  - Added domain allowlist to mobile `resolveDocumentUrl` and re-emitted `Permissions-Policy` in Nginx.
  - Synchronized living documentation; verified 100% test pass rate across 949 workspace tests and 1,038 repository-wide verified tests (68 suites, 0 failures).
- **Client Security & Device Hardening (Developer Options & USB Debugging Lockout)**:
  - Implemented native `SecurityModule.java` and `SecurityPackage.java` detecting active `DEVELOPMENT_SETTINGS_ENABLED` or `ADB_ENABLED` on Android devices.
  - Added full-screen, non-dismissible `DeveloperModeBlocker.tsx` with direct deep linking to Android Settings (`Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS`).
  - Added lifecycle-aware `AppState` re-verification dynamically unblocking the app when the user returns from Settings with developer options disabled.
  - Built Expo config plugin `withDeveloperModeSecurity.js` preserving native bridge across `npx expo prebuild`.
  - Added `__DEV__` bypass ensuring local development and USB debugging with Metro / Expo Go remain frictionless.

## [2.3.0] - 2026-10-23

### Wave 6 Comprehensive Audit Remediation & Hardening
- **Auth & Session Security (`DEFECT-VERIF-01`, `DEFECT-VERIF-02`, `VULN-MOB-BIO-01`)**:
  - Enforced Contract F compliance on `POST /api/auth/logout`, returning HTTP 400 when invoked without an active session or refresh token.
  - Aligned admin lockout error messaging on `requestAdminOtp`, preserving HTTP 423 `Account is temporarily locked. Try again later.`.
  - Added server-side password verification for mobile app biometric fallback during redemption confirmation.
- **Financial Controls & Payout Rails (`DEFECT-VERIF-03`, `AUDIT-FIN-01`, `FIN-02`, `FEAT-MOB-RED-01`)**:
  - Implemented fail-closed validation for redemption scheduling windows when `isEnabled: true` is requested without timestamps.
  - Disallowed administrative rejection of in-flight `PAYOUT_INITIATED` disbursements on gateway `found: false` unless explicitly flagged for manual review, preventing double-refund exploits.
  - Allowed configuring ₹0 maximum redemption amount to cleanly disable redemptions; removed HTML5 `required` attribute from admin settings UI.
  - Clamped initial redemption amount in customer mobile app to `Math.min(balance, 50000)`.
- **Database & Data Retention Integrity (`PERF-DB-01`, `AUDIT-DEL-01`, `STAT-PURGE-01`, `SEC-ROLE-01`)**:
  - Added lowercase trimmed functional unique index `Bill_lower_invoice_number_approved_idx` on `Bill (LOWER(TRIM("invoiceNumber"))) WHERE "status" = 'APPROVED'`.
  - Enforced pre-flight `user.legalHold` check and database transaction lock before executing external Cloudflare R2 file deletions during account deletions.
  - Purged invoice documents from Cloudflare R2 during 8-year statutory retention expiry and updated `fileKey: 'PURGED'` safely under transaction.
  - Enforced strict separation of duties on `/bills/:id/reject` (`BILL_ADMIN` only) and `/bills/:id/cancel` (`OPERATIONS_ADMIN` only).
- **Admin UI & Documentation Truth (`VULN-ADM-URL-01`)**:
  - Added active production hostname `hsspl.algions.in` and `*.r2.dev` to `ALLOWED_DOMAINS` in `safeDocumentUrl`.
  - Added `setLegalHold` button and client method in web admin portal.
  - Synchronized all 7 living documentation files; verified 100% test pass rate across 903 workspace tests and 992 repository-wide verified tests (0 failures).

## [2.2.0] - 2026-10-22

### Build, CI & Type Safety (F-01, F-02, F-24)
- **Mobile Admin TypeScript Compilation (`F-01`)**: Resolved TypeScript union mismatch in `mobile-admin/App.tsx` by importing and typing `opsAdminTab` as `OpsAdminTab` (`'DASHBOARD' | 'BILLS' | 'USERS' | 'PAYOUTS' | 'MORE'`).
- **CI Pipeline Typecheck Integration (`F-02`)**: Added `Mobile Admin TypeScript Typecheck` step (`npx tsc --noEmit`) to `.github/workflows/ci.yml` and added `"typecheck": "tsc --noEmit"` to `mobile-admin/package.json`.
- **Mobile Admin Test Registration (`F-24`)**: Registered `plugins/dateUtils.test.js` in `mobile-admin/package.json` test script, bringing suite to 32 passing unit tests.

### Financial Integrity & Hard Invariants (F-03, F-04, F-07, F-13, F-16)
- **Wallet Non-Negative Check & Deficit Liability Modeling (`F-07`)**: Re-added PostgreSQL check constraint `chk_wallet_available_balance_non_negative` on `Wallet` (`availableBalance >= 0`) and added `deficitLiability Decimal(12, 2)` column in migration `20261022210000`. Delayed gateway reconciliation liabilities are recorded to `deficitLiability` without driving `availableBalance` negative.
- **Partial Settings Update Validation (`F-03`)**: `PUT /settings/redemption` pre-fetches existing settings to enforce $min \le max$ across partial updates and preserves `isEnabled` state.
- **Mobile Admin Maximum Redemption UI (`F-04`)**: Added maximum redemption configuration input to `mobile-admin/src/screens/OpsAdminMoreScreen.tsx` bounded between ₹0 and ₹50,000, passing `maximumRedemptionAmount` in API updates.
- **Daily Payout Limit Eligibility Evaluation (`F-13`)**: `PayoutService.checkUserEligibility()` now calculates daily disbursements in `Asia/Kolkata` IST and returns `canRedeem = false` when the ₹50,000 daily quota is reached.
- **Single Payout Gateway Drift Clawback (`F-16`)**: `reconcileSinglePayout()` detects terminal local states (`FAILED` / `REVERSED`) on processed payouts and triggers standard financial drift clawback via `PayoutService.handleFinancialDriftClawback()`.

### Security, Concurrency & Access Control (F-05, F-06, F-08, F-12, F-14, F-15, F-18, F-21)
- **Separation of Duties in Bill Verification (`F-05`)**: Standard non-deviated invoices require `BILL_ADMIN` review. High-deviation invoices require secondary `OPERATIONS_ADMIN` approval, with mandatory verification that the secondary approver is distinct from the primary verifier (`secondaryApprovedByAdminId !== verifiedByAdminId`).
- **Expanded Advisory Locks on Invoices (`F-06`)**: `BillService.submitBill` computes file hash before holding PostgreSQL advisory locks across duplicate check, R2 upload, and DB creation within a single transaction, preventing orphaned storage uploads and race conditions.
- **Dashboard Authorization Guard (`F-08`)**: Fixed client-side role guard in `admin/src/pages/_app.tsx` so unauthorized roles visiting root `/` are redirected to `/login` with tokens cleared.
- **Row-Level Lock on Statutory Purge (`F-12`)**: `AccountDeletionService.purgeExpiredStatutoryRecords` locks candidate users with `SELECT "id" FROM "User" ... FOR UPDATE` before scrubbing records.
- **Admin Lockout Timing Oracle Defense (`F-14`)**: `AuthService.requestAdminOtp` evaluates cost-12 dummy bcrypt hash comparison on locked accounts before throwing, returning generic credentials error in API response.
- **Legal Hold Management Endpoint (`F-15`)**: Added `PATCH /api/v1/admin/users/:id/legal-hold` restricted to `OPERATIONS_ADMIN` requiring a mandatory justification reason and logging to `AuditLog`.
- **Registration Hash Synchronization (`F-18`)**: Added `passwordSha256` and `verificationToken` to `normalizeRegistrationIntegrityPayload` in `mobile-admin/src/services/integrityRequestHash.ts`.
- **Designated Host Allowlist in Safe Document URLs (`F-21`)**: Restricted `safeDocumentUrl` in `admin/src/lib/financial-utils.ts` to designated Cloudflare R2 / AWS S3 storage hosts and authorized application domains.

### Web, Mobile & Documentation Truth (F-09, F-11, F-17, F-19, F-20, F-23)
- **Nginx CSP & Catch-All Hardening (`F-09`)**: Added `'unsafe-inline'` to CSP `script-src` in `nginx/nginx.conf` for Next.js hydration compatibility and configured port 443 `default_server` returning HTTP 444 for unrecognized Host headers.
- **Query Enum Synchronization (`F-17`)**: Replaced non-existent `'SUBMITTED'` status with `'PENDING'` in `ALLOWED_BILL_STATUSES` in `backend/src/routes/admin.routes.ts`.
- **Mobile Deep Linking & Biometric Fallback (`F-19`)**: Added `"scheme": "hiralal-rewards"` to `mobile/app.json`, deep-link routing in `mobile/App.tsx`, and account password confirmation fallback in `RedemptionModal.tsx` for devices without enrolled biometrics.
- **Timezone-Anchored Date Formatting (`F-20`)**: Passed `{ timeZone: 'Asia/Kolkata' }` to all `toLocaleDateString` and `toLocaleString` formatters across admin pages.
- **Regression Test Hardening (`F-23`)**: Replaced tautological assertions in `audit_remediation_rc1.spec.ts` with assertions on `PaymentType` enum, balance ceiling clamping (>₹50,000 retaining residual balance), partial update validation, and daily limit exhaustion.
- **Documentation Truth (`F-11`)**: Removed retired `/payouts/webhook` alias from `DEPLOYMENT_GUIDE.md` and `API_DOCUMENTATION.md`; clarified worker daemon architecture in `deploy/systemd/README.md`; updated repository test counts to 900 workspace / 989 total.

---

## [2.1.0] - 2026-10-21

### Critical Security & Financial Integrity
- **Exact Bank Name to PAN Matching (`NAME-MATCH-01`)**:
  - Replaced fuzzy matching (Jaro-Winkler similarity >= 0.75), subset matching, token swapping, initials expansion, and middle-name omissions with strict canonical string equality (`normAccount === normPan`).
  - Added strict prefix stripping for approved honorifics only (`MR`, `MRS`, `MS`, `DR`, `SHRI`, `SHREE`, `SRI`, `SMT`, `KUMARI`, `M/S`, `M.S.`) strictly when followed by whitespace.
  - Genuine syllables within names (e.g. `SRIDHAR`, `KUMAR`, `ANITA KUMARI`) are preserved.
  - Implemented comprehensive 21-case test suite in `exact_name_matching.spec.ts`.
- **Payout Worker State Machine Reversals (`VERIF-01` / `FIN-BUG-01`)**:
  - Implemented `PayoutService.failBeforeDispatch(payoutId, reason)` to safely transition payouts failing during pre-dispatch contact/fund account creation.
  - Acquired pessimistic row-level locks (`SELECT ... FOR UPDATE`) on the user's `Wallet` before debit/credit adjustments.
  - Integrated `queryGatewayByReference` to confirm absence of gateway-side transactions prior to in-flight rejections.
- **Mononymous KYC Name Lock (`VERIF-02` / `SEC-KYC-01`)**:
  - `POST /users/:id/verify-mononymous-kyc` now atomically locks the customer's name (`isNameLocked = true`).
  - `updateUserName` rejects any name change if `isNameLocked` is true or if verified KYC records exist.
- **Upward Bill Deviation Ceiling (`VERIF-03`)**:
  - Capped manual upward bill adjustments to `newAmount <= originalAmount * 1.5` with non-negative checks.
- **Reconciliation Worker Atomic CAS Leases & Invariant Checks (`VERIF-04` / `FIN-BUG-03`)**:
  - Added 60-second atomic Compare-And-Swap leases via `WebhookEvent.updateMany` to prevent concurrent race conditions.
  - Enforced strict currency (`INR`) and exact paise amount equality assertions against incoming gateway webhooks.
  - Double-entry `MANUAL_ADJUSTMENT` ledger transactions are now created if financial drift is detected.
- **RazorpayX Webhook Terminal State Regressions (`VERIF-05` / `VULN-FIN-01`)**:
  - Disallowed reversal state transitions on payouts that have already reached terminal states (`REJECTED`, `FAILED`).
- **GST Rule Snapshot Integrity (`VERIF-15`)**:
  - Atomically reset `selectedGstRuleId = null` and `effectiveGstRate = 0.0` when a bill is marked GST-excluded.

### Authentication & Authorization
- **Admin Prefix Oracle Elimination (`VERIF-06` / `SEC-ADM-03`)**:
  - Unified `resolveAdminIdentifier` to throw standardized error formats mapped to generic credential failures on HTTP endpoints, eliminating prefix enumeration.
- **Tier-1 Pre-Authentication Token Enforcement (`VERIF-07` / `SEC-ADM-01`)**:
  - Added `verifyTier1Token` requiring `X-Tier1-Token` on `/admin-portal/login` and `/admin/otp/request`.
  - Updated mobile admin application (`mobile-admin`) API client to pass `X-Tier1-Token`.
- **Role Boundary Separation (`VERIF-08` / `SEC-ADM-05`)**:
  - Re-enforced `requireBillAdmin` middleware exclusively on all bill review and verification endpoints.
- **Password Lockout Sliding Window (`VERIF-11`)**:
  - Implemented a 15-minute sliding window query (`clock.now - INTERVAL '15 minutes' THEN 1`) in PostgreSQL for failed password attempts.
- **Decoupled OTP Rate Limiting (`VERIF-12`)**:
  - Decoupled OTP attempt tracking into Redis sliding-window keys separate from the user password lockout state.

### Web, Storage & Infrastructure
- **Scoped Request Body Limits & CORS (`VERIF-09`, `VERIF-13`)**:
  - Enforced strict 100KB body limit globally, scoping 15MB exclusively to `POST /api/v1/bills`.
  - Added `x-tier1-token` and `x-client-type` to allowed CORS headers.
- **Cloudflare R2 Presigned Document Headers (`VERIF-10`)**:
  - Added explicit `ResponseContentType` and `inline` disposition parameters in S3 `GetObjectCommand`.
- **Safe Document URL Sanitization (`SEC-ADM-02`)**:
  - `safeDocumentUrl` decodes percent-encoded components (`%5C`, `%2F%2F`) before regex domain verification.
- **Database Schema Optimization & Constraints (`VERIF-14`, `VERIF-16`, `VERIF-17`)**:
  - Removed 12 redundant `@@index` annotations on `@unique` columns in `schema.prisma`.
  - Set `Wallet.user` relation to `onDelete: Restrict` to prevent accidental cascading deletion.
  - Overloaded `generateBlindIndex()` to return `null` on falsy strings to avoid duplicate key collisions.
- **DevOps Hardening (`INFRA-01` to `INFRA-05`)**:
  - Configured dynamic WebSocket upgrade mapping in `nginx.conf`.
  - Hardened `backup-db.sh` and `restore-db.sh` using ephemeral `chmod 600` `--env-file` rather than command-line credentials.
  - Added `iptables-persistent` to preserve Cloudflare firewall rules across reboots in `server-setup-kvm.sh`.
- **Mobile Cleanup (`MOB-01`)**:
  - Purged dead `adminPrefixes.ts` from the customer mobile package.

---

## [2.0.0] - 2026-10-15
- Initial production release for Hostinger KVM 2 VPS deployment.
- PostgreSQL 16 schema with Prisma ORM.
- Dynamic theme transformation for Plumbers and Tile Installers in customer mobile application.
- Two-tier admin architecture separating `BILL_ADMIN` and `OPERATIONS_ADMIN`.
- Integration with Meta WhatsApp Business Platform Cloud API for OTP transport.
- Integration with RazorpayX for automated payout disbursement.
- Integration with SignCare for PAN tax database verification.
- Encrypted document storage via Cloudflare R2 private bucket.
