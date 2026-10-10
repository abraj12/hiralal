import { AuthService } from '../services/auth.service';
import { PayoutService } from '../services/payout.service';
import { RewardService } from '../services/reward.service';
import { PaymentService } from '../services/payment.service';
import { KycService } from '../services/kyc.service';
import { prisma } from '../db';
import { sha256Hash, hmacHashOtp } from '../utils/crypto.utils';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

describe('Admin Roles, Prefix Authentication, Single Session & Service Coverage', () => {
  const billAdminMobile = '9876000001';
  const opsAdminMobile = '9876000002';
  const regularUserMobile = '9876000003';
  const suspendedAdminMobile = '9876000004';
  const testPassword = 'SecureAdmin@2026';

  let billAdminId: string;
  let opsAdminId: string;
  let regularUserId: string;
  let suspendedAdminId: string;
  let regularWalletId: string;
  let paymentAccountId: string;

  beforeAll(async () => {
    // 1. Clean up test numbers
    const testMobiles = [billAdminMobile, opsAdminMobile, regularUserMobile, suspendedAdminMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: testMobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });

    const passwordHash = await bcrypt.hash(testPassword, 10);

    // 2. Create Bill Admin
    const billAdmin = await prisma.user.create({
      data: {
        mobile: billAdminMobile,
        fullName: 'Bill Verification Admin',
        passwordHash,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    billAdminId = billAdmin.id;

    // 3. Create Operations Admin
    const opsAdmin = await prisma.user.create({
      data: {
        mobile: opsAdminMobile,
        fullName: 'Operations Manager Admin',
        passwordHash,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    opsAdminId = opsAdmin.id;

    // 4. Create Suspended Admin
    const suspAdmin = await prisma.user.create({
      data: {
        mobile: suspendedAdminMobile,
        fullName: 'Suspended Admin',
        passwordHash,
        role: 'BILL_ADMIN',
        status: 'SUSPENDED',
        isVerified: true,
      },
    });
    suspendedAdminId = suspAdmin.id;

    // 5. Create Regular User with Wallet
    const user = await prisma.user.create({
      data: {
        mobile: regularUserMobile,
        fullName: 'Ramesh Craftsman',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 5000.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });
    regularUserId = user.id;
    regularWalletId = user.wallet!.id;

    // 6. Create Payment Account
    const pa = await PaymentService.addUpiAccount(user.id, 'ramesh@upi');
    paymentAccountId = pa.id;
  });

  afterAll(async () => {
    const testMobiles = [billAdminMobile, opsAdminMobile, regularUserMobile, suspendedAdminMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: testMobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.$disconnect();
  });

  describe('1. AuthService - resolveAdminIdentifier', () => {
    test('resolves BILL_ADMIN identifier with XYZ prefix', () => {
      const res = AuthService.resolveAdminIdentifier(`XYZ${billAdminMobile}`);
      expect(res.role).toBe('BILL_ADMIN');
      expect(res.mobile).toBe(billAdminMobile);
    });

    test('resolves OPERATIONS_ADMIN identifier with ABC prefix', () => {
      const res = AuthService.resolveAdminIdentifier(`ABC${opsAdminMobile}`);
      expect(res.role).toBe('OPERATIONS_ADMIN');
      expect(res.mobile).toBe(opsAdminMobile);
    });

    test('handles whitespace and lowercase prefixes gracefully', () => {
      const res = AuthService.resolveAdminIdentifier(`  xyz${billAdminMobile}  `);
      expect(res.role).toBe('BILL_ADMIN');
      expect(res.mobile).toBe(billAdminMobile);
    });

    test('throws error for missing or empty identifier', () => {
      expect(() => AuthService.resolveAdminIdentifier('')).toThrow(/Invalid login credentials/i);
      expect(() => AuthService.resolveAdminIdentifier(null as any)).toThrow(/Invalid login credentials/i);
    });

    test('throws error for invalid prefix', () => {
      expect(() => AuthService.resolveAdminIdentifier(`INVALID${billAdminMobile}`)).toThrow(/Invalid login credentials/i);
    });

    test('throws error for malformed mobile number in identifier', () => {
      expect(() => AuthService.resolveAdminIdentifier('XYZ12345')).toThrow(/Invalid Bill Admin identifier format/i);
      expect(() => AuthService.resolveAdminIdentifier('ABC12345')).toThrow(/Invalid Operations Admin identifier format/i);
    });
  });

  describe('2. AuthService - requestAdminOtp & requestOtp branches', () => {
    test('throws error if admin account does not exist', async () => {
      await expect(
        AuthService.requestAdminOtp({ identifier: 'XYZ9999900000', password: testPassword })
      ).rejects.toThrow(/Invalid login credentials/i);
    });

    test('throws error if admin account is suspended', async () => {
      await expect(
        AuthService.requestAdminOtp({ identifier: `XYZ${suspendedAdminMobile}`, password: testPassword })
      ).rejects.toThrow(/Invalid login credentials/i);
    });

    test('throws error if admin password is invalid', async () => {
      await expect(
        AuthService.requestAdminOtp({ identifier: `XYZ${billAdminMobile}`, password: 'WrongPassword@999' })
      ).rejects.toThrow(/Invalid login credentials/i);
    });

    test('successfully generates admin OTP record with role and TTL <= 300s', async () => {
      const res = await AuthService.requestAdminOtp({ identifier: `XYZ${billAdminMobile}`, password: testPassword });
      expect(res.role).toBe('BILL_ADMIN');
      expect(res.cooldownSeconds).toBe(60);
      expect(res.expiresAt).toBeDefined();

      const otp = await prisma.otpRequest.findFirst({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN', isUsed: false },
      });
      expect(otp).not.toBeNull();
      expect(otp?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('enforces 60-second cooldown on consecutive requests', async () => {
      await expect(
        AuthService.requestAdminOtp({ identifier: `XYZ${billAdminMobile}`, password: testPassword })
      ).rejects.toThrow(/Please wait \d+ seconds before requesting/i);
    });

    test('enforces max 5 requests per 10 minutes rate limit', async () => {
      await prisma.otpRequest.updateMany({
        where: { mobile: billAdminMobile },
        data: { cooldownUntil: new Date(Date.now() - 1000) },
      });

      for (let i = 0; i < 4; i++) {
        await prisma.otpRequest.create({
          data: {
            mobile: billAdminMobile,
            otpHash: 'dummyhash',
            purpose: 'ADMIN_LOGIN',
            expiresAt: new Date(Date.now() + 60000),
            createdAt: new Date(),
          },
        });
      }

      await expect(
        AuthService.requestAdminOtp({ identifier: `XYZ${billAdminMobile}`, password: testPassword })
      ).rejects.toThrow(/Too many verification requests/i);
    });

    test('requestOtp validates length, duplicate registration, and forgot password privacy', async () => {
      await expect(
        AuthService.requestOtp({ mobile: '123', purpose: 'REGISTRATION' })
      ).rejects.toThrow(/Please enter a valid 10-digit Indian mobile number/i);

      await expect(
        AuthService.requestOtp({ mobile: regularUserMobile, purpose: 'REGISTRATION' })
      ).rejects.toThrow(/already registered/i);

      const privacyRes = await AuthService.requestOtp({
        mobile: '9111199999',
        purpose: 'FORGOT_PASSWORD',
      });
      expect(privacyRes.message).toMatch(/If an account is associated with this mobile/i);
    });
  });

  describe('3. AuthService - verifyAdminOtp & verifyOtp branches', () => {
    const testOtpCode = '654321';

    let testChallengeToken: string;

    beforeEach(async () => {
      await prisma.otpRequest.deleteMany({ where: { mobile: opsAdminMobile } });
      await prisma.verificationToken.deleteMany({ where: { mobile: opsAdminMobile } });
      testChallengeToken = 'valid_test_challenge_token_123';
      await prisma.verificationToken.create({
        data: {
          mobile: opsAdminMobile,
          tokenHash: sha256Hash(testChallengeToken),
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    });

    test('rejects non-6-digit OTP codes', async () => {
      await expect(
        AuthService.verifyAdminOtp({ identifier: `ABC${opsAdminMobile}`, otpCode: '123', challengeToken: testChallengeToken })
      ).rejects.toThrow(/Please enter a valid 6-digit/i);

      await expect(
        AuthService.verifyOtp({ mobile: opsAdminMobile, otpCode: '123', purpose: 'REGISTRATION' })
      ).rejects.toThrow(/Please enter a valid 6-digit/i);
    });

    test('rejects expired or non-existent OTP codes', async () => {
      await expect(
        AuthService.verifyAdminOtp({ identifier: `ABC${opsAdminMobile}`, otpCode: '999999', challengeToken: testChallengeToken })
      ).rejects.toThrow(/Admin verification code has expired or is invalid/i);

      await expect(
        AuthService.verifyOtp({ mobile: opsAdminMobile, otpCode: '999999', purpose: 'REGISTRATION' })
      ).rejects.toThrow(/Verification code has expired or is invalid/i);
    });

    test('increments attemptsCount on incorrect OTP code', async () => {
      await prisma.otpRequest.create({
        data: {
          mobile: opsAdminMobile,
          otpHash: hmacHashOtp(testOtpCode),
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 180000),
          attemptsCount: 0,
        },
      });

      await expect(
        AuthService.verifyAdminOtp({ identifier: `ABC${opsAdminMobile}`, otpCode: '000000', challengeToken: testChallengeToken })
      ).rejects.toThrow(/Invalid verification code/i);

      const record = await prisma.otpRequest.findFirst({
        where: { mobile: opsAdminMobile, purpose: 'ADMIN_LOGIN' },
      });
      expect(record?.attemptsCount).toBe(1);
    });

    test('locks and rejects when maximum attempts exceeded', async () => {
      await prisma.otpRequest.create({
        data: {
          mobile: opsAdminMobile,
          otpHash: hmacHashOtp(testOtpCode),
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 180000),
          attemptsCount: 4,
        },
      });

      await expect(
        AuthService.verifyAdminOtp({ identifier: `ABC${opsAdminMobile}`, otpCode: '000000', challengeToken: testChallengeToken })
      ).rejects.toThrow(/Maximum verification attempts exceeded/i);

      const record = await prisma.otpRequest.findFirst({
        where: { mobile: opsAdminMobile, purpose: 'ADMIN_LOGIN' },
      });
      expect(record?.isUsed).toBe(true);
    });

    test('successfully validates OTP and issues single active administrator session', async () => {
      await prisma.otpRequest.create({
        data: {
          mobile: opsAdminMobile,
          otpHash: hmacHashOtp(testOtpCode),
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 180000),
        },
      });

      const res = await AuthService.verifyAdminOtp({
        identifier: `ABC${opsAdminMobile}`,
        otpCode: testOtpCode,
        challengeToken: testChallengeToken,
      });

      expect(res.user.role).toBe('OPERATIONS_ADMIN');
      expect(res.token).toBeDefined();

      const tokenRecord = await prisma.verificationToken.findFirst({
        where: { mobile: opsAdminMobile, purpose: 'ADMIN_LOGIN' },
      });
      expect(tokenRecord).not.toBeNull();
      expect(tokenRecord?.isUsed).toBe(true);
    });

    test('rejects missing or invalid challengeToken', async () => {
      await expect(
        AuthService.verifyAdminOtp({ identifier: `ABC${opsAdminMobile}`, otpCode: '123456', challengeToken: '' })
      ).rejects.toThrow(/Invalid or expired login challenge/i);
    });
  });

  describe('4. AuthService - loginAdmin, login & Single Active Session', () => {
    let validToken: string;

    beforeEach(async () => {
      validToken = crypto.randomBytes(32).toString('hex');
      await prisma.verificationToken.deleteMany({ where: { mobile: billAdminMobile } });
      await prisma.verificationToken.create({
        data: {
          mobile: billAdminMobile,
          tokenHash: sha256Hash(validToken),
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
    });

    test('validates required fields', async () => {
      await expect(
        AuthService.loginAdmin({ identifier: `XYZ${billAdminMobile}`, password: '', verificationToken: validToken })
      ).rejects.toThrow(/Admin password is required/i);

      await expect(
        AuthService.loginAdmin({ identifier: `XYZ${billAdminMobile}`, password: testPassword, verificationToken: '' })
      ).rejects.toThrow(/Admin verification challenge token is required/i);
    });

    test('rejects invalid or already-consumed challenge token', async () => {
      await expect(
        AuthService.loginAdmin({
          identifier: `XYZ${billAdminMobile}`,
          password: testPassword,
          verificationToken: 'bad_token',
        })
      ).rejects.toThrow(/Invalid or expired admin verification challenge token/i);
    });

    test('rejects incorrect password and leaves challenge consumed', async () => {
      await expect(
        AuthService.loginAdmin({
          identifier: `XYZ${billAdminMobile}`,
          password: 'WrongPassword@123',
          verificationToken: validToken,
        })
      ).rejects.toThrow(/Invalid admin credentials/i);
    });

    test('successfully authenticates admin, issues single active session, and logs audit record', async () => {
      const login1 = await AuthService.loginAdmin({
        identifier: `XYZ${billAdminMobile}`,
        password: testPassword,
        verificationToken: validToken,
        userAgent: 'Jest/AdminDevice1',
        ipAddress: '127.0.0.1',
      });

      expect(login1.accessToken).toBeDefined();
      expect(login1.user.role).toBe('BILL_ADMIN');
      expect(login1.sessionId).toBeDefined();

      const userAfterLogin1 = await prisma.user.findUnique({ where: { id: billAdminId } });
      expect(userAfterLogin1?.activeSessionId).toBe(login1.sessionId);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { adminId: billAdminId, action: 'ADMIN_LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.newValue).toContain('BILL_ADMIN');

      // Now simulate Login 2 from another device: creates fresh challenge token
      const token2 = crypto.randomBytes(32).toString('hex');
      await prisma.verificationToken.create({
        data: {
          mobile: billAdminMobile,
          tokenHash: sha256Hash(token2),
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: new Date(Date.now() + 600000),
        },
      });

      const login2 = await AuthService.loginAdmin({
        identifier: `XYZ${billAdminMobile}`,
        password: testPassword,
        verificationToken: token2,
        userAgent: 'Jest/AdminDevice2',
        ipAddress: '127.0.0.2',
      });

      expect(login2.sessionId).not.toBe(login1.sessionId);

      const userAfterLogin2 = await prisma.user.findUnique({ where: { id: billAdminId } });
      expect(userAfterLogin2?.activeSessionId).toBe(login2.sessionId);

      const oldSession = await prisma.authSession.findFirst({
        where: { userId: billAdminId, sessionId: login1.sessionId },
      });
      expect(oldSession?.revokedAt).not.toBeNull();
    });

    test('regular login handles non-existent user, suspended user, bad password, and successful login', async () => {
      await expect(
        AuthService.login('9999911111', 'AnyPassword@123')
      ).rejects.toThrow(/Invalid mobile number or password/i);

      // Contract A: Admin cannot authenticate through regular user login
      await expect(
        AuthService.login(billAdminMobile, testPassword)
      ).rejects.toThrow(/Invalid mobile number or password/i);

      // Suspended regular user rejection
      await prisma.user.update({
        where: { id: regularUserId },
        data: { status: 'SUSPENDED' },
      });
      await expect(
        AuthService.login(regularUserMobile, testPassword)
      ).rejects.toThrow(/account has been suspended/i);
      await prisma.user.update({
        where: { id: regularUserId },
        data: { status: 'ACTIVE' },
      });

      const regularLogin = await AuthService.login(regularUserMobile, testPassword);
      expect(regularLogin.accessToken).toBeDefined();
      expect(regularLogin.sessionId).toBeDefined();

      const user = await prisma.user.findUnique({ where: { id: regularUserId } });
      expect(user?.activeSessionId).toBe(regularLogin.sessionId);
    });
  });

  describe('5. AuthService - refreshToken, logout & name updates', () => {
    test('refreshToken enforces single active session and error conditions', async () => {
      await expect(AuthService.refreshToken('')).rejects.toThrow(/Refresh token is required/i);
      await expect(AuthService.refreshToken('non_existent')).rejects.toThrow(/Invalid refresh token/i);

      const expiredToken = crypto.randomBytes(40).toString('hex');
      await prisma.authSession.create({
        data: {
          userId: regularUserId,
          sessionId: 'old-session',
          tokenHash: sha256Hash(expiredToken),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      await expect(AuthService.refreshToken(expiredToken)).rejects.toThrow(/Refresh token has expired/i);
    });

    test('logout by refreshToken and userId clears activeSessionId', async () => {
      const liveToken = crypto.randomBytes(40).toString('hex');
      const liveSessionId = crypto.randomUUID();

      await prisma.user.update({
        where: { id: regularUserId },
        data: { activeSessionId: liveSessionId },
      });

      await prisma.authSession.create({
        data: {
          userId: regularUserId,
          sessionId: liveSessionId,
          tokenHash: sha256Hash(liveToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await AuthService.logout(liveToken);

      const userAfter = await prisma.user.findUnique({ where: { id: regularUserId } });
      expect(userAfter?.activeSessionId).toBeNull();

      await prisma.user.update({
        where: { id: regularUserId },
        data: { activeSessionId: crypto.randomUUID() },
      });
      await AuthService.logout(undefined, regularUserId);
      const userAfter2 = await prisma.user.findUnique({ where: { id: regularUserId } });
      expect(userAfter2?.activeSessionId).toBeNull();
    });

    test('updateUserName handles validation and locked name checks', async () => {
      await expect(
        AuthService.updateUserName('non-existent-id', { fullName: 'Test' })
      ).rejects.toThrow(/User not found/i);

      await expect(
        AuthService.updateUserName(regularUserId, { firstName: '' })
      ).rejects.toThrow();

      const updated = await AuthService.updateUserName(regularUserId, {
        firstName: 'Vikram',
        lastName: 'Sharma',
      });
      expect(updated.fullName).toBe('Vikram Sharma');

      await prisma.user.update({
        where: { id: regularUserId },
        data: { isNameLocked: true },
      });

      await expect(
        AuthService.updateUserName(regularUserId, { firstName: 'NewName' })
      ).rejects.toThrow(/Your name is locked/i);

      await prisma.user.update({
        where: { id: regularUserId },
        data: { isNameLocked: false },
      });
    });

    test('adminUpdateUserName requires reason and resets KYC match status', async () => {
      await expect(
        AuthService.adminUpdateUserName({
          userId: regularUserId,
          adminId: opsAdminId,
          firstName: 'New',
          reason: '',
        })
      ).rejects.toThrow(/A specific justification reason is mandatory/i);

      await expect(
        AuthService.adminUpdateUserName({
          userId: 'non-existent-user',
          adminId: opsAdminId,
          firstName: 'New',
          reason: 'Valid correction reason',
        })
      ).rejects.toThrow(/User not found/i);

      await prisma.kycRecord.create({
        data: {
          userId: regularUserId,
          panName: 'Old Name',
          maskedPan: 'ABCDE****F',
          panStatus: 'VERIFIED',
          nameMatched: true,
        },
      });

      const res = await AuthService.adminUpdateUserName({
        userId: regularUserId,
        adminId: opsAdminId,
        firstName: 'Anil',
        lastName: 'Kumar',
        reason: 'Typo in name at registration',
      });

      expect(res.fullName).toBe('Anil Kumar');
      expect(res.isNameLocked).toBe(false);

      const kyc = await prisma.kycRecord.findFirst({ where: { userId: regularUserId } });
      expect(kyc?.nameMatched).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: { adminId: opsAdminId, action: 'ADMIN_NAME_CORRECTION' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.newValue).toContain('Typo in name at registration');
    });
  });

  describe('6. RewardService - Pool Analytics & Headroom Checks', () => {
    test('getPoolAnalytics returns analytics for single profession and both professions', async () => {
      const plumberAnalytics = await RewardService.getPoolAnalytics('PLUMBER');
      expect(plumberAnalytics.profession).toBe('PLUMBER');
      expect(plumberAnalytics.totalPoolCap).toBeGreaterThan(0);
      expect(plumberAnalytics.percentageUsed).toBeDefined();

      const tileAnalytics = await RewardService.getPoolAnalytics('TILE_INSTALLER');
      expect(tileAnalytics.profession).toBe('TILE_INSTALLER');
      expect(tileAnalytics.totalPoolCap).toBeGreaterThan(0);

      const bothAnalytics = await RewardService.getPoolAnalytics();
      expect(bothAnalytics.plumber).toBeDefined();
      expect(bothAnalytics.tileInstaller).toBeDefined();
      expect(bothAnalytics.totalPoolCap).toBe(plumberAnalytics.totalPoolCap + tileAnalytics.totalPoolCap);
    });

    test('checkPoolAvailability handles number argument and profession argument', async () => {
      const resNum = await RewardService.checkPoolAvailability(100);
      expect(resNum.available).toBe(true);

      const resProf = await RewardService.checkPoolAvailability('TILE_INSTALLER', 200);
      expect(resProf.available).toBe(true);
    });

    test('updateRewardRules creates new rule version', async () => {
      const newRule = await RewardService.updateRewardRules(opsAdminId, {
        profession: 'TILE_INSTALLER',
        percentage: 0.65,
        monthlyPoolLimit: 75000,
      });

      expect(newRule.profession).toBe('TILE_INSTALLER');
      expect(Number(newRule.rewardPercentage)).toBe(0.65);
      expect(Number(newRule.monthlyPoolLimit)).toBe(75000);
    });
  });

  describe('7. PayoutService - Eligibility, Rejection, Reversals, Finalization & Dispatch', () => {
    let testPayoutId: string;

    beforeEach(async () => {
      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: {
          isEnabled: true,
          minimumAmount: 500.0,
          maximumAmount: 10000.0,
          startAt: null,
          endAt: null,
          message: 'Rewards redemption window is now open.',
        },
        create: {
          id: 'default',
          isEnabled: true,
          minimumAmount: 500.0,
          maximumAmount: 10000.0,
          startAt: null,
          endAt: null,
          message: 'Rewards redemption window is now open.',
        },
      });

      await prisma.wallet.update({
        where: { id: regularWalletId },
        data: { availableBalance: 4000.0, processingAmount: 1000.0, totalRedeemed: 0.0 },
      });

      const payout = await prisma.payout.create({
        data: {
          userId: regularUserId,
          walletId: regularWalletId,
          amount: 1000.0,
          status: 'PENDING',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `jest_payout_${Date.now()}_${Math.random()}`,
        },
      });
      testPayoutId = payout.id;
    });

    test('enforces fail-closed behavior when redemption window is closed by administration', async () => {
      // Clear in-flight test payout first
      await prisma.payout.deleteMany({ where: { userId: regularUserId } });

      await prisma.redemptionSettings.update({
        where: { id: 'default' },
        data: { isEnabled: false, message: 'Rewards redemption is currently unavailable.' },
      });

      const check = await PayoutService.checkUserEligibility(regularUserId);
      expect(check.canRedeem).toBe(false);
      expect(check.reason).toContain('Rewards redemption is currently unavailable.');

      await expect(
        PayoutService.requestRedemption(regularUserId, 'key-closed-window')
      ).rejects.toThrow(/Rewards redemption is currently unavailable./i);

      // Restore to open for subsequent tests
      await prisma.redemptionSettings.update({
        where: { id: 'default' },
        data: { isEnabled: true, message: 'Rewards redemption window is now open.' },
      });
    });

    test('checkUserEligibility checks all gating rules', async () => {
      // 1. When active payout is in progress
      const checkPending = await PayoutService.checkUserEligibility(regularUserId);
      expect(checkPending.canRedeem).toBe(false);
      expect(checkPending.reason).toContain('redemption request currently in progress');

      // Clear pending payout
      await prisma.payout.deleteMany({ where: { userId: regularUserId } });

      // 2. When KYC is not verified
      await prisma.kycRecord.deleteMany({ where: { userId: regularUserId } });
      const checkNoKyc = await PayoutService.checkUserEligibility(regularUserId);
      expect(checkNoKyc.canRedeem).toBe(false);
      expect(checkNoKyc.reason).toContain('verify your PAN card details');

      // 3. When KYC name not matched
      await prisma.kycRecord.create({
        data: {
          userId: regularUserId,
          panName: 'Different Name',
          maskedPan: 'ABCDE****G',
          panStatus: 'VERIFIED',
          nameMatched: false,
        },
      });
      const checkNameMismatch = await PayoutService.checkUserEligibility(regularUserId);
      expect(checkNameMismatch.canRedeem).toBe(false);
      expect(checkNameMismatch.reason).toContain('does not match your registered account name');

      // Set nameMatched = true
      await prisma.kycRecord.updateMany({
        where: { userId: regularUserId },
        data: { nameMatched: true },
      });

      // 4. When balance is below minimum
      await prisma.wallet.update({
        where: { id: regularWalletId },
        data: { availableBalance: 100.0 },
      });
      const checkLowBalance = await PayoutService.checkUserEligibility(regularUserId);
      expect(checkLowBalance.canRedeem).toBe(false);
      expect(checkLowBalance.reason).toContain('Minimum redemption amount');

      // Restore balance
      await prisma.wallet.update({
        where: { id: regularWalletId },
        data: { availableBalance: 5000.0 },
      });
    });

    test('requestRedemption enforces minimum bounds and 100% balance', async () => {
      await prisma.payout.deleteMany({ where: { userId: regularUserId } });
      await prisma.kycRecord.updateMany({
        where: { userId: regularUserId },
        data: { nameMatched: true, panStatus: 'VERIFIED' },
      });

      // Wallet available balance below minimum
      await prisma.wallet.update({
        where: { id: regularWalletId },
        data: { availableBalance: 100.0 },
      });

      await expect(
        PayoutService.requestRedemption(regularUserId, 'key-min')
      ).rejects.toThrow(/Minimum redemption amount/i);

      // Wallet available balance valid -> 100% full balance redeemed
      await prisma.wallet.update({
        where: { id: regularWalletId },
        data: { availableBalance: 3000.0 },
      });

      const res = await PayoutService.requestRedemption(regularUserId, 'key-full');
      expect(res.amountDebited).toBe(3000.0);
      expect(res.payout.status).toBe('PENDING');
    });

    test('approveRedemption transitions PENDING payout to APPROVED', async () => {
      const approved = await PayoutService.approveRedemption(testPayoutId, opsAdminId);
      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedByAdminId).toBe(opsAdminId);

      const outbox = await prisma.outboxEvent.findFirst({
        where: { eventType: 'PAYOUT_DISPATCH' },
        orderBy: { createdAt: 'desc' },
      });
      expect(outbox).not.toBeNull();
    });

    test('rejectRedemption validates inputs and restores wallet funds', async () => {
      await expect(
        PayoutService.rejectRedemption(testPayoutId, opsAdminId, '')
      ).rejects.toThrow(/Rejection reason is required/i);

      await expect(
        PayoutService.rejectRedemption('non-existent-payout', opsAdminId, 'Invalid')
      ).rejects.toThrow(/not found/i);

      const rejected = await PayoutService.rejectRedemption(testPayoutId, opsAdminId, 'Invalid UPI details');
      expect(rejected.status).toBe('FAILED');
      expect(rejected.failureReason).toBe('Invalid UPI details');

      const wallet = await prisma.wallet.findUnique({ where: { id: regularWalletId } });
      expect(Number(wallet?.availableBalance)).toBe(5000.0);
      expect(Number(wallet?.processingAmount)).toBe(0.0);

      // Contract C: Cannot manually reject non-PENDING payout
      await expect(
        PayoutService.rejectRedemption(testPayoutId, opsAdminId, 'Invalid UPI details')
      ).rejects.toThrow(/Cannot manually reject payout in FAILED state/i);
    });

    test('reversePayout refunds processing funds and records PAYOUT_REVERSAL', async () => {
      const reversed = await PayoutService.reversePayout(testPayoutId, 'Bank network timeout');
      expect(reversed.status).toBe('FAILED');

      const wallet = await prisma.wallet.findUnique({ where: { id: regularWalletId } });
      expect(Number(wallet?.availableBalance)).toBe(5000.0);
      expect(Number(wallet?.processingAmount)).toBe(0.0);

      const txn = await prisma.walletTransaction.findFirst({
        where: { referenceId: testPayoutId, type: 'PAYOUT_REVERSAL' },
      });
      expect(txn).not.toBeNull();
      expect(Number(txn?.amount)).toBe(1000.0);
    });

    test('finalizeSuccess transitions payout to SUCCESS and increments totalRedeemed', async () => {
      const finalized = await PayoutService.finalizeSuccess(testPayoutId, 'rzp_pout_success_123');
      expect(finalized.status).toBe('SUCCESS');
      expect(finalized.razorpayPayoutId).toBe('rzp_pout_success_123');

      const wallet = await prisma.wallet.findUnique({ where: { id: regularWalletId } });
      expect(Number(wallet?.processingAmount)).toBe(0.0);
      expect(Number(wallet?.totalRedeemed)).toBe(1000.0);

      await expect(
        PayoutService.rejectRedemption(testPayoutId, opsAdminId, 'Too late')
      ).rejects.toThrow(/already successfully completed/i);

      await expect(
        PayoutService.reversePayout(testPayoutId, 'Too late')
      ).rejects.toThrow(/already successfully completed/i);

      const compensated = await PayoutService.handleReversedPayout(testPayoutId, 'Gateway post-settlement chargeback');
      expect(compensated.status).toBe('REVERSED');

      const walletComp = await prisma.wallet.findUnique({ where: { id: regularWalletId } });
      expect(Number(walletComp?.totalRedeemed)).toBe(0.0);
      expect(Number(walletComp?.availableBalance)).toBe(5000.0);

      const compAgain = await PayoutService.handleReversedPayout(testPayoutId, 'Duplicate webhook');
      expect(compAgain.status).toBe('REVERSED');
    });

    test('finalizeSuccess rejects already FAILED payout', async () => {
      await prisma.payout.update({
        where: { id: testPayoutId },
        data: { status: 'FAILED' },
      });

      await expect(
        PayoutService.finalizeSuccess(testPayoutId)
      ).rejects.toThrow(/already in terminal state FAILED/i);
    });
  });
});
