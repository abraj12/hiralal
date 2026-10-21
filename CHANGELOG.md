# Changelog
All notable changes to the **Hiralal and Sons Rewards & Incentive Platform** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
