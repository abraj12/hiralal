# Security Architecture & Policies
## Hiralal and Sons Sales Pvt. Ltd. — Platform Security Specification

This document details the security model, cryptographic controls, authentication boundaries, identity verification rules, and financial protections implemented across the platform.

---

## 1. Identity Verification & Bank Account Name Matching Policy

### A. The Exact Normalized Match Mandate
To prevent impersonation fraud, identity swapping, and unauthorized cash redemptions, the platform enforces an uncompromising identity-matching rule:

> **The bank account holder's full name must match the full name recorded on the customer's PAN card exactly after removing only approved prefixes and applying safe formatting normalization.**

### B. Matching Algorithm Rules ([`name.utils.ts`](file:///backend/src/utils/name.utils.ts))
1. **Case & Space Normalization:** All names are converted to uppercase, trimmed, and internal whitespace/punctuation is collapsed into single spaces.
2. **Approved Initial Prefixes Only:**
   Only the following prefixes are stripped, and *strictly* when appearing as a standalone token at the start of a name followed by whitespace:
   - `MR`, `MRS`, `MS`, `DR`
   - `SHRI`, `SHREE`, `SRI`, `SMT`, `KUMARI`
   - `M/S`, `M.S.`
3. **Preservation of Genuine Syllables:**
   Prefix syllables that form part of a continuous name token (such as `SRIDHAR`, `KUMAR`, or `ANITA KUMARI` where `KUMARI` is a surname) are never removed.
4. **Strict String Equality:**
   After prefix removal and space collapse, `normAccount === normPan` is evaluated.
5. **Prohibited Matching Behaviors:**
   - **No Fuzzy Matching:** Levenshtein, Jaro-Winkler, and phonetic algorithms (Soundex/Metaphone) are strictly prohibited.
   - **No Subset / Containment Matching:** Substrings, missing given names, or missing surnames are rejected.
   - **No Token Reordering:** Swapped tokens (e.g., `RAHUL KUMAR SINGH` vs `SINGH RAHUL KUMAR`) are rejected.
   - **No Initials Expansion:** Abbreviated initials (e.g., `R K SHARMA` vs `RAJESH KUMAR SHARMA`) are rejected.

### C. Name Locking on Mononymous KYC Approval
When an Operations Administrator manually approves a pending record explicitly marked `MONONYMOUS_APPLICANT_MANUAL_REVIEW_REQUIRED`, the system sets `KycRecord.mononymousApproved = true` and locks the user's name (`isNameLocked = true`, `nameLockedAt = new Date()`) in the same transaction. The approval route fails closed if PAN uniqueness cannot be verified, rejects non-mononymous pending records, and prevents duplicate PAN reuse. Ordinary successful KYC also locks the user's name but does **not** grant the mononymous matching exception. Payout eligibility and dispatch may use relaxed mononymous matching only when the persisted KYC flag is true. Any subsequent attempt by the user to modify their profile name via `updateUserName` is blocked.

---

## 2. Authentication & Authorization Boundaries

### A. Dual Administrative Roles
The platform separates administrative privileges into two non-overlapping roles:
- **`BILL_ADMIN`**: Authorized solely to view uploaded purchase bills, inspect high-resolution documents, and approve or reject bills. Has no access to user management, payout disbursements, financial rules, or system settings.
- **`OPERATIONS_ADMIN`**: Authorized to review payout requests, manage user statuses, configure reward and GST rules, adjust redemption windows, and review audit logs. Has no access to bill approval actions.
- **Deprecated `ADMIN` Role**: Legacy `ADMIN` users fail closed and are denied access to both bill and operations endpoints.

### B. 3-Tier Admin Authentication Flow
Admin authentication requires three sequential factors:
1. **Tier 1 (Prefix Verification):** Client submits the administrator prefix manually. The prefix is a server-side high-entropy credential (minimum 16 characters), is compared in constant time, and must never be placed in `NEXT_PUBLIC_*` variables or bundled into the frontend. Production/staging/UAT startup rejects short or low-entropy prefixes. A successful check returns a short-lived `X-Tier1-Token`.
2. **Tier 2 (Password Verification):** Client submits username/mobile, password, and `X-Tier1-Token`. Password attempts are throttled by a 15-minute sliding window (max 5 failed attempts).
3. **Tier 3 (Transactional 2FA OTP):** Backend issues an encrypted challenge and dispatches a 6-digit OTP via WhatsApp Business API (with automated MSG91 SMS failover). The admin must verify this challenge within 5 minutes to receive access and refresh tokens.

### C. Single Active Session Enforcement
Both craftsmen and administrators are restricted to a single active session:
- Every login generates a new `sessionToken` recorded in PostgreSQL and cached in Redis.
- Middleware verifies that incoming JWT bearer tokens match the active `sessionToken`.
- Subsequent logins on other devices invalidate previous sessions immediately.

### D. Anti-Enumeration & Toll-Fraud Defenses on OTP Endpoints
- **Purpose-Specific Phone Validation**: On `POST /auth/send-otp` (and `POST /auth/request-otp`), requesting an OTP for `purpose = 'REGISTRATION'` for a phone number that already exists returns HTTP 200 with generic success message but suppresses actual WhatsApp/SMS delivery (`shouldSendSms = false`), preventing account enumeration and toll-fraud.
- **Login Purpose Safeguard**: Requesting OTP for `purpose = 'LOGIN'` for an unregistered mobile returns HTTP 200 with generic success message but suppresses WhatsApp/SMS delivery.
- **Strict Rate Limiting**: OTP requests are throttled per IP and per mobile number with sliding window limits and IP burst limits.

---

## 3. Cryptographic Controls & Data Privacy

### A. Data at Rest Encryption
- **PAN Card & Sensitive KYC Data:** Encrypted using **AES-256-GCM** with unique 96-bit initialization vectors (IVs) and authentication tags before persistence in PostgreSQL.
- **Blind Indexing for Searching:** Searchable PII (such as PAN and mobile numbers) utilizes **HMAC-SHA256** blind indexing with an isolated server pepper (`BLIND_INDEX_SECRET`). Blank or falsy inputs return `null` to avoid unique constraint collisions.
- **Offsite Backups:** PostgreSQL database dumps are compressed (`gzip -9`) and encrypted using **AES-256-GCM** with PBKDF2 key derivation before being uploaded to Cloudflare R2.

### B. Data in Transit
- **TLS Termination:** Cloudflare Full (Strict) TLS terminates public HTTPS traffic and forwards requests to the origin Nginx reverse proxy using Cloudflare Origin CA certificates with modern cipher suites.
- **Private S3 / R2 Links:** Invoice documents are stored in private Cloudflare R2 buckets. Downloads require short-lived HMAC-signed presigned URLs with strict `ResponseContentType` and `inline` disposition.

---

## 4. Financial Integrity & Concurrency Safeguards

1. **Pessimistic Row-Level Locking:** All wallet mutations execute inside database transactions holding `SELECT ... FOR UPDATE` row locks on the craftsman's `Wallet` record before any `Payout` locks.
2. **Double-Entry Ledger Integrity:** Every balance change is paired with an immutable `WalletTransaction` entry recording the prior balance, change amount, resulting balance, reference entity, and version timestamp.
3. **Immutable ₹50,000 Redemption Ceiling:** Redemptions are capped by code (`HARD_MAX_REDEMPTION_CEILING = 50000.00`) and fortified at the database layer via `chk_payout_amount_valid_range` (`amount > 0 AND amount <= 50000.00`). Redemption settings ceilings are also constrained by `chk_redemption_settings_maximum_ceiling`.
4. **Absolute NEFT Prohibition:** Payout rails are strictly limited to instant settlement methods (`UPI` and `IMPS`). The database enum `PaymentType` permits only `UPI` and `BANK_ACCOUNT`; worker dispatch enforces `mode: 'UPI' | 'IMPS'`. NEFT is blocked across routes, services, workers, and fallback routines.
5. **Single Default Payment Account:** Database partial unique index `PaymentAccount_user_single_default_idx` (`userId WHERE "isDefault" = true`) prevents concurrent registration of multiple default disbursement destinations.
6. **Duplicate Reward Credit Elimination:** Database partial unique index `idx_wallet_tx_bill_reward_credit_unique` (`referenceId WHERE "referenceType" = 'BILL' AND "type" = 'REWARD_CREDIT'`) rejects duplicate reward credits at the DB storage layer.
7. **Worker CAS Leases:** Background workers and webhook consumers claim jobs using 180-second atomic Compare-And-Swap (CAS) leases on `WebhookEvent.lockedUntil` with attempt fencing (`attempts` validation) on finalization to eliminate duplicate execution across cluster nodes.
8. **Reversal Invariant Assertions:** Inbound webhooks must match expected currency (`INR`) and exact paise amounts before payout state transitions occur. Any drift triggers automated manual review flags.

---

## 5. Mobile Client Security

1. **Google Play Integrity API:** Mobile app integrates Google Play Integrity hardware attestation, ensuring requests originate from genuine, untampered Android devices.
2. **Hardware Keystore:** Authentication tokens and cryptographic salts are stored in Android `SecureStore` backed by hardware Keymaster / StrongBox keystores.
3. **Developer Mode & USB Debugging Lockout:** Both customer mobile and admin mobile apps enforce banking-grade runtime blocking via Expo config plugin `withDeveloperModeSecurity` and non-dismissible `<DeveloperModeBlocker />` overlay when developer options or ADB are active in production.
4. **Network Security & Certificate Pinning:** `withNetworkSecurityConfig` installs `network_security_config.xml` into the Android APK manifest, enforcing TLS 1.3/1.2, disallowing cleartext HTTP, and pinning production certificates for `hsspl.algions.in`.
5. **No Administrative Assets in Consumer App:** All administrative screens, credentials, and prefix validation utilities have been purged from the customer mobile package.

---

## 6. Immutable Invoice Submissions & Deviation Escalation Policy

1. **Strict Submission Immutability:**
   - Under no circumstances can a Bill Admin or Operations Admin edit, overwrite, or adjust a submitted invoice amount, invoice number, invoice date, or uploaded receipt file.
   - Any client request attempting to supply `correctedGrossAmount` or alter financial parameters is rejected with HTTP 400 `IMMUTABLE_INVOICE_VIOLATION`.
   - Rewards are calculated strictly from the submitter's gross uploaded invoice amount after reverse-GST extraction.

2. **Revision Workflow & Escalation:**
   - If an invoice submission contains errors, the reviewer must `REJECT` or return it for correction with a mandatory explanation.
   - The craftsman resubmits corrected invoices as linked child revisions (`parentBillId`, auto-incremented `revisionNumber`).
   - If a revised submission exceeds the parent bill's gross amount by more than 25%, the system automatically flags `requiresSecondaryApproval = true` and initializes status to `UNDER_REVIEW`.
   - High-deviation revisions strictly require secondary approval by an `OPERATIONS_ADMIN`. Attempts by `BILL_ADMIN` return HTTP 403 `SECONDARY_APPROVAL_REQUIRED`.

3. **Legal Hold & Statutory Data Protection:**
   - Accounts under active legal investigation (`legalHold = true`) cannot be scheduled, requested, or processed for deletion.
   - In-flight financial disbursements block account deletion until banking rail status reaches a terminal verified state.
   - Statutory tax invoices and ledger entries are retained for a minimum of 72 months per CGST Act Sec 36 requirements.
