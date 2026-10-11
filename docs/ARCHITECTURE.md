# Architecture & System Design Documentation

## Hiralal and Sons Sales Pvt. Ltd. - Rewards Management System

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
   PostgreSQL 16    Cloudflare R2        RazorpayX               Indian SMS / KYC
    Prisma ORM    (Private Invoices)   (Payouts & Webhooks)      (Surepass / Mock)
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
   - `type` (`REWARD_CREDIT`, `PAYOUT_DEBIT`, `PAYOUT_REVERSAL`, `MANUAL_ADJUSTMENT`)
   - `balanceAfter`
   - `referenceType` (`BILL`, `PAYOUT`, `ADMIN`)
   - `referenceId`
2. **Optimistic Locking & Concurrency**: The `Wallet` entity tracks an incrementing `version` field to prevent race conditions during concurrent disbursements.

---

### 4. Pool-Free Reward Distribution & Dynamic Rule Versioning

The platform operates without artificial reward budget pool caps:
1. Valid bills submitted by verified plumbers and tile installers are approved and rewarded in full based on server-side versioned business rules, regardless of historical volume or monthly total amounts.
2. Rewards are computed strictly on the backend at 2-decimal paise precision (`eligibleAmount * rewardPercentage / 100`).
3. Rule updates by Operations Admins generate new versioned rules (`RewardRule.version`), preserving immutable historical calculations for all previously approved bills.
4. Concurrency boundary tests with `Promise.allSettled()` verify atomic double-entry ledger transactions and idempotent approval state transitions.

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
   - Insecure fallbacks to user-provided input strings or profile full names are strictly prohibited.
2. **PAN vs. Beneficiary Matching**:
   - Both `checkUserEligibility` and `requestRedemption` enforce `validateBeneficiaryMatch`.
   - Requires verified payment account, `providerNameVerified === true`, `panStatus === 'VERIFIED'`, and `areNamesMatching(beneficiaryName, panHolderName)` returning true with >= 0.75 Jaro-Winkler similarity.
   - Payout requests fail with `BENEFICIARY_PAN_MISMATCH` if identity congruence is not met.

---

### 7. Dual Authentication & Admin Web Portal Protection

The platform supports unified API security across mobile and web:
1. **Mobile App**:
   - Authenticates via `Authorization: Bearer <token>`.
   - Standard mobile flow without browser cookie constraints or CORS restrictions.
2. **Admin Web Portal**:
   - Issues secure, HTTP-only, `SameSite=Lax` cookie `admin_access_token` on administrative login.
   - Protected with CSRF/Origin validation: mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) require verified `Origin` or `X-Requested-With: XMLHttpRequest` matching configured admin origins.
