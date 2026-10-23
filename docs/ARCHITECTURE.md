# Architecture & System Design Documentation

## Hiralal and Sons Sales Pvt. Ltd. — Rewards Management System
**Production Domain:** `https://hsspl.algions.in`

---

### 1. High-Level Architecture

The platform is designed around a single unified mobile application with dynamic profession-based theme transformation, backed by a resilient TypeScript REST API and an enterprise Next.js administration portal.

```
                   ONE MOBILE APPLICATION (React Native / Expo)
                                        |
               -------------------------------------------------
               |                       |                       |
          NEUTRAL MODE            PLUMBER MODE            TILES MODE
               |                       |                       |
         Neutral Branding       Vibrant Blue (#1E60D5)  Terracotta Orange (#E65100)
       "More Work. More Rewards" Plumbing Illustrations   Tile Stack Illustrations
                                       |
                              UNIFIED CORE FEATURES
                         Bills • Rewards • Wallet • Payouts
                                       |
                         Node.js / Express REST API (Port 5000)
                                       |
         -------------------------------------------------------------
         |                |                  |                       |
   PostgreSQL 16    Cloudflare R2        RazorpayX          SignCare / Meta / MSG91
    Prisma ORM    (Private Invoices)   (Payouts & Webhooks)  (KYC PAN / WhatsApp & SMS OTP)
```

---

### 2. Dynamic Profession Theme Engine

The mobile application **strictly does not duplicate screens or maintain two codebases**. Instead, a dynamic Theme Provider loads configuration according to `user.profession`:

| Theme Property | NEUTRAL Mode | PLUMBER Mode | TILES MODE |
| :--- | :--- | :--- | :--- |
| **Primary Color** | `#1E60D5` | `#1E60D5` (Vibrant Blue) | `#E65100` (Terracotta) |
| **Light Accent** | `#F1F5F9` | `#EBF3FE` | `#FFF3E0` |
| **Display Name** | Rewards Partner | Plumber | Tile Installer |
| **Reward Title** | Rewards Program | Plumbing Rewards | Tile Rewards |
| **Upload Title** | Upload Purchase Bill | Upload Plumbing Bill | Upload Tile Bill |
| **Hero Graphics** | `welcome_neutral.png` | `plumber_hero.png` | `tiles_hero.png` |
| **Worker Illustration** | `hero_neutral.png` | `worker_plumber.png` | `worker_tile.png` |

---

### 3. Financial Ledger & Immutable Transaction Integrity

To maintain commercial-grade accounting integrity:
1. **Never directly overwrite wallet balances**: Every addition or deduction generates an immutable `WalletTransaction` entry recording:
   - `amount`
   - `type` (`REWARD_CREDIT`, `PAYOUT_DEBIT`, `PAYOUT_REVERSAL`)
   - `balanceAfter`
   - `referenceType` (`BILL`, `PAYOUT`, `ADMIN`)
   - `referenceId`
2. **Double-Entry Ledger Parity**: Ledger consistency enforces `wallet.availableBalance - wallet.deficitLiability = Σ WalletTransaction`. In the event of late settlement or deficit adjustments, PostgreSQL check constraint `chk_wallet_balance_non_negative` strictly guarantees `availableBalance >= 0`, while platform debt is explicitly recorded in `deficitLiability` (`chk_wallet_deficit_liability_non_negative`). Net wallet equity is mathematically modeled as `availableBalance - deficitLiability = totalEarned - totalRedeemed - processingAmount`, preserving double-entry ledger parity without negative balance clamping.
3. **Pessimistic & Optimistic Concurrency**: Financial transactions lock the wallet row (`SELECT ... FOR UPDATE`) inside atomic database transactions and track an incrementing `version` field.
4. **Append-Only Audit Log Immutability**: PostgreSQL trigger `trg_audit_log_immutable` strictly prohibits `UPDATE` and `DELETE` operations on `AuditLog`, ensuring permanent tamper-evident audit trails.

---

### 4. Authoritative Reward Rules & Reverse GST Calculation Basis

1. **Dynamic Reward Rules (No Hardcoded Fallback)**:
   - Reward percentages are dynamically configured per profession (`PLUMBER`, `TILE_INSTALLER`) by Operations Administrators via effective-dated database records.
   - There is no hardcoded fallback percentage or hidden default rate.
2. **Effective-Dated Database Rules & Anti-Arbitrage**:
   - The database table `RewardRule` is authoritative for calculations.
   - When a bill is approved, the rule active on the bill's server submission timestamp (`createdAt`) is resolved:
     `effectiveFrom <= bill.createdAt AND (effectiveUntil IS NULL OR effectiveUntil > bill.createdAt)`.
   - Resolving against the server-recorded `createdAt` timestamp (rather than the claimed invoice date) eliminates rate arbitrage and backdated invoice manipulation.
   - The rate snapshot (`rewardRateSnapshot`) is immutably recorded on the `Bill`.
3. **GST Reverse-Calculation Formula**:
   - **GST-Excluded / Zero GST**:
     `gstAmount = 0.00`
     `eligibleAmount = grossBillAmount`
   - **GST-Inclusive Invoices**:
     `gstAmount = roundMoney(grossBillAmount * rate / (100 + rate))`
     `eligibleAmount = roundMoney(grossBillAmount - gstAmount)`
   - **Reward Credit**:
     `calculatedReward = roundMoney(eligibleAmount * rewardPercentage / 100)`
4. **Pool-Free Model, Limits & Payment Rails**:
   - No monthly reward caps or global reward pools.
   - Configurable minimum redemption threshold (`minimumRedemptionAmount`) enforced dynamically per window by Operations Admin.
   - **Hard Per-Redemption Ceiling**: An independent platform ceiling of ₹50,000 (5,000,000 paise) is enforced unconditionally on all single redemptions on the backend.
   - **Configurable Maximum Threshold**: Operations Admin can set `maximumRedemptionAmount` between ₹0 and ₹50,000. Setting the maximum to ₹0 explicitly disables redemptions.
   - **Concurrency-Safe Daily Limit**: A strict daily limit of ₹50,000 per user per calendar day in IST is aggregated and verified atomically under transaction locks.
   - **Permitted Payout Rails**: Disbursed strictly through verified `UPI` and `IMPS` rails. Initiation of payouts through NEFT or any unsupported rail is strictly prohibited and fails closed.

---

### 5. Payout State Machine (Two-Tier Operations Approval & RazorpayX Integration)

Payouts transition through an explicit multi-stage workflow:

```
[ REQUESTED / PENDING ]  ---> (Craftsman requests 100% full eligible balance redemption)
     |
     v  (Operations Admin reviews KYC, provider verification & ledger solvency)
[ APPROVED ]
     |
     v  (Dispatched to RazorpayX gateway daemon)
[ PROCESSING / PAYOUT_INITIATED ]  ---> (Ledger Debits Wallet availableBalance, increments processingAmount)
     |
     +--- Webhook 'payout.processed' ---> [ SUCCESS ]
     |                                          (processingAmount decremented, totalRedeemed incremented)
     |
     +--- Webhook 'payout.reversed'  ---> [ FAILED / REVERSED ]
                                                (Ledger credits availableBalance back as PAYOUT_REVERSAL)
```

---

### 6. Payment Account Verification & Authoritative Beneficiary Match

Financial integrity requires strict bank-side name verification before funds can be redeemed:
1. **Provider Verification (`providerNameVerified`)**:
   - `PaymentAccount.providerNameVerified` defaults to `false`.
   - Set to `true` strictly when RazorpayX fund account validation returns `active: true` and a registered provider name (`registered_name` or `name`).
2. **PAN vs. Beneficiary Matching (Exact Normalized Name Policy)**:
   - Both `checkUserEligibility` and `requestRedemption` enforce `validateBeneficiaryMatch`.
   - Requires verified payment account, `providerNameVerified === true`, `panStatus === 'VERIFIED'`, and `areNamesMatching(beneficiaryName, panHolderName)` returning `true`.
   - **Strict Matching Policy**: The beneficiary name must match the verified PAN holder name **exactly** after removing approved prefixes (`MR`, `MRS`, `MS`, `DR`, `SHRI`, `SHREE`, `SRI`, `SMT`, `KUMARI`, `M/S`). All fuzzy matching (Levenshtein, Jaro-Winkler), subset matching, token swapping, initials expansion, and surname-omission matching are strictly prohibited.
   - Genuine name tokens containing prefix syllables (e.g. `SRIDHAR`, `KUMAR`, `ANITA KUMARI`) are preserved.
   - Payout requests fail if exact identity congruence is not met.
3. **Mononymous Name Locking**:
   - Approving a mononymous customer via KYC exception atomically sets `isNameLocked = true` and `nameLockedAt = new Date()`.
   - The user profile route permanently prohibits name updates once `isNameLocked` is set or if verified KYC records exist.

---

### 7. Dual Authentication & Role Segregation

The platform enforces strict role-based separation:
- **`BILL_ADMIN`**: Gated to Bill verification (`GET /api/v1/admin/bills`, `GET /api/v1/admin/bills/:id/document-url`, `POST /api/v1/admin/bills/:id/verify`) and read-only dashboard overview.
- **`OPERATIONS_ADMIN`**: Gated to Payout approval/rejection (`/api/v1/admin/payouts`), user directory, settings (reward rules, GST rules, redemption windows), audit logs, and broadcast notifications.
- **Legacy `ADMIN` Role**: Deprecated and fails closed. Blocked from accessing admin routes. Must be migrated forward using `migrate-legacy-admin.ts`.
- **Password-First Admin Two-Factor Auth**: Admin credentials require password validation FIRST before issuing a single-use verification challenge and dispatching transactional OTP. Admin sessions enforce single active sessions across devices.

---

### 8. Firebase Cloud Messaging (FCM HTTP v1) Push Delivery

Push notifications use the Google OAuth2 service-account protocol:
1. Backend exchanges service-account credentials for short-lived Google OAuth2 Bearer tokens (`https://oauth2.googleapis.com/token`).
2. Dispatches notifications directly to Google FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`).
3. Handles `UNREGISTERED` / `NOT_FOUND` token errors by automatically deactivating stale tokens in `PushDeviceToken`.
4. In-app notifications persist independently in the database even if push delivery is skipped or fails.
