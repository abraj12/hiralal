# HIRALAL REWARDS PLATFORM — PART 2 PLAY INTEGRITY, ACTION BINDING, REPLAY PREVENTION & NATIVE ANDROID BUILD REMEDIATION REPORT

**Repository:** `https://github.com/abraj12/hiralal`  
**Working Branch:** `audit/deploy-workflow-investigation`  
**Company:** Hiralal & Sons Sales Pvt. Ltd. (algions.com / ALGIONS AI LABS PRIVATE LIMITED)  
**Security Closure Gate:** Part 2 — Play Integrity, Action Binding, Replay Prevention, Native Android Build & CI Hardening  
**Verification Date:** October 12, 2026  
**Auditor / Principal Engineer:** Antigravity (DeepMind Advanced Agentic Coding Pair)

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 Objective
Deliver a complete, production-grade security closure for the Google Play Integrity subsystem in Part 2. This encompasses fixing native Android config plugin code generation defects, closing nonce replay windows with atomic Redis Lua scripts, enforcing JWT authentication and session binding on nonce generation, implementing cryptographic request hash binding (`requestHash`) across both backend and mobile clients, fixing route middleware execution order for multipart uploads, wiring real mobile screens to compute action attestations, and introducing a native Android Gradle debug APK build job into GitHub Actions CI.

### 1.2 Identified Pre-Remediation Vulnerabilities & Architectural Defects

1. **Config Plugin Import Placement Syntax Error (`mobile/plugins/withPlayIntegrity.js`):**
   - *Defect:* The Expo config plugin injected `import com.hiralal.rewards.integrity.PlayIntegrityPackage;` at index 0 of `MainApplication.kt`, preceding the `package com.hiralal.rewards` statement.
   - *Impact:* Kotlin compilation failure (`Package directive must be the first statement in the file`). Furthermore, package registration was not idempotent and lacked robust error propagation.

2. **Unauthenticated Nonce Issuance (`GET /integrity/nonce`):**
   - *Defect:* An obsolete `GET /integrity/nonce` endpoint permitted anonymous callers to generate nonces without user authentication or session context. In addition, `GENERAL` actions were permitted without operational context.
   - *Impact:* Attackers could harvest nonces and bypass session binding, defeating anti-replay protection.

3. **Replay Windows in Nonce Verification (`GET` then `DEL` in Redis):**
   - *Defect:* Nonce validation retrieved the key with `redis.get(key)` and only deleted it on successful token verification via `redis.del(key)`.
   - *Impact:* A concurrent attacker could send multiple identical requests before the first request completed, exploiting an asynchronous race window. In addition, an in-memory fallback was active even in production/staging environments, creating a split-brain vulnerability across multi-pod deployments.

4. **Missing Cryptographic Request Hash Binding:**
   - *Defect:* Nonces and Play Integrity tokens were not bound to the payload being executed.
   - *Impact:* A compromised device could acquire an integrity verdict for a benign action and reuse the attestation to forge a different high-value action (e.g., swapping a bill invoice hash or changing a payout redemption amount/UPI ID).

5. **Route Middleware Ordering Hazard (`backend/src/routes/bill.routes.ts`):**
   - *Defect:* `requireActionIntegrity('BILL_UPLOAD')` was executed *before* `upload.single('invoiceFile')`.
   - *Impact:* `req.body` and `req.file` were unpopulated when the integrity middleware executed, rendering request hash calculation and verification impossible for multipart uploads.

6. **Missing Client-Side Attestation Wiring in Mobile Screens:**
   - *Defect:* `UploadBillScreen.tsx` and `RedemptionModal.tsx` lacked canonical payload calculation and did not invoke the native Play Integrity token request flow.

7. **Absence of Native Android Build Verification in CI:**
   - *Defect:* CI only verified TypeScript types and backend unit tests. No automated job verified that `npx expo prebuild` and `./gradlew :app:assembleDebug` successfully compiled native Java/Kotlin code.

---

## 2. Architecture & Security Mechanics

### 2.1 End-to-End Cryptographic Attestation Architecture

```
[Mobile Client]                                   [Backend API]                           [Google Play Integrity API]
      │                                                 │                                              │
      │ 1. Canonical Payload & SHA-256 Request Hash    │                                              │
      ├─────────────────────────────────────────────────┼──────────────────────────────────────────────┤
      │ 2. POST /api/auth/integrity/nonce (JWT Auth)   │                                              │
      │    Body: { action, requestHash }                │                                              │
      │    Headers: Authorization: Bearer <Token>      │                                              │
      │────────────────────────────────────────────────>│                                              │
      │                                                 │ Verify JWT (userId, sessionId)               │
      │                                                 │ Validate 64-hex requestHash                  │
      │                                                 │ Generate cryptographically secure nonce      │
      │                                                 │ Store in Redis (TTL 300s):                   │
      │                                                 │   { userId, sessionId, action, requestHash } │
      │ 3. Nonce returned                               │                                              │
      │<────────────────────────────────────────────────┤                                              │
      │                                                 │                                              │
      │ 4. Request Native Integrity Token               │                                              │
      │    PlayIntegrityModule.requestIntegrityToken(   │                                              │
      │      nonce, promise                             │                                              │
      │    )                                            │                                              │
      │─────────────────────────────────────────────────┼─────────────────────────────────────────────>│
      │ 5. Returns encrypted integrityToken             │                                              │
      │<────────────────────────────────────────────────┼──────────────────────────────────────────────┤
      │                                                 │                                              │
      │ 6. High-Value Action Submission                 │                                              │
      │    POST /api/bills/upload (or /kyc, /payout)    │                                              │
      │    Headers:                                     │                                              │
      │      X-Integrity-Token: <token>                 │                                              │
      │      X-Integrity-Nonce: <nonce>                 │                                              │
      │      Authorization: Bearer <Token>              │                                              │
      │    Body: { ...businessPayload, invoiceFile }   │                                              │
      │────────────────────────────────────────────────>│                                              │
      │                                                 │ [Multer Middleware]                          │
      │                                                 │   Parse multipart stream & file buffer       │
      │                                                 │ [Integrity Middleware]                       │
      │                                                 │   Compute canonical requestHash from payload │
      │                                                 │   Atomic Redis Lua Script:                   │
      │                                                 │     GET AND DELETE nonce in 1 operation      │
      │                                                 │   Verify user, session, action, requestHash  │
      │                                                 │   Decrypt & Verify Play Integrity Token:     │
      │                                                 │     Verify package name, device verdict,     │
      │                                                 │     app licensing, requestHash               │
      │                                                 │ [Controller / Business Logic]                │
      │ 7. Success 200 OK / 201 Created                 │   Execute financial / bill transaction       │
      │<────────────────────────────────────────────────┤                                              │
```

### 2.2 Atomic Nonce Consumption (Redis Lua Script)

To eliminate replay race windows, nonces are read and deleted atomically inside Redis via a single Lua script:

```lua
local val = redis.call('get', KEYS[1])
if val then
    redis.call('del', KEYS[1])
end
return val
```

If Redis is unreachable:
- In `production` and `staging`: The system fails closed (`PlayIntegrityVerificationError: Redis integrity store unavailable in production`).
- In `test` environment: An in-memory atomic Map fallback is utilized solely for unit testing.

### 2.3 Canonical Request Hash Specifications

Canonical request hashes ensure that identical business parameters produce identical SHA-256 hexadecimal digests on both TypeScript mobile clients and Node.js backend services:

1. **`BILL_UPLOAD`**:
   - Fields: `dealerId` (trimmed), `rawAmount` (normalized integer string), `fileSha256` (SHA-256 of the raw invoice binary buffer).
   - JSON format: `{"dealerId":"...","fileSha256":"...","rawAmount":"..."}` (alphabetically sorted keys).
2. **`KYC_SUBMIT`**:
   - Fields: `panNumber` (uppercase trimmed).
   - JSON format: `{"panNumber":"..."}`.
3. **`PAYOUT_REDEEM`**:
   - Fields: `amount` (integer points), `payoutMethod` (e.g. `UPI`), `payoutTarget` (uppercase trimmed UPI ID / account).
   - JSON format: `{"amount":1000,"payoutMethod":"UPI","payoutTarget":"USER@UPI"}`.

### 2.4 Native Config Plugin Mechanics (`mobile/plugins/withPlayIntegrity.js`)

1. **`insertImportAfterPackageDeclaration(contents, qualifiedName, isKotlin)`**:
   - Regex matches the package declaration: `/^[ \t]*package[ \t]+[A-Za-z0-9_.]+;?[ \t]*\r?\n/m`.
   - Inserts `import com.hiralal.rewards.integrity.PlayIntegrityPackage` directly following the package directive, ensuring 100% valid Kotlin syntax.
   - Idempotent: Skips insertion if already present.
2. **`registerPlayIntegrityPackage(contents, isKotlin)`**:
   - Detects Kotlin `PackageList(this).packages.apply {` and inserts `add(PlayIntegrityPackage())`.
   - Detects Java `new PackageList(this).getPackages();` and inserts `packages.add(new PlayIntegrityPackage());`.
   - Idempotent: Prevents duplicate package registrations.
3. **`withPlayIntegrityNativeFiles(config)`**:
   - Generates `PlayIntegrityModule.java` and `PlayIntegrityPackage.java` targeting `com.google.android.play.core.integrity.IntegrityManagerFactory`.
   - Modifies `app/build.gradle` to add `implementation 'com.google.android.play:integrity:1.4.0'`.

---

## 3. Source File Implementation Audit Matrix

| File Path | Component | Changes Implemented |
|:---|:---|:---|
| `mobile/plugins/withPlayIntegrity.js` | Native Config Plugin | Fixed import placement after `package` statement; added Kotlin/Java package registration idempotency; native file generation. |
| `mobile/plugins/withPlayIntegrity.test.js` | Plugin Unit Tests | Added 10 comprehensive unit tests for import placement, syntax validation, Kotlin/Java idempotency, and build.gradle injection. |
| `backend/src/services/integrity/playIntegrity.service.ts` | Backend Service | Implemented atomic Redis Lua script; fail-closed enforcement for production/staging; session, user, and `requestHash` equality checks. |
| `backend/src/routes/auth.routes.ts` | Auth Router | Removed legacy unauthenticated `GET /integrity/nonce` (404); secured `POST /integrity/nonce` and `/verify` with `authenticate, requireUser`; validated 64-hex requestHash. |
| `backend/src/routes/bill.routes.ts` | Bill Router | Reordered middleware: placed `upload.single('invoiceFile')` BEFORE `requireActionIntegrity('BILL_UPLOAD')`. |
| `backend/src/middleware/integrity.middleware.ts` | Integrity Middleware | Added canonical request hash computation from `req.body` and `req.file`; passed `computedRequestHash` into verification context. |
| `backend/src/utils/integrityRequestHash.ts` | Backend Hash Utility | Built canonical payload formatters and SHA-256 generators for `BILL_UPLOAD`, `KYC_SUBMIT`, `PAYOUT_REDEEM`. |
| `mobile/src/services/integrityRequestHash.ts` | Mobile Hash Utility | Built client-side canonical payload formatters and SHA-256 generators using `expo-crypto`. |
| `mobile/src/services/api.ts` | Mobile API Client | Made `attestation` parameter mandatory on `uploadBill`, `verifyPan`, and `redeemRewards`; fail-fast validation on blank tokens/nonces. |
| `mobile/src/services/integrity.service.ts` | Mobile Attestation Service | Added request hash validation and token fetching using native PlayIntegrity bridge. |
| `mobile/src/screens/UploadBillScreen.tsx` | Mobile Screen | Wired real canonical file SHA-256 hashing, nonce retrieval, action attestation, and header propagation. |
| `mobile/src/components/RedemptionModal.tsx` | Mobile Screen | Wired real KYC and Payout canonical hashing, nonce retrieval, and action attestation. |
| `.github/workflows/ci.yml` | CI Pipeline | Added `mobile-android-build` job with pre-installed Android SDK, Java 17, Expo prebuild, Gradle debug APK build, and artifact upload. |
| `backend/src/tests/part2_play_integrity_hardening.spec.ts` | Backend Regression Tests | 13 regression tests covering replay prevention, atomic Lua consumption, fail-closed Redis, unauthenticated endpoint removal, and request hash validation. |
| `backend/src/tests/part2_integrity_mobile_binding.spec.ts` | Backend Route Tests | 7 integration tests covering route ordering, multipart upload attestation, KYC attestation, and payout attestation. |

---

## 4. Verification & Testing Evidence

### 4.1 Local Automated Verification

1. **Backend Test Suite:**
   - Command: `npm test`
   - Results: **27 test suites passed, 419 total tests passed (100% pass rate).**
   - Highlights:
     - `part2_play_integrity_hardening.spec.ts`: 13/13 passed.
     - `part2_integrity_mobile_binding.spec.ts`: 7/7 passed.
     - `part2a4_hardening.spec.ts`: 17/17 passed.
     - All financial ledger, concurrency lock, and audit suites: passed.

2. **Mobile Plugin Unit Test Suite:**
   - Command: `npm test` (`node --test plugins/withPlayIntegrity.test.js`)
   - Results: **10/10 tests passed.**
   - Verified Kotlin/Java package declaration handling, duplicate imports, and build.gradle injection.

3. **Mobile TypeScript Compilation:**
   - Command: `npx tsc --noEmit`
   - Results: **0 errors.**

4. **Expo Android Prebuild Smoke Test:**
   - Command: `npx expo prebuild --platform android --no-install --clean`
   - Results: Prebuild succeeded, generating `mobile/android` with valid `MainApplication.kt` containing `import com.hiralal.rewards.integrity.PlayIntegrityPackage` immediately after package declaration.

### 4.2 GitHub Actions CI Pipeline Verification

- **Workflow Run ID:** `38229375325`
- **Workflow Run URL:** `https://github.com/abraj12/hiralal/actions/runs/38229375325`
- **Commit SHA:** `7f13131feff09cdb9ea287a428ee1f7fb1d8007a`
- **Workflow Conclusion:** `success` (7/7 jobs succeeded)

#### Verified Pipeline Jobs:
1. `GitHub Actions Workflow Lint (actionlint)` — **SUCCESS** (Job ID: `114744776326`)
   - Validated CI workflow configuration with `actionlint` and verified deployment health validation script (`scripts/test_verify_deployment_health.py`).
2. `Mobile App Typecheck & Plugin Unit Tests` — **SUCCESS** (Job ID: `114744776682`)
   - Executed `npx tsc --noEmit` (0 errors) and `node --test plugins/withPlayIntegrity.test.js` (10/10 passed).
3. `Backend Lint, Typecheck, Migrations & Test Suite` — **SUCCESS** (Job ID: `114744776715`)
   - Validated Prisma schema, generated client, executed database migrations against PostgreSQL container, seeded initial test data, and ran the complete test suite (27 suites, 419 tests passing).
4. `Admin Date Helper Tests` — **SUCCESS** (Job ID: `114744776946`)
   - Ran `npm ci`, Next.js/React TypeScript typecheck, and unit test suite for admin date helpers (9/9 passed).
5. `Mobile Native Android Build (Gradle Debug APK)` — **SUCCESS** (Job ID: `114744892427`)
   - Ran Java 17 and pre-installed Android SDK environment, installed dependencies (`npm ci --legacy-peer-deps`), executed `npx expo prebuild --platform android --no-install --clean`, compiled the native Android app with Gradle (`./gradlew :app:assembleDebug --no-daemon`), and generated the debug APK.
   - Uploaded artifact: `mobile-debug-apk` (52,417,789 bytes / 52.4 MB).
6. `Full 6-Container Docker Compose Stack Smoke Test` — **SUCCESS** (Job ID: `114745451622`)
   - Tested fallback SSL cert generation, Cloudflare Origin SSL precheck, full 6-container production stack (`postgres`, `redis`, `backend`, `worker`, `admin`, `nginx`), HTTP/HTTPS health probes, and API reverse proxy routing.
7. `Docker ARM64 Build Verification (AWS Graviton2)` — **SUCCESS** (Job ID: `114745451652`)
   - Emulated ARM64 via QEMU, built multi-architecture backend and admin panel Docker images for AWS Graviton2 compatibility.

---


## 5. Honest Production Boundary & Limitations

While the platform's Play Integrity subsystem is fully implemented and hardened in source code and automated CI, live production operation requires the following external operational prerequisites:

1. **Google Play Console Linkage:**
   - A Google Service Account with Play Integrity API permissions must be generated and its JSON credentials stored in AWS Secrets Manager / environment (`PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`).
   - The application ID (`com.hiralal.rewards`) must be linked to the Google Play Console project.

2. **Physical Device Hardware Attestation:**
   - The `MEETS_STRONG_INTEGRITY` verdict requires an unlocked, unmodified, certified physical Android device running Google Play Services.
   - Emulators and rooted devices will legitimately fail integrity checks when `PLAY_INTEGRITY_ALLOW_MOCK` is disabled in production.

3. **Google Play Store Distribution:**
   - Genuine hardware verdicts are only produced by Google when the APK/AAB is uploaded to an internal testing track or production track in Google Play Console.
