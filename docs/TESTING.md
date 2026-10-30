# Testing and Verification Guide
## Hiralal and Sons Sales Pvt. Ltd. — Platform Quality Assurance

This document details the complete testing strategy, commands, execution prerequisites, package test suites, and verified test results across all workspaces.

---

## 1. Verified Test Execution Summary

Every test suite in the repository has been executed and confirmed passing. The latest run confirms:

| Workspace | Test Runner | Command | Test Suites | Total Tests | Status |
|---|---|---|---|---|---|
| **Backend** | Jest (In-Band) | `npm --prefix backend test` | 51 passed / 51 total | 855+ passed | **100% Green** |
| **Admin Portal** | Node.js Test Runner | `npm --prefix admin test` | 2 files | 22 passed / 22 total | **100% Green** |
| **Mobile Client** | Node.js Test Runner | `npm --prefix mobile test` | 8 files | 49 passed / 49 total | **100% Green** |
| **Mobile Admin** | Node.js Test Runner | `npm --prefix mobile-admin test` | 7 files | 40 passed / 40 total | **100% Green** |
| **Workspace Subtotal** | — | — | **68 suites / files** | **966+ tests** | **0 Failures** |
| **Migration Compatibility** | Python Unittest | `python scripts/test_migration_compatibility.py` | 1 suite | 6 passed / 6 total | **100% Green** |
| **Deployment & Health Probes** | Python Unittest | `python scripts/test_verify_deployment_health.py` | 1 suite | 61 passed / 61 total | **100% Green** |
| **Security Floor Guards** | Node CLI | `node scripts/test-next-security-floor.cjs` | 1 suite | 22 passed / 22 total | **100% Green** |
| **Repository Total** | — | — | **68 suites / files** | **1,038 tests** | **0 Failures** |

---

## 2. Package-Specific Testing Commands

### A. Backend (`backend/`)
The backend test suite uses Jest configured with TypeScript, Prisma, and Redis mocking:

```bash
# Run all backend test suites in sequence
cd backend
npm test

# Test database target configuration (HIR-AUD-P2-06):
# Test execution strictly requires a database ending in "_test" to protect development data.
# The test runner automatically defaults to "hiralal_rewards_test" or reads TEST_DATABASE_URL / .env.test.
# To initialize or sync the test database:
DATABASE_URL="postgresql://postgres:1234@localhost:5432/hiralal_rewards_test?schema=public" npx prisma migrate deploy

# Run dedicated audit remediation RC1 regression suite:
npm test src/tests/audit_remediation_rc1.spec.ts

# Run invoice reservation and lifecycle regression suite (HIR-AUD-P2-07):
npm test src/tests/invoice_reservation_and_lifecycle.spec.ts

# Run admin authentication suite:
npm test src/tests/admin_otp_enforcement.spec.ts

# Compile TypeScript without emitting JS:
npm run build
```

#### Key Backend Test Suites
- **`wave8_audit_remediation_regression.spec.ts`**: Verifies Wave 8 audit remediations: separation of bill revision approver from primary reviewer (dual-control approval), isolation of signed bill document access to authorized users, fail-closed worker compensation error handling, SMS failure OTP cooldown reset, forfeiture of remaining wallet balance on account deletion, and strict bill amount positivity validation.
- **`wave7_audit_remediation_regression.spec.ts`**: Verifies Wave 7 audit remediations: clamping 100% full balance redemptions strictly to remaining daily allowance (`dailyRemaining`), rejecting scientific notation and leading signs in redemption settings, normalization of null settings to ₹50,000 platform ceiling, automatic deficit liability offset on bill approval with `DEFICIT_RECOVERY` ledger logging, role segregation restricting Operations Admin on invoice signed document access, push device token input validation, and prevention of duplicate pending mononymous KYC records.
- **`audit_remediation_rc1.spec.ts`**: Verifies all Phase 1–4 audit remediations: Play Integrity registration request hash with password and verificationToken, removal of `Math.max(0, ...)` balance clamping, hard ₹50,000 per-redemption ceiling, configurable maximum ₹0–₹50,000 (where ₹0 disables redemptions), UPI and IMPS rail enforcement (strictly zero NEFT), admin logout session checks, statutory legal hold row-level lock verification, per-user daily payout limit of ₹50,000 IST, and centralized error handler sanitization.
- **`auditor_reconciliation_and_retention_regression.spec.ts`** (AUDIT-CRIT-01, AUDIT-HIGH-01, AUDIT-MED-01): Verifies that delayed `payout.processed` in reconciliation worker executes proportional clawback deduction and logs valid `PAYOUT_DEBIT` ledger entry; verifies that statutory retention purge completely scrubs legacy/encrypted PII and re-checks `legalHold: false` under transaction; verifies webhook invalid amount review flagging and gateway polling parity checks.
- **`test_harness_isolation.spec.ts`** (TEST-HARNESS-01): Verifies rate limit isolation across sequential suites, ensuring `resetAllRateLimiters()` clears `memoryCache` and Redis `ratelimit:*` keys, and `ensureBaselineAdmins()` seamlessly recovers deleted seeded admins.
- **`exact_name_matching.spec.ts`**: Verifies 21 cases of exact bank beneficiary name matching against PAN records, testing positive matches with approved prefixes (`MR`, `SHRI`, etc.) and mandatory rejection of fuzzy, subset, token-reordered, or omitted name components.
- **`final_audit_remediation_regression.spec.ts`**: Regression tests for `VERIF-01` through `VERIF-17`, including pre-dispatch fund rollback, mononymous KYC locking, and upward deviation limits.
- **`global_reward_cap.spec.ts`**: Validates pool-free reward calculations, volume scaling, and concurrent approval locks.
- **`payout_safety_worker.spec.ts`**: Simulates RazorpayX gateway timeouts, 4xx errors, refund credits, and webhook deduplication.
- **`concurrency_financial.spec.ts`**: Tests double-redemption prevention and `SELECT ... FOR UPDATE` row locking.
- **`account_deletion_and_threshold.spec.ts`**: Verifies GDPR/DPDP right-to-erasure anonymization while strictly retaining financial audit trails required by tax and accounting record-keeping law (see docs/DATA_RETENTION.md).

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
node --test plugins/withPlayIntegrity.test.js plugins/withReleaseSigning.test.js plugins/withDeveloperModeSecurity.test.js plugins/apiUrlValidation.test.js plugins/adminPrefixValidation.test.js plugins/dateUtils.test.js plugins/securityService.test.js
```
- **`withDeveloperModeSecurity.test.js`**: Validates Expo config plugin injection for Android Developer Options and USB debugging security module and package.
- **`securityService.test.js`**: Verifies development bypass (`__DEV__`), non-Android platform isolation, fail-safe error handling, and intent triggers.
- **`withPlayIntegrity.test.js`**: Validates Android Gradle config injection for Google Play Integrity token generation.
- **`withReleaseSigning.test.js`**: Checks idempotent injection of release signing configuration.
- **`apiUrlValidation.test.js`**: Enforces strict HTTPS canonical `/api/v1` API endpoint validation.

### D. Mobile Admin Application (`mobile-admin/`)
The mobile admin app tests admin prefixes, API URLs, and role enforcement:

```bash
cd mobile-admin
npm test

# Direct execution:
node --test plugins/withPlayIntegrity.test.js plugins/withReleaseSigning.test.js plugins/apiUrlValidation.test.js plugins/adminPrefixValidation.test.js plugins/dateUtils.test.js tests/adminAuth.test.js
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
3. `npm --prefix backend test` passes all 48 test suites (820 tests).
4. `npm --prefix admin test`, `npm --prefix mobile test`, and `npm --prefix mobile-admin test` all exit with code 0.
5. All exact name matching regression assertions in `src/tests/exact_name_matching.spec.ts` pass without alteration of the strict equality rule.
