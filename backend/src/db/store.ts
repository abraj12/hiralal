import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma, getDatabaseStatus } from './index';

export interface UserRecord {
  id: string;
  mobile: string;
  fullName: string;
  passwordHash: string;
  profession?: 'PLUMBER' | 'TILE_INSTALLER';
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletRecord {
  id: string;
  userId: string;
  availableBalance: number;
  processingAmount: number;
  totalRedeemed: number;
  version: number;
  updatedAt: Date;
}

export interface WalletTransactionRecord {
  id: string;
  walletId: string;
  userId: string;
  amount: number;
  type: 'REWARD_CREDIT' | 'PAYOUT_DEBIT' | 'PAYOUT_REVERSAL' | 'MANUAL_ADJUSTMENT';
  balanceAfter: number;
  referenceType: string;
  referenceId: string;
  description: string;
  createdAt: Date;
}

export interface BillRecord {
  id: string;
  userId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  billAmount: number;
  calculatedReward: number;
  rewardPercentage: number;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'DUPLICATE';
  fileUrl: string;
  fileKey: string;
  rejectionReason?: string | null;
  verifiedByAdminId?: string | null;
  remarks?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RewardPoolRecord {
  id: string;
  year: number;
  month: number;
  totalPoolCap: number;
  usedAmount: number;
  isCapped: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RewardRuleRecord {
  id: string;
  profession?: 'PLUMBER' | 'TILE_INSTALLER';
  percentage: number;
  monthlyPoolLimit: number;
  minRedemptionAmount: number;
  isActive: boolean;
  updatedByAdminId?: string | null;
  updatedAt: Date;
}

export interface KycRecordData {
  id: string;
  userId: string;
  panNumber: string;
  panName: string;
  panStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  maskedPan: string;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAccountRecord {
  id: string;
  userId: string;
  accountType: 'UPI' | 'BANK_ACCOUNT';
  upiId?: string | null;
  accountHolderName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  bankName?: string | null;
  maskedInfo: string;
  isVerified: boolean;
  verifiedAt?: Date | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutRecord {
  id: string;
  userId: string;
  walletId: string;
  amount: number;
  paymentAccountId: string;
  paymentType: 'UPI' | 'BANK_ACCOUNT';
  idempotencyKey: string;
  status: 'PENDING' | 'APPROVED' | 'PAYOUT_INITIATED' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  razorpayPayoutId?: string | null;
  razorpayFundAccountId?: string | null;
  failureReason?: string | null;
  initiatedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OtpRecord {
  id: string;
  mobile: string;
  otpCode: string;
  purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN';
  attemptsCount: number;
  isUsed: boolean;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: string;
  adminId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
}

// Memory database storage
class MemoryDatabase {
  users: Map<string, UserRecord> = new Map();
  wallets: Map<string, WalletRecord> = new Map();
  walletTransactions: Map<string, WalletTransactionRecord> = new Map();
  bills: Map<string, BillRecord> = new Map();
  rewardPools: Map<string, RewardPoolRecord> = new Map();
  rewardRules: Map<string, RewardRuleRecord> = new Map();
  kycRecords: Map<string, KycRecordData> = new Map();
  paymentAccounts: Map<string, PaymentAccountRecord> = new Map();
  payouts: Map<string, PayoutRecord> = new Map();
  otpRequests: Map<string, OtpRecord> = new Map();
  auditLogs: Map<string, AuditLogRecord> = new Map();
  notifications: Map<string, NotificationRecord> = new Map();

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    const passwordHash = bcrypt.hashSync('Password@123', 10);
    const adminPasswordHash = bcrypt.hashSync('Admin@123', 10);

    // 1. Plumber: Raj Kumar
    const rajId = 'user-plumber-raj';
    const raj: UserRecord = {
      id: rajId,
      mobile: '9876543210',
      fullName: 'Raj Kumar',
      passwordHash,
      profession: 'PLUMBER',
      role: 'USER',
      status: 'ACTIVE',
      isVerified: true,
      createdAt: new Date('2026-08-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    };
    this.users.set(raj.id, raj);

    const rajWallet: WalletRecord = {
      id: 'wallet-raj',
      userId: rajId,
      availableBalance: 1600.0,
      processingAmount: 850.0,
      totalRedeemed: 2000.0,
      version: 5,
      updatedAt: new Date(),
    };
    this.wallets.set(rajWallet.id, rajWallet);

    const rajKyc: KycRecordData = {
      id: 'kyc-raj',
      userId: rajId,
      panNumber: 'ABCDE1234F',
      panName: 'RAJ KUMAR',
      panStatus: 'VERIFIED',
      maskedPan: 'ABCDE••••F',
      verifiedAt: new Date('2026-08-05T12:00:00Z'),
      createdAt: new Date('2026-08-05T12:00:00Z'),
      updatedAt: new Date('2026-08-05T12:00:00Z'),
    };
    this.kycRecords.set(rajKyc.id, rajKyc);

    const rajPayment: PaymentAccountRecord = {
      id: 'pm-raj-upi',
      userId: rajId,
      accountType: 'UPI',
      upiId: 'rajkumar@okhdfcbank',
      maskedInfo: 'raj****@okhdfcbank',
      isVerified: true,
      verifiedAt: new Date('2026-08-05T12:30:00Z'),
      isDefault: true,
      createdAt: new Date('2026-08-05T12:30:00Z'),
      updatedAt: new Date('2026-08-05T12:30:00Z'),
    };
    this.paymentAccounts.set(rajPayment.id, rajPayment);

    // 2. Tile Installer: Amit Kumar
    const amitId = 'user-tile-amit';
    const amit: UserRecord = {
      id: amitId,
      mobile: '9876543211',
      fullName: 'Amit Kumar',
      passwordHash,
      profession: 'TILE_INSTALLER',
      role: 'USER',
      status: 'ACTIVE',
      isVerified: true,
      createdAt: new Date('2026-08-10T11:00:00Z'),
      updatedAt: new Date('2026-10-01T11:00:00Z'),
    };
    this.users.set(amit.id, amit);

    const amitWallet: WalletRecord = {
      id: 'wallet-amit',
      userId: amitId,
      availableBalance: 2170.0,
      processingAmount: 950.0,
      totalRedeemed: 3500.0,
      version: 6,
      updatedAt: new Date(),
    };
    this.wallets.set(amitWallet.id, amitWallet);

    const amitKyc: KycRecordData = {
      id: 'kyc-amit',
      userId: amitId,
      panNumber: 'FGHIJ5678K',
      panName: 'AMIT KUMAR',
      panStatus: 'VERIFIED',
      maskedPan: 'FGHIJ••••K',
      verifiedAt: new Date('2026-08-12T14:00:00Z'),
      createdAt: new Date('2026-08-12T14:00:00Z'),
      updatedAt: new Date('2026-08-12T14:00:00Z'),
    };
    this.kycRecords.set(amitKyc.id, amitKyc);

    const amitPayment: PaymentAccountRecord = {
      id: 'pm-amit-bank',
      userId: amitId,
      accountType: 'BANK_ACCOUNT',
      bankName: 'HDFC Bank',
      accountHolderName: 'Amit Kumar',
      accountNumber: '50100234569012',
      ifscCode: 'HDFC0001234',
      maskedInfo: 'HDFC Bank ••••••9012',
      isVerified: true,
      verifiedAt: new Date('2026-08-12T14:15:00Z'),
      isDefault: true,
      createdAt: new Date('2026-08-12T14:15:00Z'),
      updatedAt: new Date('2026-08-12T14:15:00Z'),
    };
    this.paymentAccounts.set(amitPayment.id, amitPayment);

    // 3. Admin User
    const adminId = 'user-admin-hiralal';
    const admin: UserRecord = {
      id: adminId,
      mobile: '9999999999',
      fullName: 'Hiralal Admin',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isVerified: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.users.set(admin.id, admin);

    // Seed Current Month's Reward Pool (e.g. Oct 2026 or current date)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const poolId = `pool-${currentYear}-${currentMonth}`;

    const pool: RewardPoolRecord = {
      id: poolId,
      year: currentYear,
      month: currentMonth,
      totalPoolCap: 50000.0,
      usedAmount: 37850.0, // Matching the spec: ₹37,850 / ₹50,000 (75.7% Used)
      isCapped: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rewardPools.set(pool.id, pool);

    // Seed Reward Rules
    const defaultRule: RewardRuleRecord = {
      id: 'rule-default',
      percentage: 0.5, // 0.5%
      monthlyPoolLimit: 50000.0,
      minRedemptionAmount: 500.0,
      isActive: true,
      updatedAt: new Date(),
    };
    this.rewardRules.set(defaultRule.id, defaultRule);

    // Seed Sample Bills for Raj (Plumber)
    const sampleBillsRaj: BillRecord[] = [
      {
        id: 'bill-1024',
        userId: rajId,
        invoiceNumber: 'INV-2026-1024',
        invoiceDate: new Date('2026-10-02T10:00:00Z'),
        billAmount: 50000.0,
        calculatedReward: 250.0,
        rewardPercentage: 0.5,
        status: 'APPROVED',
        fileUrl: '/uploads/sample-bill-1.pdf',
        fileKey: 'bills/sample-bill-1.pdf',
        verifiedByAdminId: adminId,
        remarks: 'Pipes & CPVC fittings',
        createdAt: new Date('2026-10-02T10:15:00Z'),
        updatedAt: new Date('2026-10-02T14:30:00Z'),
      },
      {
        id: 'bill-1023',
        userId: rajId,
        invoiceNumber: 'INV-2026-1023',
        invoiceDate: new Date('2026-09-30T10:00:00Z'),
        billAmount: 80000.0,
        calculatedReward: 400.0,
        rewardPercentage: 0.5,
        status: 'PENDING',
        fileUrl: '/uploads/sample-bill-2.pdf',
        fileKey: 'bills/sample-bill-2.pdf',
        remarks: 'Sanitary fixtures & water taps',
        createdAt: new Date('2026-09-30T11:20:00Z'),
        updatedAt: new Date('2026-09-30T11:20:00Z'),
      },
      {
        id: 'bill-1022',
        userId: rajId,
        invoiceNumber: 'INV-2026-1022',
        invoiceDate: new Date('2026-09-28T10:00:00Z'),
        billAmount: 25000.0,
        calculatedReward: 125.0,
        rewardPercentage: 0.5,
        status: 'APPROVED',
        fileUrl: '/uploads/sample-bill-3.pdf',
        fileKey: 'bills/sample-bill-3.pdf',
        verifiedByAdminId: adminId,
        remarks: 'Brass valves and connectors',
        createdAt: new Date('2026-09-28T09:00:00Z'),
        updatedAt: new Date('2026-09-28T16:00:00Z'),
      },
      {
        id: 'bill-1021',
        userId: rajId,
        invoiceNumber: 'INV-2026-1021',
        invoiceDate: new Date('2026-09-25T10:00:00Z'),
        billAmount: 90000.0,
        calculatedReward: 450.0,
        rewardPercentage: 0.5,
        status: 'UNDER_REVIEW',
        fileUrl: '/uploads/sample-bill-4.pdf',
        fileKey: 'bills/sample-bill-4.pdf',
        remarks: 'Main pipeline CPVC 2 inch pipes',
        createdAt: new Date('2026-09-25T14:10:00Z'),
        updatedAt: new Date('2026-09-25T14:10:00Z'),
      },
    ];

    sampleBillsRaj.forEach(b => this.bills.set(b.id, b));

    // Seed Sample Bills for Amit (Tiles)
    const sampleBillsAmit: BillRecord[] = [
      {
        id: 'bill-2031',
        userId: amitId,
        invoiceNumber: 'INV-2026-2031',
        invoiceDate: new Date('2026-10-02T11:00:00Z'),
        billAmount: 60000.0,
        calculatedReward: 300.0,
        rewardPercentage: 0.5,
        status: 'APPROVED',
        fileUrl: '/uploads/sample-bill-5.pdf',
        fileKey: 'bills/sample-bill-5.pdf',
        verifiedByAdminId: adminId,
        remarks: 'GVT Floor Tiles 600x1200mm',
        createdAt: new Date('2026-10-02T11:15:00Z'),
        updatedAt: new Date('2026-10-02T15:30:00Z'),
      },
      {
        id: 'bill-2030',
        userId: amitId,
        invoiceNumber: 'INV-2026-2030',
        invoiceDate: new Date('2026-09-20T10:00:00Z'),
        billAmount: 120000.0,
        calculatedReward: 600.0,
        rewardPercentage: 0.5,
        status: 'APPROVED',
        fileUrl: '/uploads/sample-bill-6.pdf',
        fileKey: 'bills/sample-bill-6.pdf',
        verifiedByAdminId: adminId,
        remarks: 'Tile Adhesives & Epoxy Grouts',
        createdAt: new Date('2026-09-20T12:00:00Z'),
        updatedAt: new Date('2026-09-20T17:00:00Z'),
      },
      {
        id: 'bill-2029',
        userId: amitId,
        invoiceNumber: 'INV-2026-2029',
        invoiceDate: new Date('2026-09-26T10:00:00Z'),
        billAmount: 50000.0,
        calculatedReward: 250.0,
        rewardPercentage: 0.5,
        status: 'PENDING',
        fileUrl: '/uploads/sample-bill-7.pdf',
        fileKey: 'bills/sample-bill-7.pdf',
        remarks: 'Wall Vitrified Tiles',
        createdAt: new Date('2026-09-26T16:00:00Z'),
        updatedAt: new Date('2026-09-26T16:00:00Z'),
      },
    ];

    sampleBillsAmit.forEach(b => this.bills.set(b.id, b));

    // Ledger Transactions for Raj
    const rajTx: WalletTransactionRecord = {
      id: 'tx-raj-1',
      walletId: rajWallet.id,
      userId: rajId,
      amount: 250.0,
      type: 'REWARD_CREDIT',
      balanceAfter: 1600.0,
      referenceType: 'BILL',
      referenceId: 'bill-1024',
      description: 'Reward credited for Approved Bill INV-2026-1024',
      createdAt: new Date('2026-10-02T14:30:00Z'),
    };
    this.walletTransactions.set(rajTx.id, rajTx);

    // Ledger Transactions for Amit
    const amitTx: WalletTransactionRecord = {
      id: 'tx-amit-1',
      walletId: amitWallet.id,
      userId: amitId,
      amount: 300.0,
      type: 'REWARD_CREDIT',
      balanceAfter: 2170.0,
      referenceType: 'BILL',
      referenceId: 'bill-2031',
      description: 'Reward credited for Approved Bill INV-2026-2031',
      createdAt: new Date('2026-10-02T15:30:00Z'),
    };
    this.walletTransactions.set(amitTx.id, amitTx);
  }
}

export const dbStore = new MemoryDatabase();
