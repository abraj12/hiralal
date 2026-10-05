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

### 4. Monthly ₹50,000 Reward Pool Atomic Enforcement

The program strictly enforces a ceiling of **₹50,000 per calendar month** across all submitted bills:
1. When an administrator approves a bill, the system recalculates `reward = billAmount * 0.005`.
2. The system checks `currentUsed + calculatedReward <= 50,000`.
3. If the cap is reached, the transaction is rejected or flagged as capped, protecting business liquidity.

---

### 5. Payout State Machine (RazorpayX Integration)

Payouts transition through an explicit state machine:

```
[ PENDING ]
     |
     v
[ PROCESSING ]  ---> (Ledger Debits Wallet availableBalance, increments processingAmount)
     |
     +--- Webhook 'payout.processed' ---> [ SUCCESS ]
     |                                          (processingAmount decremented, totalRedeemed incremented)
     |
     +--- Webhook 'payout.reversed'  ---> [ FAILED / REVERSED ]
                                                (Ledger credits availableBalance back as PAYOUT_REVERSAL)
```
