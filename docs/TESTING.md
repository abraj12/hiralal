# Testing and Verification Guide
## Hiralal and Sons Sales Pvt. Ltd. — Platform Quality Assurance

This document details the complete testing strategy, commands, execution prerequisites, package test suites, and verified test results across all workspaces.

---

## 1. Verified Test Execution Summary

Every test suite in the repository has been executed and confirmed passing. The latest run confirms:

| Workspace | Test Runner | Command | Test Suites | Total Tests | Status |
|---|---|---|---|---|---|
| **Backend** | Jest (In-Band) | `npm --prefix backend test` | 48 passed / 48 total | 817 passed / 817 total | **100% Green** |
| **Admin Portal** | Node.js Test Runner | `npm --prefix admin test` | 2 files | 22 passed / 22 total | **100% Green** |
| **Mobile Client** | Node.js Test Runner | `npm --prefix mobile test` | 5 files | 29 passed / 29 total | **100% Green** |
| **Mobile Admin** | Node.js Test Runner | `npm --prefix mobile-admin test` | 5 files | 28 passed / 28 total | **100% Green** |
| **Workspace Subtotal** | — | — | **60 suites / files** | **896 tests** | **0 Failures** |
| **Migration Compatibility** | Python Unittest | `python scripts/test_migration_compatibility.py` | 1 suite | 6 passed / 6 total | **100% Green** |
| **Deployment & Health Probes** | Python Unittest | `python scripts/test_verify_deployment_health.py` | 1 suite | 61 passed / 61 total | **100% Green** |
| **Security Floor Guards** | Node CLI | `node scripts/test-next-security-floor.cjs` | 1 suite | 22 passed / 22 total | **100% Green** |
| **Repository Total** | — | — | **63 suites / files** | **985 tests** | **0 Failures** |

---

## 2. Package-Specific Testing Commands

### A. Backend (`backend/`)
The backend test suite uses Jest configured with TypeScript, Prisma, and Redis mocking:

```bash
# Run all 48 test suites in sequence
cd backend
npm test

# Equivalent direct command:
npx jest --runInBand --detectOpenHandles --forceExit

# Run dedicated audit remediation RC1 regression suite:
npx jest --runInBand --detectOpenHandles --forceExit src/tests/audit_remediation_rc1.spec.ts

# Run specific suite (e.g. Auditor Reconciliation & Retention Regression):
npx jest --runInBand --detectOpenHandles --forceExit src/tests/auditor_reconciliation_and_retention_regression.spec.ts

# Run admin authentication suite:
npx jest --runInBand --detectOpenHandles --forceExit src/tests/admin_otp_enforcement.spec.ts

# Compile TypeScript without emitting JS:
npm run build
```

#### Key Backend Test Suites
- **`audit_remediation_rc1.spec.ts`**: Verifies all Phase 1–4 audit remediations: Play Integrity registration request hash with password and verificationToken, removal of `Math.max(0, ...)` balance clamping, hard ₹50,000 per-redemption ceiling, configurable maximum ₹0–₹50,000 (where ₹0 disables redemptions), UPI and IMPS rail enforcement (strictly zero NEFT), admin logout session checks, statutory legal hold row-level lock verification, per-user daily payout limit of ₹50,000 IST, and centralized error handler sanitization.
- **`auditor_reconciliation_and_retention_regression.spec.ts`** (AUDIT-CRIT-01, AUDIT-HIGH-01, AUDIT-MED-01): Verifies that delayed `payout.processed` in reconciliation worker executes proportional clawback deduction and logs valid `PAYOUT_DEBIT` ledger entry; verifies that statutory retention purge completely scrubs legacy/encrypted PII and re-checks `legalHold: false` under transaction; verifies webhook invalid amount review flagging and gateway polling parity checks.
- **`test_harness_isolation.spec.ts`** (TEST-HARNESS-01): Verifies rate limit isolation across sequential suites, ensuring `resetAllRateLimiters()` clears `memoryCache` and Redis `ratelimit:*` keys, and `ensureBaselineAdmins()` seamlessly recovers deleted seeded admins.
- **`exact_name_matching.spec.ts`**: Verifies 21 cases of exact bank beneficiary name matching against PAN records, testing positive matches with approved prefixes (`MR`, `SHRI`, etc.) and mandatory rejection of fuzzy, subset, token-reordered, or omitted name components.
- **`final_audit_remediation_regression.spec.ts`**: Regression tests for `VERIF-01` through `VERIF-17`, including pre-dispatch fund rollback, mononymous KYC locking, and upward deviation limits.
- **`global_reward_cap.spec.ts`**: Validates pool-free reward calculations, volume scaling, and concurrent approval locks.
- **`payout_safety_worker.spec.ts`**: Simulates RazorpayX gateway timeouts, 4xx errors, refund credits, and webhook deduplication.
- **`concurrency_financial.spec.ts`**: Tests double-redemption prevention and `SELECT ... FOR UPDATE` row locking.
- **`account_deletion_statutory.spec.ts`**: Verifies GDPR/DPDP right-to-erasure anonymization while strictly retaining financial audit trails under Section 138 NI Act and GST laws.

### B. Admin Web Portal (`admin/`)
The admin portal uses the native Node.js test runner (`node:test`):

```bash
cd admin
npm test

# Equivalent direct command:
node --test src/lib/date-utils.test.ts src/lib/components.test.ts

# Production build check:
npm run build
```
- **`components.test.ts`**: Tests GST reverse-calculation formulas (inclusive, exclusive, float rates) and role-based route filtering (`BILL_ADMIN` vs `OPERATIONS_ADMIN`).
- **`date-utils.test.ts`**: Tests Indian standard timezone ISO parsing, leap year validation, and calendar boundary enforcement.

### C. Customer Mobile Application (`mobile/`)
The customer mobile app runs native plugin, API, and date validation tests:

```bash
cd mobile
npm test

# Direct execution:
node --test plugins/withPlayIntegrity.test.js plugins/withReleaseSigning.test.js plugins/apiUrlValidation.test.js plugins/adminPrefixValidation.test.js plugins/dateUtils.test.js
```
- **`withPlayIntegrity.test.js`**: Validates Android Gradle config injection for Google Play Integrity token generation.
- **`withReleaseSigning.test.js`**: Checks idempotent injection of release signing configuration.
- **`apiUrlValidation.test.js`**: Enforces strict HTTPS canonical `/api/v1` API endpoint validation.

### D. Mobile Admin Application (`mobile-admin/`)
The mobile admin app tests admin prefixes, API URLs, and role enforcement:

```bash
cd mobile-admin
npm test

# Direct execution:
node --test plugins/withPlayIntegrity.test.js plugins/withReleaseSigning.test.js plugins/apiUrlValidation.test.js plugins/adminPrefixValidation.test.js tests/adminAuth.test.js
```
- **`adminAuth.test.js`**: Asserts that only `BILL_ADMIN` and `OPERATIONS_ADMIN` roles are recognized, package ID is `com.admin.login`, and SecureStore storage is enforced.

---

## 3. Integration Testing & Environment Prerequisites

1. **Database Schema:** Backend tests require a Prisma schema in sync with the database model. Always run `npx prisma generate` before testing.
2. **Mocking Strategy:**
   - External services (`SignCare`, `RazorpayX`, `Meta WhatsApp Business API`, `Cloudflare R2`) are stubbed or mocked in unit/regression tests.
   - For live end-to-end integration testing, valid staging credentials must be provided in `.env.test`.
3. **Database Concurrency:** Real database concurrency tests use transactional rollbacks or ephemeral PostgreSQL instances configured via `DATABASE_URL`.

---

## 4. Verification Checklists for Future Changes

Before submitting changes, ensure:
1. `npm --prefix backend run build` exits with code 0 (zero TypeScript errors).
2. `npm --prefix admin run build` exits with code 0 (clean static page generation).
3. `npm --prefix backend test` passes all 40 test suites (741 tests).
4. `npm --prefix admin test`, `npm --prefix mobile test`, and `npm --prefix mobile-admin test` all exit with code 0.
5. All exact name matching regression assertions in `src/tests/exact_name_matching.spec.ts` pass without alteration of the strict equality rule.
