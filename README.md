# HIRALAL AND SONS SALES PVT. LTD.
## Plumber & Tiles Rewards Management Application

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-Expo-black.svg)](https://expo.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-teal.svg)](https://www.prisma.io/)
[![Tests](https://img.shields.io/badge/Tests-24%20Passing-brightgreen.svg)]()

Production-quality full-stack Rewards Management Platform built exclusively for **Hiralal and Sons Sales Pvt. Ltd.** The application incentivizes plumbers and tile installers across India through automated reward calculations, instant digital KYC, and seamless payouts.

---

## 📸 Visual Design & Profession-Specific Identity

Inspired directly by the brand assets and visual references of Hiralal & Sons:
- **One Unified Mobile Application**: Dynamic theme switcher transforms the layout, wording, illustrations, and color palette based on `user.profession`.
- **Plumber Mode**: Vibrant Blue (`#1E60D5`), custom chrome tap, water splashes & pipe illustrations, and terminology (*"Plumbing Rewards"*, *"Upload Plumbing Bill"*).
- **Tiles Mode**: Terracotta / Warm Orange (`#E65100`), ceramic tiles, flooring & adhesive illustrations, and terminology (*"Tile Rewards"*, *"Upload Tile Bill"*).
- **Neutral Mode**: Hiralal & Sons corporate identity (*"More Work. More Rewards."*) used prior to profession selection.

---

## 🏗️ Repository Architecture

```
/hiralal
├── /backend            # Node.js / Express / Prisma TypeScript API (Port 5000)
│   ├── /prisma         # PostgreSQL schema & migration scripts
│   ├── /src/db         # Resilient database layer & seed store
│   ├── /src/routes     # REST API routes (Auth, Bills, Rewards, Wallet, Payouts, Admin)
│   ├── /src/services   # Business logic (Reward engine, Pool cap, KYC, RazorpayX)
│   └── /src/tests      # Jest test suite (24 passing unit & integration tests)
├── /mobile             # React Native / Expo TypeScript App (iOS, Android, Web)
│   ├── /src/theme      # Dynamic profession theme engine (Plumber / Tiles / Neutral)
│   ├── /src/screens    # Home, Bills, Rewards, Wallet, Profile, Upload, KYC & Payouts
│   └── /src/components # Reusable responsive UI components
├── /admin              # Next.js 14 / TypeScript / Tailwind CSS Admin Portal (Port 3000)
│   ├── /src/pages      # Dashboard, Users, Bills Verification, Payouts, Settings, Logs
│   └── /src/components # Bill verification modals, Reward pool tracking progress bar
├── /shared             # Sliced visual reference assets & shared TypeScript types
├── /docs               # Architecture, API specs, and deployment guides
├── docker-compose.yml  # Multi-container PostgreSQL, Backend, and Admin setup
└── README.md           # Project documentation
```

---

## ⚡ Quick Start Guide

### Prerequisites
- Node.js 18+ (tested on Node v22)
- npm 9+
- Docker & Docker Compose (optional for containerized deployment)

---

### 1. Database Setup
The backend supports PostgreSQL via Prisma ORM and automatically connects when `DATABASE_URL` is set. It also includes an embedded database adapter so that developers can test immediately without external dependencies:

```bash
cd backend
npm install
npx prisma generate
```

To run PostgreSQL via Docker:
```bash
docker compose up -d postgres
```

To seed initial database records:
```bash
npm run seed
```

---

### 2. Running the Backend API
```bash
cd backend
npm run dev
```
The REST API will start at **`http://localhost:5000`**.
Health check: **`http://localhost:5000/health`**

To run the automated test suite (24 tests):
```bash
npm test
```

---

### 3. Running the Admin Web Dashboard
```bash
cd admin
npm install
npm run dev
```
Open **`http://localhost:3000`** in your browser to access the administrative dashboard.

---

### 4. Running the Mobile Application
```bash
cd mobile
npm install
npx expo start --web
```
This opens the responsive mobile application in your web browser (with authentic smartphone dimensions), or scan the QR code using the **Expo Go** app on Android or iOS!

---

## 🔑 Demo Credentials

| Role | Mobile / Identifier | Password | Default Profession | Rewards Balance |
| :--- | :--- | :--- | :--- | :--- |
| **Plumber** | `9876543210` | `Password@123` | **PLUMBER** | ₹2,450.00 |
| **Tile Installer** | `9876543211` | `Password@123` | **TILE_INSTALLER** | ₹3,120.00 |
| **Super Admin** | `9999999999` | `Admin@123` | Admin Portal | Master Access |

> **Development OTP**: Any mobile verification request accepts OTP **`123456`**.

---

## 💼 Core Business Rules Implemented

1. **Backend-Calculated Rewards**: Client-submitted reward calculations are never trusted. All rewards are computed strictly on the backend:
   $$\text{Reward} = \text{Bill Amount} \times 0.5\%$$
   *(Example: ₹1,00,000 bill = ₹500 reward)*
2. **Monthly ₹50,000 Pool Cap**: The system atomically checks and enforces the monthly program ceiling ($₹37,850 / ₹50,000$ or $75.7\%$ used), preventing over-allocation.
3. **Immutable Financial Ledger**: Wallet balances cannot be overwritten without recording an explicit `WalletTransaction` entry (`REWARD_CREDIT`, `PAYOUT_DEBIT`, `PAYOUT_REVERSAL`).
4. **Deferred KYC**: Registration is fast and frictionless (Mobile + OTP + Password). Identity (PAN) and payment verification (UPI/Bank) are only requested at payout redemption.
5. **Private Invoices & Signed URLs**: Invoices uploaded to Cloudflare R2 are never public. Files are accessed via time-limited cryptographic HMAC URLs.
6. **Idempotent Payouts**: Payout redemptions require an `idempotencyKey` to prevent duplicate transactions. Webhooks verify HMAC signatures before state transitions.

---

## 🛠️ Environment Variables Reference

See `.env.example` in the root directory:

```env
PORT=5000
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/hiralal_rewards?schema=public"
JWT_SECRET=hiralal_super_secret_jwt_key_2026_rewards_secure

# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID=cf_acc_hiralal_sales_r2
CLOUDFLARE_R2_ACCESS_KEY_ID=r2_access_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=r2_secret_key
CLOUDFLARE_R2_BUCKET_NAME=hiralal-invoices-private

# RazorpayX
RAZORPAYX_KEY_ID=rzp_live_...
RAZORPAYX_KEY_SECRET=...
RAZORPAYX_ACCOUNT_NUMBER=2323230041123456
RAZORPAYX_WEBHOOK_SECRET=...

# Program Settings
DEFAULT_REWARD_PERCENTAGE=0.5
MONTHLY_REWARD_POOL_CAP=50000
MIN_REDEMPTION_AMOUNT=500
```

---

## 🚢 Production Deployment

To deploy all services using Docker:

```bash
docker compose up -d --build
```

This runs:
- **PostgreSQL 16 Database**: `localhost:5432`
- **Backend API**: `http://localhost:5000`
- **Admin Dashboard**: `http://localhost:3000`

---

## 📄 License & Ownership
Copyright © 2026 **Hiralal and Sons Sales Pvt. Ltd.** All Rights Reserved.
