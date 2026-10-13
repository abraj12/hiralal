# HIRALAL & SONS REWARDS PLATFORM
## MASTER ENGINEERING REMEDIATION V4 & V4.1 — SECURITY CLOSURE, CONCURRENCY HARDENING, GST CONSISTENCY & DEPLOYMENT SAFETY REPORT

**Date:** 2026-10-14  
**Auditor / Engineer:** Principal Full-Stack Engineer, Application Security Engineer, PostgreSQL Reliability Engineer & DevSecOps Lead  
**Repository:** `https://github.com/abraj12/hiralal`  
**Working Branch:** `audit/deploy-workflow-investigation`  
**Base Protected Main Commit (Untouched & Immutable):** `b90136ccc046dbc1f3f50f3e0993cb1c21375789`  
**Baseline Commit (V3 tip):** `3c39de42e47881790a2b7b62973b00eeb0e57c06`  
**V4 Commit:** `efb761905276fcc94bb4eb9a298cbafc3e91ebfc`  
**Production API Endpoint:** `https://hsspl.algions.in/api/v1`  
**Production Admin Portal:** `https://hsspl.algions.in`  
**Client:** HIRALAL AND SONS SALES PVT. LTD.  
**Software Developer:** ALGIONS AI LABS PRIVATE LIMITED  

---

## 1. Executive Summary & Verification Matrix

In Phase V4 and V4.1 remediation passes, all outstanding security, concurrency, deployment, and fiscal accounting findings were systematically addressed and verified with comprehensive regression tests. Every fix is implemented in production code with zero regressions across the existing test suites.

### Findings Remediated in V4 & V4.1

| ID | Priority | Description | Implementation Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **HIR-V4-01** | **P0 — Critical** | Close generic-OTP routes creating administrator verification tokens without password-first validation. | **FULLY REMEDIATED** | `admin_otp_enforcement.spec.ts` (13 new tests, 25 total) |
| **HIR-V4-02** | **P1 — High** | Concurrency-safe password lockout across worker login and administrator password-first OTP requests. | **FULLY REMEDIATED** | `auth_lockout_concurrency.spec.ts` (4 deterministic race tests) |
| **HIR-V4-03** | **P2 — Medium** | Validate and normalize `TARGET_SHA` inside remote EC2 deployment script before any directory creation or path manipulation. | **FULLY REMEDIATED** | `test_verify_deployment_health.py` (3 new tests, 61 total) |
| **HIR-V4-04** | **P2 — Medium** | Consistent zero-rate GST behavior throughout rule creation, reverse GST calculations, and bill approval. | **FULLY REMEDIATED** | `gst_zero_rate_consistency.spec.ts` (13 comprehensive tests) |
| **HIR-V4.1-01** | **P0 — Critical** | Enforce administrator account lockout inside `AuthService.verifyAdminOtp` using PostgreSQL row locks (`FOR UPDATE OF u`) with consistent lock ordering before session issuance. Fails closed under lockout, invalidating unconsumed challenges/OTPs without resetting lockout counters. | **FULLY REMEDIATED** | `auth_lockout_concurrency.spec.ts` (4 new tests, 8 total) |
| **HIR-V4.1-02** | **P1 — High** | Strict GST rate & rule input validation at HTTP (`POST /settings/gst-rules`, `PATCH /settings/gst-rules/:id`) and Service (`GstService.createGstRule`) boundaries with `parseStrictGstRate()`. Enforces strict boolean `isDefault` validation and atomic rule creation. | **FULLY REMEDIATED** | `gst_zero_rate_consistency.spec.ts` (17 new tests, 30 total) |
| **HIRALAL-GST-02** | **P2 — Medium** | Canonical calculation result shape contract: `calculateGstAndEligibleAmount()` returns `{ grossBillAmount, gstIncluded: false, gstRate: null, gstAmount: 0, eligibleRewardAmount: grossBillAmount }` whenever `gstIncluded === false`. | **FULLY REMEDIATED** | `gst_zero_rate_consistency.spec.ts` & `p0_remediation_integrity.spec.ts` |

---

### Verification Summary Table

| Verification Domain | Exact Command | Execution Result | Observed Details |
| :--- | :--- | :--- | :--- |
| **Full Backend Test Suite** | `npm --prefix backend test -- --runInBand` | **PASS (35 / 35 test suites)** | **619 / 619 tests passing (100% green)** |
| **Admin OTP Enforcement Suite** | `npm --prefix backend test -- src/tests/admin_otp_enforcement.spec.ts` | **PASS (1 / 1 suite)** | **25 / 25 tests passing** (HIR-V4-01 allowlist & bypass defense) |
| **Auth Lockout Concurrency Suite** | `npm --prefix backend test -- src/tests/auth_lockout_concurrency.spec.ts` | **PASS (1 / 1 suite)** | **8 / 8 tests passing** (HIR-V4-02 & HIR-V4.1-01 row-locked race tests A through H) |
| **GST Zero-Rate Consistency Suite** | `npm --prefix backend test -- src/tests/gst_zero_rate_consistency.spec.ts` | **PASS (1 / 1 suite)** | **30 / 30 tests passing** (HIR-V4-04 & HIR-V4.1-02 strict validation, atomicity, route auth & canonical shape) |
| **P0 Remediation Integrity Suite** | `npm --prefix backend test -- src/tests/p0_remediation_integrity.spec.ts` | **PASS (1 / 1 suite)** | **21 / 21 tests passing** (GST precision, canonical shapes, redemption caps eliminated) |
| **Master Requirements Compliance Suite** | `npm --prefix backend test -- src/tests/master_requirements_compliance.spec.ts` | **PASS (1 / 1 suite)** | **22 / 22 tests passing** (GST fail-closed & 0% rate tests) |
| **Deployment & Rollback Health** | `python -m unittest scripts/test_verify_deployment_health.py` | **PASS (Exit 0)** | **61 / 61 tests passing** (TARGET_SHA static ordering & path harness) |
| **Next.js Security Floor** | `node scripts/test-next-security-floor.cjs` | **PASS (Exit 0)** | **22 / 22 tests passing** (Next.js 15.5.27 complies with GHSA-vcvr-r3jv-pc5j) |
| **Admin Portal Unit Tests** | `npm --prefix admin test` | **PASS (1 / 1 suite)** | **9 / 9 tests passing** (`date-utils.test.ts`) |
| **Admin Portal Next.js Build** | `npm --prefix admin run build` | **PASS (Exit 0)** | Clean Next.js 15.5.27 production build: 11 static pages generated |
| **Mobile Client Tests** | `npm --prefix mobile test` | **PASS (4 / 4 suites)** | **24 / 24 tests passing** (`node --test`) |
| **Mobile TypeScript Typecheck** | `npx --prefix backend tsc -p mobile --noEmit` | **PASS (Exit 0)** | 0 type errors across all mobile components and services |
| **Backend TypeScript Build** | `./backend/node_modules/.bin/tsc -p backend --noEmit` | **PASS (Exit 0)** | 0 compilation errors across backend services, routes, and tests |

---

## 2. Technical Remediation Breakdown

### 2.1 HIR-V4-01: Generic OTP Route Allowlist & Admin Verification Token Bypass Closure

#### Problem Statement
Public generic OTP routes (`/api/v1/auth/otp/request`, `/api/v1/auth/send-otp`, `/api/v1/auth/otp/verify`, and `/api/v1/auth/verify-otp`) accepted arbitrary strings or Prisma enum values for `purpose`. If an attacker sent `purpose: "ADMIN_LOGIN"` to these routes, they could generate an unverified pre-auth challenge / verification token for administrator phone numbers without passing the password-first credential check. While `verifyAdminOtp` required both a challenge token and an `ADMIN_LOGIN` OTP, allowing generic OTP endpoints to generate or verify `ADMIN_LOGIN` OTPs and verification tokens bypassed the strict separation between public worker OTP authentication and password-first 2FA administrative authentication.

#### Implementation Details
1. **Explicit Purpose Allowlist**:
   In `backend/src/services/auth.service.ts`:
   - Exported `GENERIC_OTP_PURPOSES = new Set(['REGISTRATION', 'LOGIN', 'FORGOT_PASSWORD', 'ACCOUNT_DELETION'])`.
   - Exported `requireGenericOtpPurpose(purpose: unknown)` which validates that input is a non-empty string, matches `GENERIC_OTP_PURPOSES`, and rejects anything else (including `ADMIN_LOGIN`, undefined, null, or malformed strings) with `Invalid verification code purpose`.
2. **Service Layer Enforcement**:
   - `AuthService.requestOtp`: validates `purpose` using `requireGenericOtpPurpose(params.purpose)` before any mobile lookup or rate limiting.
   - `AuthService.verifyOtp`: validates `purpose` using `requireGenericOtpPurpose(params.purpose)` before executing the verification transaction.
   - `AuthService.verifyOtpInTransaction`: added defense-in-depth guard:
     ```typescript
     if ((params.purpose as string) === 'ADMIN_LOGIN') {
       return {
         success: false,
         message: 'Invalid OTP purpose for worker verification.',
       };
     }
     ```
3. **Route Layer Enforcement**:
   In `backend/src/routes/auth.routes.ts`:
   - Added validation middleware to `/otp/request`, `/send-otp`, `/otp/verify`, and `/verify-otp`:
     ```typescript
     try {
       requireGenericOtpPurpose(req.body.purpose);
     } catch (err: any) {
       return res.status(400).json({ success: false, error: err.message });
     }
     ```
4. **Verification Evidence**:
   In `backend/src/tests/admin_otp_enforcement.spec.ts`:
   - Added 13 dedicated test scenarios covering:
     1. Rejection of generic OTP request with `ADMIN_LOGIN`.
     2. Verification that rejection creates no challenge token or session.
     3. Rejection of generic OTP verification with `ADMIN_LOGIN`.
     4. Same restrictions on `/send-otp` and `/verify-otp` aliases.
     5. Rejection of unknown, missing, and malformed purposes.
     6. Assertion that disallowed paths never set cookies or issue sessions.
     7. Rejection of wrong password on dedicated `/admin/otp/request`.
     8. Success of correct password followed by correct OTP on dedicated flow.
     9. Refusal of incorrect or expired OTPs.
     10. Non-replayability of challenge/OTP.
     11. Refusal of worker OTP for administrator challenge.
     12. Preservation of legitimate worker OTP flows (`LOGIN`, `REGISTRATION`, `FORGOT_PASSWORD`).
     13. Proper scoping of `BILL_ADMIN` and `OPERATIONS_ADMIN` roles upon login.

---

### 2.2 HIR-V4-02: Concurrency-Safe Password Lockout & Row-Level Serialization

#### Problem Statement
When concurrent password authentication requests arrived for the same account (either worker login via `/api/v1/auth/login` or administrator password-first requests via `/api/v1/auth/admin/otp/request`), a race condition could allow a successful login request to clear the failed attempt counter and unlock the account even if concurrent failed requests had already crossed the failure threshold (default: 10 attempts). Furthermore, if application server clocks drifted from the database clock, `lockedUntil` checks using `Date.now()` could falsely treat an active lockout as expired or an expired lockout as active.

#### Implementation Details
1. **Database Clock-Based Lockout Computation**:
   In `backend/src/services/auth.service.ts`:
   - Updated `recordFailedPasswordAttempt` to use PostgreSQL's `clock_timestamp() AT TIME ZONE 'UTC'` and return `isLocked`:
     ```sql
     WITH clock AS (
       SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
     ),
     target AS (
       SELECT "id", "failedPasswordAttempts" FROM "User" WHERE "id" = ${userId}
     )
     UPDATE "User" u
     SET
       "failedPasswordAttempts" = target."failedPasswordAttempts" + 1,
       "lockedUntil" = CASE
         WHEN target."failedPasswordAttempts" + 1 >= ${maxAttempts}
         THEN clock.now + (${lockoutMinutes} * INTERVAL '1 minute')
         ELSE u."lockedUntil"
       END,
       "updatedAt" = CURRENT_TIMESTAMP
     FROM clock, target
     WHERE u."id" = target."id"
     RETURNING
       u."failedPasswordAttempts",
       u."lockedUntil",
       (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > clock.now) AS "isLocked"
     ```
2. **Worker Login Serialization (`AuthService.login`)**:
   - Wrapped user retrieval in `prisma.$transaction`.
   - Acquired row lock using `FOR UPDATE` selecting `failedPasswordAttempts`, `lockedUntil`, and database-computed `isLocked`.
   - Rechecks `lockedUser.isLocked` under row lock: racing failed attempts that established a lockout immediately abort the transaction with HTTP 403 `Account is temporarily locked due to too many failed login attempts.`
   - Only resets failed attempts if the account is verified NOT locked under row lock.
3. **Administrator OTP Serialization (`AuthService.requestAdminOtp`)**:
   - Wrapped admin challenge creation and counter reset in `prisma.$transaction`.
   - Acquired row lock on `User` via `FOR UPDATE` selecting database clock `isLocked`.
   - Rechecks `lockedAdmin.isLocked` under row lock; aborts if locked.
   - SMS dispatch occurs safely outside the transaction.
4. **Verification Evidence**:
   Created `backend/src/tests/auth_lockout_concurrency.spec.ts` with 4 deterministic concurrency scenarios:
   - **Test A (Worker Race)**: 10 concurrent failed password attempts race against a valid login attempt. Lockout is established; valid login fails closed with lockout error.
   - **Test B (Administrator Race)**: 10 concurrent failed password attempts race against valid admin OTP request. Challenge and OTP issuance are blocked; account is locked.
   - **Test C (Opposite Serialization)**: Successful login resets counter; subsequent failures start from 1.
   - **Test D (Lockout Expiry)**: Once `lockedUntil` passes, valid credentials succeed and reset lockout state.

---

### 2.3 HIR-V4-03: Early EC2 Target SHA Validation & Path Normalization

#### Problem Statement
In `.github/workflows/deploy-ec2.yml`, the deployment script previously executed `mkdir -p "${STATE_DIR}" "${RELEASES_DIR}/${TARGET_SHA}"` before validating that `TARGET_SHA` was a well-formed 40-character hexadecimal git SHA. An invalid, empty, or path-traversing `TARGET_SHA` (such as `../bad` or arbitrary characters) could create unintended directories on the filesystem before failing validation.

#### Implementation Details
1. **Immediate Script Entry Validation**:
   In `.github/workflows/deploy-ec2.yml`:
   - Moved `TARGET_SHA` normalization and syntax validation to the absolute top of the remote script, before any variable assignments referencing `TARGET_SHA` and before any directory creation:
     ```bash
     TARGET_SHA="$(echo "${TARGET_SHA}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

     case "${TARGET_SHA}" in
       *[!0-9a-f]*|'')
         echo "[FATAL ERROR] TARGET_SHA must be a valid 40-character hexadecimal git SHA. Received: '${TARGET_SHA}'" >&2
         exit 2
         ;;
     esac

     if [ "${#TARGET_SHA}" -ne 40 ]; then
       echo "[FATAL ERROR] TARGET_SHA must be exactly 40 characters. Length: ${#TARGET_SHA}. Received: '${TARGET_SHA}'" >&2
       exit 2
     fi
     ```
2. **Directory Creation Deferral**:
   `mkdir -p "${STATE_DIR}" "${RELEASES_DIR}/${TARGET_SHA}"` only executes after syntax validation succeeds.
3. **Verification Evidence**:
   In `scripts/test_verify_deployment_health.py`:
   - Added static ordering assertion: `test_deploy_workflow_validates_target_sha_before_any_path_creation`.
   - Added execution harness tests:
     - Rejection of invalid SHAs (short, long, non-hex, empty, traversal strings `../bad`, shell characters) with exit code 2 and zero directory creation.
     - Normalization of uppercase hexadecimal SHAs to lowercase.
   - All 61 tests in `scripts/test_verify_deployment_health.py` pass.

---

### 2.4 HIR-V4-04: Explicit Zero-Rate GST Rule Consistency

#### Problem Statement
In `backend/src/services/gst.service.ts`, `calculateReverseGst` contained an inconsistency where `gstIncluded === true` combined with an explicit 0% rate threw an error (`[NO_APPLICABLE_GST_RULE]`) or fell back to 18%, treating 0% as absent/falsy (`!configuredGstRate`). In Indian GST law, zero-rated goods and services (0% GST) are legitimate tax categories. When a bill has 0% GST, `gstAmount` should be `0.00` and `eligibleRewardAmount` should be equal to the gross bill amount. Invalid rates (negative, NaN, >100%) and missing rules must continue to fail closed.

#### Implementation Details
1. **Zero-Rate Support & Strict Input Validation**:
   In `backend/src/services/gst.service.ts`:
   - Updated `calculateReverseGst`:
     ```typescript
     if (typeof configuredGstRate !== 'number' || isNaN(configuredGstRate) || !isFinite(configuredGstRate) || configuredGstRate < 0 || configuredGstRate > 100) {
       throw new Error('[NO_APPLICABLE_GST_RULE] GST rate must be a valid number between 0 and 100.');
     }

     if (configuredGstRate === 0) {
       return {
         grossBillAmount: gross,
         gstIncluded: true,
         gstRate: 0,
         gstAmount: 0,
         eligibleRewardAmount: gross,
       };
     }
     ```
   - Updated `calculateGstAndEligibleAmount` to delegate directly to `calculateReverseGst`, guaranteeing mathematical consistency across both functions.
2. **Bill Approval Zero-Rate Invariant**:
   - In `BillService.approveBill`, approving a bill with `gstIncluded = true` and `gstRate = 0` calculates `gstAmount = 0.00`, stores `eligibleRewardAmount = billAmount`, computes rewards based on 100% of the eligible amount, and snapshots the GST rule.
   - Bills with `gstIncluded = true` but without an applicable GST rule continue to fail closed with `[NO_APPLICABLE_GST_RULE]`.
3. **Verification Evidence**:
   Created `backend/src/tests/gst_zero_rate_consistency.spec.ts` covering 13 scenarios:
   - Standard 18% calculation.
   - Explicit 0% rate with `gstIncluded = true` (0 GST, full eligible amount).
   - Explicit 0% rate with `gstIncluded = false` (full gross amount preserved).
   - Fail-closed behavior on missing rule (`[NO_APPLICABLE_GST_RULE]`).
   - Fail-closed behavior on null/undefined rate.
   - Fail-closed behavior on negative rates (`-5%`).
   - Fail-closed behavior on non-finite rates (NaN, Infinity).
   - Rejection of rates > 100% or < 0% at rule creation.
   - Mathematical consistency between `calculateReverseGst` and `calculateGstAndEligibleAmount`.
   - Bill approval with explicit 0% rule and reward calculation.
   - Bill approval rejection of inclusive bill without applicable rule.
   - Snapshot persistence of GST rule, rate, and amounts.
   - Ledger immutability of approved bills and wallet transactions.

---

### 2.5 HIR-V4.1-01: Row-Locked Administrator Account Lockout Enforcement inside `verifyAdminOtp`

#### Problem Statement
While HIR-V4-02 successfully introduced PostgreSQL row-level locks (`FOR UPDATE OF u`) during initial password validation in `AuthService.requestAdminOtp`, an adversary holding a valid pre-auth verification challenge and unconsumed OTP could concurrently attempt incorrect password authentications. If the account became locked by failed password attempts after the challenge was issued, calling `AuthService.verifyAdminOtp` could previously succeed because `verifyAdminOtp` read the `VerificationToken` and `OtpRequest` without re-verifying the user's live lockout state under a PostgreSQL row lock. This created a potential race window where an account locked by brute-force protection could still issue an active administrative session.

#### Implementation Details
1. **Row-Level Lock Invariant & Consistent Lock Ordering**:
   In `backend/src/services/auth.service.ts` inside `verifyAdminOtp`:
   - Within the transaction, the `User` row is locked FIRST via explicit PostgreSQL raw query:
     ```sql
     WITH clock AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
     SELECT u."id", u."mobile", u."fullName", u."role", u."status", u."failedPasswordAttempts", u."lockedUntil",
            (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > clock.now) AS "isLocked"
     FROM "User" u CROSS JOIN clock
     WHERE u."mobile" = ${mobile} AND u."role" = ${role}::"UserRole"
     FOR UPDATE OF u
     ```
   - **Deadlock Prevention**: Both `requestAdminOtp` and `verifyAdminOtp` lock `User` first, followed by secondary entity checks (`VerificationToken`, `OtpRequest`), ensuring identical acquisition order across all authentication paths.
2. **Fail-Closed Lockout Enforcement**:
   - If `lockedAdmin.isLocked` is true:
     - The unconsumed `ADMIN_LOGIN` OTP and pre-auth verification token are immediately marked `used = true` / consumed, preventing replay.
     - The lockout counters are preserved intact (never reset).
     - The transaction throws an error: `Account temporarily locked due to multiple failed login attempts. Please try again after 15 minutes.`
     - No session is created, no JWT access/refresh token is generated, and no authentication cookies are returned.
   - Rechecks `lockedAdmin.status === 'ACTIVE'`, rejecting suspended or deactivated administrators immediately.
3. **Verification Evidence**:
   In `backend/src/tests/auth_lockout_concurrency.spec.ts`:
   - Added 4 new deterministic concurrency and security test cases (Tests E through H):
     - **Test E**: Challenge issued; 10 concurrent failed password attempts trigger account lockout; subsequent `verifyAdminOtp` call is rejected with lockout error; unconsumed challenge/OTP invalidated; lockout counters preserved.
     - **Test F**: Opposite serialization order: legitimate `verifyAdminOtp` resets failure counters to 0; subsequent failed password attempt increments counter starting at 1.
     - **Test G**: Inactive or suspended administrator rejected at `verifyAdminOtp` without session issuance.
     - **Test H**: Mobile and role mismatch rejected fail-closed at `verifyAdminOtp`.

---

### 2.6 HIR-V4.1-02: Strict GST Rate & Rule Input Validation Boundary Hardening

#### Problem Statement
Previously, the GST rule creation endpoint (`POST /settings/gst-rules`) and service (`GstService.createGstRule`) relied on standard numeric conversion (`Number(ratePercentage)`). This allowed non-standard representations such as `"18foo"` (parsed as `18` via loose parsing or failing without clean validation), scientific notation (`"1e2"`), numbers with excessive decimal precision (`18.1234`), and string-boolean values (`isDefault: "false"`, which evaluated as truthy in standard JavaScript object checks, unsetting the existing default rule).

#### Implementation Details
1. **Strict Rate Parsing Utility (`parseStrictGstRate`)**:
   In `backend/src/services/gst.service.ts`:
   - Enforces finite numbers or numeric strings strictly matching `/^(?:0|[1-9]\d{0,2})(?:\.\d+)?$/`.
   - Bounds values strictly within `[0.00, 100.00]`.
   - Rejects empty strings, whitespace, alphanumeric values (`"18foo"`), scientific notation (`"1e2"`), negative numbers, NaN, and Infinity.
   - Enforces maximum scale of 2 decimal places (`Decimal(5, 2)` matching database schema), rejecting inputs like `18.123` or `'0.001'`.
2. **Strict Boolean & String Validation**:
   - In `GstService.createGstRule`: rejects non-boolean `isDefault` (`typeof isDefault !== 'boolean'`) and non-string `description`.
   - In `backend/src/routes/admin.routes.ts`: `POST /settings/gst-rules` and `PATCH /settings/gst-rules/:id` strictly reject non-boolean `isDefault` and `isActive` with HTTP 400.
3. **Fail-Closed Atomic Default Rule Management**:
   - `GstService.createGstRule` validates all parameters *before* opening the transaction or clearing existing default flags (`updateMany({ where: { isDefault: true }, data: { isDefault: false } })`). If validation fails, existing default rules remain untouched.
4. **Admin UI Form Alignment**:
   - In `admin/src/pages/settings.tsx`: updated client form validation to allow explicit 0% GST rate creation (`parsedRate < 0` instead of `<= 0`).
5. **Verification Evidence**:
   In `backend/src/tests/gst_zero_rate_consistency.spec.ts`:
   - Added unit test suite (14) covering 30+ edge cases for `parseStrictGstRate`.
   - Added service validation suite (15) validating non-boolean `isDefault`, non-string description, and atomic fail-closed default preservation.
   - Added HTTP route suites (16 & 17) validating 401, 403, and 400 error codes for malformed rates, string booleans, and non-string descriptions.

---

### 2.7 HIRALAL-GST-02: Consistent Canonical Calculation Result Shape Contract

#### Problem Statement
For bills where GST is not included (`gstIncluded: false`), `GstService.calculateReverseGst()` returned `gstRate: null`, whereas `GstService.calculateGstAndEligibleAmount()` previously returned `gstRate: 0`. This shape disparity introduced subtle schema inconsistencies between different internal calculation callers.

#### Implementation Details
1. **Canonical Shape Unification**:
   In `backend/src/services/gst.service.ts`:
   - `calculateGstAndEligibleAmount` now delegates directly to `this.calculateReverseGst(grossBillAmount, false, null)` when `gstIncluded` is false.
   - The returned object canonically contains `{ grossBillAmount, gstIncluded: false, gstRate: null, gstAmount: 0, eligibleRewardAmount: grossBillAmount }`.
2. **Contract Verification**:
   - Added test suite 18 in `gst_zero_rate_consistency.spec.ts` asserting exact equality between `calculateReverseGst` and `calculateGstAndEligibleAmount` outputs across null, zero, and positive rates when `gstIncluded: false`.
   - Updated assertion in `p0_remediation_integrity.spec.ts` ensuring full consistency across all test suites.

---

## 3. Production Gates & Repository Controls

All changes strictly conform to the repository safety policies:
1. **Protected Branch Preservation**: The protected `main` branch (`b90136ccc046dbc1f3f50f3e0993cb1c21375789`) was never touched, merged into, or force-pushed.
2. **Branch Isolation**: All commits and tests reside on `audit/deploy-workflow-investigation`.
3. **Zero Production Mutation**: No live AWS deployment was triggered, no live database migrations were executed, and no Play Store release was published.
4. **Zero Test Regressions**: All 619 backend tests across 35 suites, 61 deployment tests, 22 security floor tests, 9 admin unit tests, and 24 mobile plugin tests pass cleanly.

---

## 4. Conclusion & Release Readiness

With the completion of HIR-V4-01 through HIR-V4-04, HIR-V4.1-01, HIR-V4.1-02, and HIRALAL-GST-02:
- Generic OTP authentication paths cannot bypass administrator password checks.
- Authentication lockouts are serialized and enforced under database row-locks against race conditions during both challenge issuance and OTP verification.
- Deployment scripts validate target SHAs immediately before executing filesystem operations.
- Zero-rate GST invoices and strict rate validation are handled consistently and atomically without accounting anomalies, loose string conversions, or fallback errors.
- Reverse GST calculations maintain mathematical and schema consistency across all endpoints.

The codebase on branch `audit/deploy-workflow-investigation` is fully remediated, verified with 100% passing tests, and ready for code review and production staging deployment.
