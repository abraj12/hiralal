# HIRALAL & SONS REWARDS PLATFORM
## MASTER REMEDIATION, REQUIREMENTS-COMPLIANCE & RELEASE-READINESS AUDIT REPORT

**Date:** 2026-10-13  
**Auditor / Engineer:** Senior Full-Stack & Application Security Engineer  
**Working Branch:** `audit/deploy-workflow-investigation`  
**Starting Commit:** `5419ed335647186d1135e7844940ddb13046ca2d`  
**Base `main` Commit (Preserved & Untouched):** `b90136ccc046dbc1f3f50f3e0993cb1c21375789`  
**Remediation Commit:** `5f27f01d040de6191c794bd0a5e5ed494b72f071`  

---

## 1. Executive Summary & Verification Highlights

A comprehensive, end-to-end remediation pass was completed for the Hiralal & Sons Sales Rewards Platform to enforce all product invariants, eliminate implicit fallbacks, rectify reverse GST calculation, uphold temporal accuracy in `Asia/Kolkata`, implement account lockout defenses, enforce strict admin role separation, standardize canonical API routing to `/api/v1`, and harden CI/CD workflows for EC2 deployment and Android release candidates.

### Overall Verification Summary:
- **Backend Test Suite:** 32 / 32 test suites passed, 554 / 554 tests passing (100% green).
- **Master Compliance Suite:** 21 / 21 tests passed (`backend/src/tests/master_requirements_compliance.spec.ts`).
- **Python Health & Compatibility Tests:** 49 / 49 tests passed (`scripts/test_migration_compatibility.py`, `scripts/test_verify_deployment_health.py`).
- **Next.js Security Floor Regression Suite:** 22 / 22 tests passed (`scripts/test-next-security-floor.cjs`).
- **Admin Portal:** TypeScript & Next.js production build succeeded with 0 errors across all 11 static pages. Unit tests passed 9 / 9.
- **Mobile Client:** TypeScript check passed with 0 errors (`mobile/tsconfig.json`). Unit tests passed 16 / 16 (`plugins/withPlayIntegrity.test.js`, `plugins/withReleaseSigning.test.js`, `plugins/apiUrlValidation.test.js`).
- **Database Migrations:** Clean additive migration `20261013190000_retire_legacy_rules_and_add_password_lockout` verified against schema and deployment-compatibility registry.

---

## 2. Invariant & Requirements Compliance Matrix

| Requirement / Invariant | Implementation Details | Status |
| :--- | :--- | :--- |
| **Two Admin Roles Only** | `BILL_ADMIN` (bill review only) and `OPERATIONS_ADMIN` (all system & financial ops). No `SUPER_ADMIN` or other roles. | **ENFORCED** |
| **No Reward Pools or Caps** | Global pools and monthly reward caps completely eliminated from calculations, schemas, and queries. | **ENFORCED** |
| **No Default / Fallback Reward Rates** | Removed hardcoded default reward rates (`0.50%`, `0.75%`) from app code, forms, utilities, and seed scripts. Missing reward rule fails closed with `[NO_APPLICABLE_REWARD_RULE]`. | **ENFORCED** |
| **Reverse GST Calculation** | Correct reverse formula implemented: `grossBillAmount - (grossBillAmount / (1 + configuredGstRate / 100))`. Fails closed with `[NO_APPLICABLE_GST_RULE]` if GST is included without a configured rate. | **ENFORCED** |
| **Asia/Kolkata Date & Time Accuracy** | Exact date and time preserved down to second in `Asia/Kolkata` (`+05:30`) timezone. Truncation to midnight removed. | **ENFORCED** |
| **Approved Bill & Ledger Immutability** | Approved bill reward snapshots and historical ledger entries are completely immutable. Never recalculated retroactively. | **ENFORCED** |
| **Redemption Settings Disabled by Default** | Initial redemption window is closed (`isEnabled: false`) and unconfigured (`minimumRedemptionAmount: null`, `startAt: null`, `endAt: null`). Requires positive threshold and active window (`startAt < endAt` and `now >= startAt && now < endAt`). | **ENFORCED** |
| **Persistent Account Lockout** | Users and admins are locked for 15 minutes (`900s`) after 10 consecutive failed password attempts. Tracked persistently in `User.failedPasswordAttempts` and `User.lockedUntil`. | **ENFORCED** |
| **Admin Dashboard Role Separation** | `GET /dashboard` strictly branches on role. `BILL_ADMIN` receives only bill stats and recent bills; operational user, payout, and wallet metrics are excluded. | **ENFORCED** |
| **Canonical API Endpoint (`/api/v1`)** | Express router mounts canonical routes at `/api/v1` with backwards-compatible `/api` alias. Mobile and admin clients target HTTPS `/api/v1` and validate url structure in production. | **ENFORCED** |
| **EC2 Deploy Active-Release Reader** | Fixed `node:fs` module import, enforced 40-character SHA check, exit 2 fail-closed on corrupt metadata, eliminated `git rev-parse HEAD` fallback. | **ENFORCED** |
| **Android Release Verification Hardening** | APK verification fails closed if package name cannot be extracted. AAB verification dumps manifest via bundletool to guarantee package matches `com.hiralal.rewards`. | **ENFORCED** |

---

## 3. Detailed Component Changes

### 3.1 Backend Calculations & Business Rules
- `backend/src/utils/money.utils.ts`:
  - Removed `ratePercentage = 0.50` default parameter in `calculateRewardAmount`.
  - Added positive finite check on reward rate percentage.
- `backend/src/services/gst.service.ts`:
  - Implemented `calculateReverseGst(grossBillAmount, gstIncluded, configuredGstRate)` using the exact formula:
    $$\text{gstDeduction} = \text{grossBillAmount} - \frac{\text{grossBillAmount}}{1 + \frac{\text{configuredGstRate}}{100}}$$
    $$\text{netEligibleAmount} = \frac{\text{grossBillAmount}}{1 + \frac{\text{configuredGstRate}}{100}}$$
  - Added `[NO_APPLICABLE_GST_RULE]` fail-closed error when GST is included without a configured non-zero rate.
  - Updated `getDefaultGstRule` to return `null` if no explicit default rule is configured.
- `backend/src/services/bill.service.ts`:
  - Connected bill approval flow to `GstService.calculateReverseGst`.
  - Fails closed with `[NO_APPLICABLE_GST_RULE]` if GST is included and no rule exists.
- `backend/src/utils/timezone.utils.ts`:
  - Added `parseIndiaEffectiveDateTime(input)` preserving exact hour, minute, second in `Asia/Kolkata`.
- `backend/src/services/reward-rule.service.ts`:
  - Replaced midnight truncation with `parseIndiaEffectiveDateTime`.
  - Collision error formatted with complete timestamp `yyyy-MM-dd HH:mm:ss`.

### 3.2 Authentication & Security Hardening
- `backend/prisma/schema.prisma` & Database Migration:
  - Added `failedPasswordAttempts Int @default(0)` and `lockedUntil DateTime?` to `User`.
  - Created forward-only migration `20261013190000_retire_legacy_rules_and_add_password_lockout/migration.sql`.
  - Deactivated legacy seeded default rules to ensure clean, unconfigured state.
- `backend/src/config/index.ts`:
  - Added `auth: { lockoutSeconds, maxFailedAttempts }` with 900s lockout and 10 attempts max.
  - Added `'xyz'` and `'abc'` to forbidden placeholder prefixes.
  - Required distinct, non-placeholder `BILL_ADMIN_PREFIX` and `OPERATIONS_ADMIN_PREFIX`.
- `backend/src/services/auth.service.ts`:
  - Implemented persistent lockout after 10 failed attempts across `login`, `requestAdminOtp`, and `loginAdmin`.
  - Verified `lockedUntil > new Date()` before credential checks; resets on successful login.
- `backend/src/routes/admin.routes.ts`:
  - `GET /dashboard` checks `req.user.role === 'BILL_ADMIN'` and returns only bill metrics, omitting user, payout, and wallet data.
  - `PUT /settings/reward-rules` enforces explicit `profession` and `percentage`.

### 3.3 Routing & Client Configurations
- `backend/src/server.ts`:
  - Created `v1Router` and mounted under `/api/v1` (canonical) and `/api` (backwards-compatible alias).
- `admin/src/lib/apiConfig.ts` & `backend/src/utils/adminApi.utils.ts`:
  - Defaulted same-origin reverse proxy target to `/api/v1`.
- `admin/src/pages/settings.tsx`:
  - Blank unconfigured initial form states.
  - 3-column reward rule layout with IST date and time inputs.
  - Empty state message for GST rules when no rules exist.
- `mobile/src/services/apiUrl.ts` & `mobile/src/services/api.ts`:
  - Added `validateProductionApiUrl` enforcing HTTPS protocol and `/api/v1` path.

### 3.4 Workflows & CI/CD Pipelines
- `.github/workflows/deploy-ec2.yml`:
  - Fixed `node:fs` module import in active-release reader.
  - Exit 2 fail-closed on corrupt JSON or missing 40-character SHA.
  - Removed unverified `git rev-parse HEAD` fallback.
- `.github/workflows/android-release-candidate.yml`:
  - Added fail-closed check if APK package name cannot be extracted with `aapt`.
  - Added AAB manifest verification via bundletool to guarantee binary package is `com.hiralal.rewards`.

---

## 4. Verification Evidence & Test Execution Logs

### Backend Test Results
```text
Test Suites: 32 passed, 32 total
Tests:       554 passed, 554 total
Snapshots:   0 total
Time:        122.202 s
Ran all test suites.
```

### Python Health & Compatibility Results
```text
Ran 49 tests in 0.524s
OK
Liveness and dependency readiness verified.
```

### Next.js Security Floor Regression Results
```text
All 22 Next.js Security Floor Regression Tests PASSED!
```

### Admin Portal Test & Build
```text
# tests 9
# suites 0
# pass 9
# fail 0
✓ Compiled successfully in 4.8s
✓ Generating static pages (11/11)
```

### Mobile Tests & TypeScript Check
```text
# tests 16
# suites 0
# pass 16
# fail 0
tsc --noEmit --project mobile/tsconfig.json -> 0 errors
```

---

## 5. Audit Conclusion

All requirements and core invariants have been verified and confirmed green across the repository. The audit branch `audit/deploy-workflow-investigation` has been updated and pushed with full evidence. `main` remains untouched at `b90136ccc046dbc1f3f50f3e0993cb1c21375789`.
