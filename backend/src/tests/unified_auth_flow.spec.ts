import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { sha256Hash } from '../utils/crypto.utils';
import { closeRedis, checkRedisConnection } from '../redis';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

describe('Unified User/Admin Authentication, Role Detection & Dashboard Gating', () => {
  const craftsmanMobile = '9876511111';
  const craftsmanPassword = 'CraftsmanPass@2026';

  const billAdminMobile = '9876522222';
  const opsAdminMobile = '9876533333';
  const adminPassword = 'AdminSecret@2026';

  let billAdminId: string;
  let opsAdminId: string;
  let craftsmanId: string;

  beforeAll(async () => {
    await checkRedisConnection();
    const testMobiles = [craftsmanMobile, billAdminMobile, opsAdminMobile];

    // Clean up prior test data
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: testMobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });

    const passwordHash = await bcrypt.hash(craftsmanPassword, 10);
    const adminHash = await bcrypt.hash(adminPassword, 10);

    // 1. Create Craftsman User
    const user = await prisma.user.create({
      data: {
        mobile: craftsmanMobile,
        fullName: 'Mahesh Plumber',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 2000.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
    });
    craftsmanId = user.id;

    // 2. Create Bill Admin
    const billAdmin = await prisma.user.create({
      data: {
        mobile: billAdminMobile,
        fullName: 'Bill Audit Officer',
        passwordHash: adminHash,
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
        fullName: 'Operations Manager',
        passwordHash: adminHash,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    opsAdminId = opsAdmin.id;
  });

  afterAll(async () => {
    const testMobiles = [craftsmanMobile, billAdminMobile, opsAdminMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: testMobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.$disconnect();
    await closeRedis();
  });

  // ========================================================
  // 1. Mobile Screen Code & Invariant Checks
  // ========================================================
  describe('1. Mobile Welcome & Login Screen Invariant Verification', () => {
    test('WelcomeScreen preserves all branding, cards, and Login navigation intact', () => {
      const welcomePath = path.resolve(__dirname, '../../../mobile/src/screens/WelcomeScreen.tsx');
      expect(fs.existsSync(welcomePath)).toBe(true);
      const code = fs.readFileSync(welcomePath, 'utf8');

      // Verify branding & headings
      expect(code).toContain('HIRALAL AND SONS');
      expect(code).toContain('REWARDS PROGRAM');
      expect(code).toContain('Your Work');
      expect(code).toContain('More Rewards');

      // Verify value proposition cards
      expect(code).toContain('Upload Bills');
      expect(code).toContain('Earn Rewards');
      expect(code).toContain('Safe & Verified');

      // Verify buttons & navigation
      expect(code).toContain("setCurrentScreen('LOGIN')");
      expect(code).toContain("setCurrentScreen('REGISTER')");
      expect(code).toContain('Login');
      expect(code).toContain('Create New Account');
    });

    test('LoginScreen removes separate tabs and implements unified identifier field', () => {
      const loginPath = path.resolve(__dirname, '../../../mobile/src/screens/LoginScreen.tsx');
      expect(fs.existsSync(loginPath)).toBe(true);
      const code = fs.readFileSync(loginPath, 'utf8');

      // Tabs must be completely removed
      expect(code).not.toContain('modeTabs');
      expect(code).not.toContain('Craftsman Login');
      expect(code).not.toContain('Admin Access');

      // Unified header and fields
      expect(code).toContain('Welcome Back!');
      expect(code).toContain('Mobile Number or Admin ID');
      expect(code).toContain('Password');
      expect(code).toContain('Forgot Password?');
      expect(code).toContain('Sign In');

      // Automatic detection and password-first admin sequence
      expect(code).toContain('isAdminIdentifier');
      expect(code).toContain('requestAdminOtp');
      expect(code).toContain('verifyAdminOtp');
      expect(code).toContain('showOtpModal');
    });
  });

  // ========================================================
  // 2. Craftsman Authentication Flow (POST /api/auth/login)
  // ========================================================
  describe('2. Craftsman User Authentication Flow', () => {
    test('Normal 10-digit mobile + valid password logs in user and returns USER role', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ mobile: craftsmanMobile, password: craftsmanPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('USER');
      expect(res.body.user.mobile).toBe(craftsmanMobile);
      expect(res.body.token).toBeDefined();
    });

    test('Incorrect password returns 401 invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ mobile: craftsmanMobile, password: 'WrongPassword@123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid mobile number or password/i);
    });

    test('Contract A: Administrator cannot authenticate via /api/auth/login', async () => {
      const billRes = await request(app)
        .post('/api/auth/login')
        .send({ mobile: billAdminMobile, password: adminPassword });

      expect(billRes.status).toBe(401);
      expect(billRes.body.success).toBe(false);

      const opsRes = await request(app)
        .post('/api/auth/login')
        .send({ mobile: opsAdminMobile, password: adminPassword });

      expect(opsRes.status).toBe(401);
      expect(opsRes.body.success).toBe(false);
    });
  });

  // ========================================================
  // 3. Administrator Password-First, OTP-Challenge Flow
  // ========================================================
  describe('3. Administrator Password-First & OTP-Challenge Sequence', () => {
    test('Invalid prefix is rejected with 401', async () => {
      const res = await request(app)
        .post('/api/auth/admin/otp/request')
        .send({ identifier: `INVALID${billAdminMobile}`, password: adminPassword });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Invalid admin/i);
    });

    test('Non-existent admin identifier returns generic error (no account enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/admin/otp/request')
        .send({ identifier: 'XYZ1111100000', password: adminPassword });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Invalid admin credentials/i);
    });

    test('Invalid password does NOT create OTP challenge or authenticated session', async () => {
      const beforeCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });

      const res = await request(app)
        .post('/api/auth/admin/otp/request')
        .send({ identifier: `XYZ${billAdminMobile}`, password: 'WrongAdminPassword@999' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Invalid admin credentials/i);
      expect(res.body.token).toBeUndefined();
      expect(res.body.challengeToken).toBeUndefined();

      const afterCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });
      expect(afterCount).toBe(beforeCount); // No OTP created on bad password
    });

    test('Valid admin identifier + password generates OTP challenge token WITHOUT issuing full session', async () => {
      const res = await request(app)
        .post('/api/auth/admin/otp/request')
        .send({ identifier: `XYZ${billAdminMobile}`, password: adminPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.requireOtp).toBe(true);
      expect(res.body.challengeToken).toBeDefined();
      expect(res.body.cooldownSeconds).toBe(60);

      // Password verification alone MUST NOT grant access token
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user).toBeUndefined();
    });

    test('Incorrect OTP is rejected and does not issue session', async () => {
      // Create known challenge token and OTP
      const challengeToken = 'dummy_challenge_token_1234567890abcdef';
      const tokenHash = sha256Hash(challengeToken);
      await prisma.verificationToken.create({
        data: {
          mobile: opsAdminMobile,
          tokenHash,
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const correctOtp = '888999';
      await prisma.otpRequest.create({
        data: {
          mobile: opsAdminMobile,
          otpHash: sha256Hash(correctOtp),
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      // Submit incorrect OTP
      const verifyRes = await request(app)
        .post('/api/auth/admin/otp/verify')
        .send({
          identifier: `ABC${opsAdminMobile}`,
          otpCode: '000000',
          challengeToken,
        });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.token).toBeUndefined();
    });

    test('Valid OTP + challengeToken completes login, establishes single session & issues JWT', async () => {
      const challengeToken = 'real_challenge_token_for_success_test';
      const tokenHash = sha256Hash(challengeToken);
      await prisma.verificationToken.create({
        data: {
          mobile: billAdminMobile,
          tokenHash,
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const validOtp = '777888';
      await prisma.otpRequest.create({
        data: {
          mobile: billAdminMobile,
          otpHash: sha256Hash(validOtp),
          purpose: 'ADMIN_LOGIN',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      const verifyRes = await request(app)
        .post('/api/auth/admin/otp/verify')
        .send({
          identifier: `XYZ${billAdminMobile}`,
          otpCode: validOtp,
          challengeToken,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.token).toBeDefined();
      expect(verifyRes.body.user.role).toBe('BILL_ADMIN');
      expect(verifyRes.body.user.mobile).toBe(billAdminMobile);

      // Verify challengeToken is consumed (single-use)
      const tokenInDb = await prisma.verificationToken.findFirst({
        where: { tokenHash },
      });
      expect(tokenInDb?.isUsed).toBe(true);

      // Verify single active session exists
      const adminInDb = await prisma.user.findUnique({
        where: { id: billAdminId },
      });
      expect(adminInDb?.activeSessionId).toBe(verifyRes.body.sessionId);
    });

    test('Reusing already-consumed challenge token is rejected', async () => {
      const challengeToken = 'real_challenge_token_for_success_test'; // already used
      const res = await request(app)
        .post('/api/auth/admin/otp/verify')
        .send({
          identifier: `XYZ${billAdminMobile}`,
          otpCode: '777888',
          challengeToken,
        });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================
  // 4. Role-Specific Dashboard Route Permissions
  // ========================================================
  describe('4. Role-Specific Dashboard Access Controls', () => {
    let billAdminToken: string;
    let opsAdminToken: string;
    let craftsmanToken: string;

    beforeAll(async () => {
      // Issue session for Bill Admin
      const c1 = 'token_bill_admin_gate';
      await prisma.verificationToken.create({
        data: { mobile: billAdminMobile, tokenHash: sha256Hash(c1), purpose: 'ADMIN_LOGIN', expiresAt: new Date(Date.now() + 600000) },
      });
      await prisma.otpRequest.create({
        data: { mobile: billAdminMobile, otpHash: sha256Hash('112233'), purpose: 'ADMIN_LOGIN', expiresAt: new Date(Date.now() + 600000) },
      });
      const billAuth = await AuthService.verifyAdminOtp({
        identifier: `XYZ${billAdminMobile}`,
        otpCode: '112233',
        challengeToken: c1,
      });
      billAdminToken = billAuth.token!;

      // Issue session for Ops Admin
      const c2 = 'token_ops_admin_gate';
      await prisma.verificationToken.create({
        data: { mobile: opsAdminMobile, tokenHash: sha256Hash(c2), purpose: 'ADMIN_LOGIN', expiresAt: new Date(Date.now() + 600000) },
      });
      await prisma.otpRequest.create({
        data: { mobile: opsAdminMobile, otpHash: sha256Hash('223344'), purpose: 'ADMIN_LOGIN', expiresAt: new Date(Date.now() + 600000) },
      });
      const opsAuth = await AuthService.verifyAdminOtp({
        identifier: `ABC${opsAdminMobile}`,
        otpCode: '223344',
        challengeToken: c2,
      });
      opsAdminToken = opsAuth.token!;

      // Craftsman Token
      const craftAuth = await request(app)
        .post('/api/auth/login')
        .send({ mobile: craftsmanMobile, password: craftsmanPassword });
      craftsmanToken = craftAuth.body.token;
    });

    test('BILL_ADMIN can access bill verification endpoints', async () => {
      const res = await request(app)
        .post('/api/admin/bills/any-bill/verify')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ action: 'APPROVE' });

      // Returns 404 (bill not found), NOT 403 Forbidden!
      expect(res.status).not.toBe(403);
    });

    test('BILL_ADMIN is forbidden from redemption settings (403)', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ isEnabled: true });

      expect(res.status).toBe(403);
    });

    test('OPERATIONS_ADMIN can access redemption settings', async () => {
      const res = await request(app)
        .get('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(res.status).toBe(200);
    });

    test('OPERATIONS_ADMIN is forbidden from bill verification (403)', async () => {
      const res = await request(app)
        .post('/api/admin/bills/any-bill/verify')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ action: 'APPROVE' });

      expect(res.status).toBe(403);
    });

    test('Ordinary Craftsman is forbidden from all admin routes (403)', async () => {
      const res1 = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${craftsmanToken}`);
      expect(res1.status).toBe(403);

      const res2 = await request(app)
        .get('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${craftsmanToken}`);
      expect(res2.status).toBe(403);
    });
  });
});
