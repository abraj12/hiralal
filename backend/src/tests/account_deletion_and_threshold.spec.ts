import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { AccountDeletionService } from '../services/account-deletion.service';
import { AuthService } from '../services/auth.service';
import { PayoutService } from '../services/payout.service';
import { prisma } from '../db';
import { hmacHashOtp } from '../utils/crypto.utils';

describe('Account Deletion Lifecycle & Minimum Redemption Threshold Tests', () => {
  const testMobile = '9800000099';
  const testPassword = 'Password@123';
  const testOtp = '123456';
  const testOtpHmac = hmacHashOtp(testOtp); // F-03: uses dedicated OTP_HMAC_SECRET via config
  const testOtpSha = hmacHashOtp(testOtp); // F-03: was SHA-256, now HMAC (same as testOtpHmac)

  let userId: string;
  let walletId: string;

  beforeAll(async () => {
    // Clean up any existing records for test mobile
    const existingUsers = await prisma.user.findMany({
      where: { mobile: testMobile },
      select: { id: true },
    });
    const existingIds = existingUsers.map((u) => u.id);

    if (existingIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'User', entityId: { in: existingIds } },
      });
      await prisma.walletTransaction.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.payout.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.kycRecord.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.paymentAccount.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.authSession.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.pushDeviceToken.deleteMany({
        where: { userId: { in: existingIds } },
      });
      await prisma.wallet.deleteMany({
        where: { userId: { in: existingIds } },
      });
    }

    await prisma.verificationToken.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.user.deleteMany({
      where: { mobile: testMobile },
    });

    // Create fresh test user
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        fullName: 'Test Plumber User',
        firstName: 'Test',
        lastName: 'User',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    userId = user.id;
    walletId = user.wallet!.id;
  });

  afterAll(async () => {
    // Final cleanup
    await prisma.walletTransaction.deleteMany({
      where: { userId },
    });
    await prisma.payout.deleteMany({
      where: { userId },
    });
    await prisma.wallet.deleteMany({
      where: { userId },
    });
    await prisma.kycRecord.deleteMany({
      where: { userId },
    });
    await prisma.paymentAccount.deleteMany({
      where: { userId },
    });
    await prisma.authSession.deleteMany({
      where: { userId },
    });
    await prisma.pushDeviceToken.deleteMany({
      where: { userId },
    });
    await prisma.verificationToken.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
  });

  describe('1. Account Deletion Request & Password Verification', () => {
    test('rejects account deletion request if password is empty or invalid', async () => {
      await expect(AccountDeletionService.requestDeletion(userId, '')).rejects.toThrow(
        'Current password is required to request account deletion.'
      );

      await expect(AccountDeletionService.requestDeletion(userId, 'WrongPass123')).rejects.toThrow(
        'Incorrect password'
      );
    });

    test('FINDING-01: rejects account deletion request if user has positive rewards balance', async () => {
      await prisma.wallet.update({
        where: { id: walletId },
        data: { availableBalance: 500.0 },
      });

      await expect(AccountDeletionService.requestDeletion(userId, testPassword)).rejects.toThrow(
        'Account deletion cannot be requested while you have an active rewards balance. Please redeem your rewards first.'
      );

      await prisma.wallet.update({
        where: { id: walletId },
        data: { availableBalance: 0.0 },
      });
    });

    test('FINDING-01: rejects account deletion request if user has outstanding deficit liability', async () => {
      await prisma.wallet.update({
        where: { id: walletId },
        data: { deficitLiability: 200.0 },
      });

      await expect(AccountDeletionService.requestDeletion(userId, testPassword)).rejects.toThrow(
        'Account deletion cannot be requested due to an outstanding deficit liability. Please contact support.'
      );

      await prisma.wallet.update({
        where: { id: walletId },
        data: { deficitLiability: 0.0 },
      });
    });

    test('successfully initiates account deletion request and dispatches OTP with purpose ACCOUNT_DELETION', async () => {
      const result = await AccountDeletionService.requestDeletion(userId, testPassword);
      expect(result.success).toBe(true);
      expect(result.gracePeriodDays).toBe(7);
      expect(result.mobile).toMatch(/98\*{6}99/);

      // Verify OTP token was generated in database with purpose ACCOUNT_DELETION
      const otpRecord = await prisma.otpRequest.findFirst({
        where: { mobile: testMobile, purpose: 'ACCOUNT_DELETION' },
        orderBy: { createdAt: 'desc' },
      });
      expect(otpRecord).toBeDefined();
      expect(otpRecord?.isUsed).toBe(false);
    });
  });

  describe('2. Account Deletion Confirmation & Grace Period Scheduling', () => {
    test('rejects confirmation with invalid OTP code', async () => {
      await expect(AccountDeletionService.confirmDeletion(userId, '000000')).rejects.toThrow(
        'Invalid verification code'
      );
    });

    test('confirms deletion with valid OTP, sets 7-day grace period, and revokes sessions', async () => {
      // Create session first
      await prisma.authSession.create({
        data: {
          userId,
          sessionId: 'test-session-123',
          tokenHash: crypto.randomBytes(20).toString('hex'),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Find the latest OTP request and set its hash to testOtpSha for testing
      const latestOtp = await prisma.otpRequest.findFirst({
        where: { mobile: testMobile, purpose: 'ACCOUNT_DELETION', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(latestOtp).toBeTruthy();

      await prisma.otpRequest.update({
        where: { id: latestOtp!.id },
        data: { otpHash: testOtpSha },
      });

      const confirmResult = await AccountDeletionService.confirmDeletion(userId, testOtp);
      expect(confirmResult.success).toBe(true);
      expect(confirmResult.gracePeriodDays).toBe(7);

      // Check user record
      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
      expect(updatedUser?.deletionRequestedAt).toBeDefined();
      expect(updatedUser?.deletionScheduledAt).toBeDefined();
      expect(updatedUser?.lastDeletionRequestAt).toBeDefined();
      expect(updatedUser?.activeSessionId).toBeNull();

      // Check that session was revoked
      const sessions = await prisma.authSession.findMany({ where: { userId } });
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

      // Check audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: { entityType: 'User', entityId: userId, action: 'ACCOUNT_DELETION_SCHEDULED' },
      });
      expect(auditLog).toBeDefined();
    });

    test('getDeletionStatus reflects scheduled deletion and remaining grace period', async () => {
      const status = await AccountDeletionService.getDeletionStatus(userId);
      expect(status.isPendingDeletion).toBe(true);
      expect(status.deletionRequestedAt).toBeDefined();
      expect(status.deletionScheduledAt).toBeDefined();
      expect(status.canRequestDeletion).toBe(false);
      expect(status.gracePeriodDays).toBe(7);
    });
  });

  describe('3. 30-Day Cooldown Enforcement', () => {
    test('forbids requesting another deletion while cooldown is active', async () => {
      await expect(AccountDeletionService.requestDeletion(userId, testPassword)).rejects.toThrow(
        /Another deletion request cannot be submitted within 30 days/
      );
    });
  });

  describe('4. Automatic Cancellation of Deletion on Subsequent Login', () => {
    test('logging in during the 7-day grace period automatically cancels scheduled deletion', async () => {
      const loginResult = await AuthService.login(testMobile, testPassword);
      expect(loginResult).toBeDefined();
      expect(loginResult.token).toBeDefined();

      // Verify deletion lifecycle timestamps cleared
      const userAfterLogin = await prisma.user.findUnique({ where: { id: userId } });
      expect(userAfterLogin?.deletionRequestedAt).toBeNull();
      expect(userAfterLogin?.deletionScheduledAt).toBeNull();
      expect(userAfterLogin?.status).toBe('ACTIVE');

      // Check audit log for cancellation
      const cancelAuditLog = await prisma.auditLog.findFirst({
        where: { entityType: 'User', entityId: userId, action: 'ACCOUNT_DELETION_CANCELLED_BY_LOGIN' },
      });
      expect(cancelAuditLog).toBeDefined();
    });
  });

  describe('5. Safe Data Anonymization Worker (processScheduledDeletions)', () => {
    test('anonymizes user personal data, purges KYC & payment credentials, while retaining financial ledger', async () => {
      // Setup KYC record and payment account
      await prisma.kycRecord.create({
        data: {
          userId,
          panNumber: 'ABCDE1234F',
          panBlindIndex: 'someblindindex',
          panName: 'Test Plumber User',
          maskedPan: 'XXXXX1234F',
          panStatus: 'VERIFIED',
          nameMatched: true,
        },
      });

      await prisma.paymentAccount.create({
        data: {
          userId,
          accountType: 'UPI',
          upiId: 'test@upi',
          accountHolderName: 'Test Plumber User',
          maskedInfo: 'test@upi',
          isVerified: true,
          isDefault: true,
        },
      });

      // Add a financial ledger transaction to the wallet
      await prisma.walletTransaction.create({
        data: {
          walletId,
          userId,
          type: 'REWARD_CREDIT',
          amount: 250.0,
          balanceAfter: 250.0,
          referenceType: 'BILL',
          referenceId: 'dummy-bill-id-1',
          description: 'Reward credited for invoice #HIR-001',
        },
      });

      // Simulate grace period expiry (scheduled in the past)
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago
      await prisma.user.update({
        where: { id: userId },
        data: {
          deletionRequestedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8),
          deletionScheduledAt: pastDate,
        },
      });

      // Seed a lingering verification token and OTP request for the mobile
      await prisma.verificationToken.create({
        data: {
          mobile: testMobile,
          tokenHash: 'sample-lingering-token-hash',
          purpose: 'REGISTRATION',
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await prisma.otpRequest.create({
        data: {
          mobile: testMobile,
          otpHash: testOtpHmac,
          purpose: 'REGISTRATION',
          expiresAt: new Date(Date.now() + 60000),
        },
      });

      // Run anonymization worker
      const workerResult = await AccountDeletionService.processScheduledDeletions(prisma);
      expect(workerResult.processedCount).toBeGreaterThanOrEqual(1);

      // Verify VerificationToken and OtpRequest purged
      const lingeringTokens = await prisma.verificationToken.findMany({ where: { mobile: testMobile } });
      expect(lingeringTokens.length).toBe(0);
      const lingeringOtps = await prisma.otpRequest.findMany({ where: { mobile: testMobile } });
      expect(lingeringOtps.length).toBe(0);

      // Verify anonymized User state
      const anonymizedUser = await prisma.user.findUnique({ where: { id: userId } });
      expect(anonymizedUser).toBeDefined();
      expect(anonymizedUser?.fullName).toBe('Deleted User');
      expect(anonymizedUser?.mobile).toMatch(/^DEL_/);
      expect(anonymizedUser?.status).toBe('SUSPENDED');
      expect(anonymizedUser?.deletionScheduledAt).toBeNull();

      // Verify KYC purged
      const anonymizedKyc = await prisma.kycRecord.findFirst({ where: { userId } });
      expect(anonymizedKyc?.panNumber).toBeNull();
      expect(anonymizedKyc?.panBlindIndex).toBeNull();
      expect(anonymizedKyc?.panName).toBe('ANONYMIZED');

      // Verify Payment Account purged
      const anonymizedPayment = await prisma.paymentAccount.findFirst({ where: { userId } });
      expect(anonymizedPayment?.upiId).toBeNull();
      expect(anonymizedPayment?.accountHolderName).toBe('ANONYMIZED');

      // Verify Financial Ledger RETAINED (availableBalance 0 after full redemption)
      const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      expect(wallet).toBeDefined();
      expect(Number(wallet?.availableBalance)).toBe(0.0);

      const transactions = await prisma.walletTransaction.findMany({ where: { walletId } });
      expect(transactions.length).toBe(1);
      expect(Number(transactions[0].amount)).toBe(250.0);

      // Verify idempotent execution on second run
      const secondRun = await AccountDeletionService.processScheduledDeletions(prisma);
      expect(secondRun.errors.length).toBe(0);
    });
  });

  describe('6. Minimum Redemption Threshold Gating in PayoutService', () => {
    let thresholdUserId: string;
    let thresholdWalletId: string;

    beforeAll(async () => {
      // Clean up previous user if any
      await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: '9800000098' } } } });
      await prisma.wallet.deleteMany({ where: { user: { mobile: '9800000098' } } });
      await prisma.user.deleteMany({ where: { mobile: '9800000098' } });

      // Create user for threshold test
      const user = await prisma.user.create({
        data: {
          mobile: '9800000098',
          fullName: 'Threshold Test User',
          passwordHash: 'hash',
          role: 'USER',
          status: 'ACTIVE',
          profession: 'PLUMBER',
          isVerified: true,
          wallet: {
            create: {
              availableBalance: 150.0,
              totalRedeemed: 0.0,
            },
          },
        },
        include: { wallet: true },
      });
      thresholdUserId = user.id;
      thresholdWalletId = user.wallet!.id;

      // Configure redemption settings with 500 minimum threshold and open window
      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: {
          isEnabled: true,
          minimumRedemptionAmount: 500.0,
          startAt: new Date(Date.now() - 3600 * 1000),
          endAt: new Date(Date.now() + 86400 * 1000),
        },
        create: {
          id: 'default',
          isEnabled: true,
          minimumRedemptionAmount: 500.0,
          startAt: new Date(Date.now() - 3600 * 1000),
          endAt: new Date(Date.now() + 86400 * 1000),
          message: 'Redemption window is open',
        },
      });
    });

    afterAll(async () => {
      await prisma.wallet.deleteMany({ where: { userId: thresholdUserId } });
      await prisma.user.deleteMany({ where: { id: thresholdUserId } });
      // Reset settings back to standard 100.0
      await prisma.redemptionSettings.update({
        where: { id: 'default' },
        data: { minimumRedemptionAmount: 100.0 },
      });
    });

    test('marks user ineligible when availableBalance is below minimumRedemptionAmount', async () => {
      const eligibility = await PayoutService.checkUserEligibility(thresholdUserId);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.canRedeem).toBe(false);
      expect(eligibility.isThresholdConfigured).toBe(true);
      expect(eligibility.isThresholdMet).toBe(false);
      expect(eligibility.reason).toContain('below the minimum redemption threshold of 500 Points');
    });

    test('requestRedemption fails closed when balance is below minimum threshold', async () => {
      await expect(
        PayoutService.requestRedemption(thresholdUserId, 'threshold-idem-key-1')
      ).rejects.toThrow(/below the minimum redemption threshold/);
    });

    test('marks user eligible once availableBalance meets or exceeds minimum threshold', async () => {
      await prisma.wallet.update({
        where: { id: thresholdWalletId },
        data: { availableBalance: 600.0 },
      });

      const eligibility = await PayoutService.checkUserEligibility(thresholdUserId);
      expect(eligibility.isThresholdMet).toBe(true);
      expect(eligibility.isEligible).toBe(true);
    });
  });
});
