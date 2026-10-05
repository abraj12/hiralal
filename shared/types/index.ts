export enum Profession {
  PLUMBER = 'PLUMBER',
  TILE_INSTALLER = 'TILE_INSTALLER'
}

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED'
}

export enum BillStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  DUPLICATE = 'DUPLICATE'
}

export enum TransactionType {
  REWARD_CREDIT = 'REWARD_CREDIT',
  PAYOUT_DEBIT = 'PAYOUT_DEBIT',
  PAYOUT_REVERSAL = 'PAYOUT_REVERSAL',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT'
}

export enum KycStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED'
}

export enum PaymentType {
  UPI = 'UPI',
  BANK_ACCOUNT = 'BANK_ACCOUNT'
}

export enum PayoutStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PAYOUT_INITIATED = 'PAYOUT_INITIATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED'
}

export enum OtpPurpose {
  REGISTRATION = 'REGISTRATION',
  FORGOT_PASSWORD = 'FORGOT_PASSWORD',
  LOGIN = 'LOGIN'
}

export interface UserDto {
  id: string;
  mobile: string;
  fullName: string;
  profession: Profession;
  role: UserRole;
  status: UserStatus;
  isVerified: boolean;
  createdAt: string;
}

export interface WalletDto {
  id: string;
  userId: string;
  availableBalance: number;
  processingAmount: number;
  totalRedeemed: number;
  updatedAt: string;
}

export interface BillDto {
  id: string;
  userId: string;
  userFullName?: string;
  userMobile?: string;
  userProfession?: Profession;
  invoiceNumber: string;
  invoiceDate: string;
  billAmount: number;
  calculatedReward: number;
  rewardPercentage: number;
  status: BillStatus;
  fileUrl: string;
  rejectionReason?: string | null;
  verifiedByAdminId?: string | null;
  remarks?: string | null;
  createdAt: string;
}

export interface RewardSummaryDto {
  totalRewards: number;
  processingAmount: number;
  availableBalance: number;
  totalRedeemed: number;
  billsApprovedCount: number;
  billsPendingCount: number;
  totalBillsCount: number;
}

export interface RewardPoolDto {
  year: number;
  month: number;
  totalPoolCap: number;
  usedAmount: number;
  remainingAmount: number;
  percentageUsed: number;
  isCapped: boolean;
}

export interface PaymentAccountDto {
  id: string;
  accountType: PaymentType;
  upiId?: string;
  bankName?: string;
  accountHolderName?: string;
  maskedInfo: string;
  isVerified: boolean;
  isDefault: boolean;
}

export interface KycRecordDto {
  id: string;
  panNumber: string;
  panName: string;
  panStatus: KycStatus;
  maskedPan: string;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
}

export interface PayoutDto {
  id: string;
  userId: string;
  userName?: string;
  userMobile?: string;
  profession?: Profession;
  amount: number;
  paymentType: PaymentType;
  maskedAccount: string;
  status: PayoutStatus;
  idempotencyKey: string;
  razorpayPayoutId?: string | null;
  failureReason?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface ProfessionThemeConfig {
  profession: Profession;
  name: string;
  tagline: string;
  primaryColor: string;
  primaryDark: string;
  primaryLight: string;
  accentBg: string;
  surfaceBg: string;
  heroBadgeText: string;
  rewardsTitle: string;
  uploadBillTitle: string;
  myRewardsTitle: string;
  redeemTitle: string;
  categoriesSubtitle: string;
  heroIllustration: string;
  heroWorkerIllustration: string;
}
