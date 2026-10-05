-- Hiralal & Sons Sales Pvt. Ltd. Rewards Program Database Initialization
-- PostgreSQL 16+ Migration DDL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE "Profession" AS ENUM ('PLUMBER', 'TILE_INSTALLER');
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE');
CREATE TYPE "TransactionType" AS ENUM ('REWARD_CREDIT', 'PAYOUT_DEBIT', 'PAYOUT_REVERSAL', 'MANUAL_ADJUSTMENT');
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "PaymentType" AS ENUM ('UPI', 'BANK_ACCOUNT');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PAYOUT_INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED');
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'FORGOT_PASSWORD', 'LOGIN');

-- 1. Users Table
CREATE TABLE "User" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "mobile" VARCHAR(15) UNIQUE NOT NULL,
    "fullName" VARCHAR(100) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "profession" "Profession",
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_mobile ON "User"("mobile");
CREATE INDEX idx_user_profession ON "User"("profession");
CREATE INDEX idx_user_role ON "User"("role");

-- 2. Wallets Table
CREATE TABLE "Wallet" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" VARCHAR(64) UNIQUE NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "availableBalance" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    "processingAmount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    "totalRedeemed" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    "version" INT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_userid ON "Wallet"("userId");

-- 3. Immutable Wallet Transactions (Ledger)
CREATE TABLE "WalletTransaction" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "walletId" VARCHAR(64) NOT NULL REFERENCES "Wallet"("id") ON DELETE CASCADE,
    "userId" VARCHAR(64) NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "amount" NUMERIC(12, 2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "balanceAfter" NUMERIC(12, 2) NOT NULL,
    "referenceType" VARCHAR(50) NOT NULL,
    "referenceId" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wt_walletid ON "WalletTransaction"("walletId");
CREATE INDEX idx_wt_userid ON "WalletTransaction"("userId");
CREATE INDEX idx_wt_createdat ON "WalletTransaction"("createdAt");

-- 4. Bills Table
CREATE TABLE "Bill" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" VARCHAR(64) NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "invoiceNumber" VARCHAR(100) NOT NULL,
    "invoiceDate" TIMESTAMP WITH TIME ZONE NOT NULL,
    "billAmount" NUMERIC(12, 2) NOT NULL,
    "calculatedReward" NUMERIC(12, 2) NOT NULL,
    "rewardPercentage" NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "verifiedByAdminId" VARCHAR(64),
    "remarks" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_invoice_unique UNIQUE ("userId", "invoiceNumber")
);

CREATE INDEX idx_bill_userid ON "Bill"("userId");
CREATE INDEX idx_bill_status ON "Bill"("status");
CREATE INDEX idx_bill_invoicenumber ON "Bill"("invoiceNumber");

-- 5. Monthly Reward Pool Table (Atomically Enforces ₹50,000 Cap)
CREATE TABLE "RewardPool" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "year" INT NOT NULL,
    "month" INT NOT NULL,
    "totalPoolCap" NUMERIC(12, 2) NOT NULL DEFAULT 50000.00,
    "usedAmount" NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    "isCapped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pool_year_month_unique UNIQUE ("year", "month")
);

-- 6. Reward Rules Table
CREATE TABLE "RewardRule" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "profession" "Profession",
    "percentage" NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    "monthlyPoolLimit" NUMERIC(12, 2) NOT NULL DEFAULT 50000.00,
    "minRedemptionAmount" NUMERIC(12, 2) NOT NULL DEFAULT 500.00,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByAdminId" VARCHAR(64),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. KYC Records Table (PAN)
CREATE TABLE "KycRecord" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" VARCHAR(64) NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "panNumber" VARCHAR(15) NOT NULL,
    "panName" VARCHAR(100) NOT NULL,
    "panStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "maskedPan" VARCHAR(20) NOT NULL,
    "verifiedAt" TIMESTAMP WITH TIME ZONE,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_userid ON "KycRecord"("userId");

-- 8. Payment Accounts Table (UPI & Bank)
CREATE TABLE "PaymentAccount" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" VARCHAR(64) NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "accountType" "PaymentType" NOT NULL,
    "upiId" VARCHAR(100),
    "accountHolderName" VARCHAR(100),
    "accountNumber" VARCHAR(50),
    "ifscCode" VARCHAR(20),
    "bankName" VARCHAR(100),
    "maskedInfo" VARCHAR(100) NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP WITH TIME ZONE,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pa_userid ON "PaymentAccount"("userId");

-- 9. Payouts Table
CREATE TABLE "Payout" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "userId" VARCHAR(64) NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "walletId" VARCHAR(64) NOT NULL REFERENCES "Wallet"("id") ON DELETE CASCADE,
    "amount" NUMERIC(12, 2) NOT NULL,
    "paymentAccountId" VARCHAR(64) NOT NULL REFERENCES "PaymentAccount"("id") ON DELETE CASCADE,
    "paymentType" "PaymentType" NOT NULL,
    "idempotencyKey" VARCHAR(100) UNIQUE NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayPayoutId" VARCHAR(100),
    "razorpayFundAccountId" VARCHAR(100),
    "failureReason" TEXT,
    "initiatedAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payout_userid ON "Payout"("userId");
CREATE INDEX idx_payout_status ON "Payout"("status");
CREATE INDEX idx_payout_idem ON "Payout"("idempotencyKey");

-- 10. Audit Logs Table
CREATE TABLE "AuditLog" (
    "id" VARCHAR(64) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    "adminId" VARCHAR(64) REFERENCES "User"("id") ON DELETE SET NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" VARCHAR(100) NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_adminid ON "AuditLog"("adminId");
CREATE INDEX idx_audit_action ON "AuditLog"("action");
