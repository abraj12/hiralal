import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { sha256Hash } from '../utils/crypto.utils';
import { closeRedis, checkRedisConnection } from '../redis';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

describe('Unified User/Admin Authentication, Silent Role Detection & Production Verification', () => {
  const craftsmanMobile = '9876511111';
  const craftsmanPassword = 'CraftsmanPass@2026';

  const billAdminMobile = '9876522222';
  const opsAdminMobile = '9876533333';
  const adminPassword = 'AdminSecret@2026';

  const regMobile = '9876544444';
  const resetMobile = '9876555555';

  let billAdminId: string;
  let opsAdminId: string;
  let craftsmanId: string;

  beforeAll(async () => {
    await checkRedisConnection();
    const testMobiles = [craftsmanMobile, billAdminMobile, opsAdminMobile, regMobile, resetMobile];

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

    // 4. Create User for Password Reset Testing
    await prisma.user.create({
      data: {
        mobile: resetMobile,
        fullName: 'Suresh Reset User',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 500.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
    });
  });

  afterAll(async () => {
    const testMobiles = [craftsmanMobile, billAdminMobile, opsAdminMobile, regMobile, resetMobile];
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
  describe('1. Mobile Screen Design & Invariant Verification', () => {
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

    test('LoginScreen contains NO visible administrator references, badges, tabs, or admin helper text', () => {
      const loginPath = path.resolve(__dirname, '../../../mobile/src/screens/LoginScreen.tsx');
      expect(fs.existsSync(loginPath)).toBe(true);
      const code = fs.readFileSync(loginPath, 'utf8');

      // Tabs and mode selection must be absent
      expect(code).not.toContain('modeTabs');
      expect(code).not.toContain('Craftsman Login');
      expect(code).not.toContain('Admin Access');

      // Administrator references in visible UI must be absent
      expect(code).not.toContain('Admin ID');
      expect(code).not.toContain('administrator ID');
      expect(code).not.toContain('Admin ID Detected');
      expect(code).not.toContain('adminBadge');
      expect(code).not.toContain('Administrators enter your role prefix');
      expect(code).not.toContain('Prefix + 10-digit mobile');

      // Standard single form fields
      expect(code).toContain('Welcome Back!');
      expect(code).toContain('Mobile Number');
      expect(code).toContain('Enter your mobile number');
      expect(code).toContain('Password');
      expect(code).toContain('Forgot Password?');
      expect(code).toContain('Sign In');
    });

    test('LoginScreen identifier field uses normal text-capable keyboard with default type', () => {
      const loginPath = path.resolve(__dirname, '../../../mobile/src/screens/LoginScreen.tsx');
      const code = fs.readFileSync(loginPath, 'utf8');

      // Keyboard must be text-capable
      expect(code).toContain('keyboardType="default"');
      expect(code).toContain('autoCapitalize="none"');
      expect(code).toContain('autoCorrect={false}');

      // Must preserve Indian +91 presentation
      expect(code).toContain('🇮🇳 +91');
    });
  });

  // ========================================================
  // 2. Craftsman Authentication Flow (POST /api/auth/login)
  // ========================================================
  describe('2. Craftsman User Authentication Flow', () => {
    test('A valid ordinary 10-digit mobile identifier follows craftsman login and opens craftsman dashboard', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: craftsmanMobile, password: craftsmanPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.type).toBe('USER_AUTHENTICATED');
      expect(res.body.user.role).toBe('USER');
      expect(res.body.user.mobile).toBe(craftsmanMobile);
      expect(res.body.token).toBeDefined();
      expect(res.body.requiresOtp).toBeUndefined();
    });

    test('Incorrect password returns generic 401 invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: craftsmanMobile, password: 'WrongPassword@123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid/i);
    });

    test('Ordinary user login cannot authenticate an administrator account (Contract A)', async () => {
      const billRes = await request(app)
        .post('/api/auth/login')
        .send({ mobile: billAdminMobile, password: adminPassword });

      expect(billRes.status).toBe(401);
      expect(billRes.body.success).toBe(false);
      expect(billRes.body.token).toBeUndefined();

      const opsRes = await request(app)
        .post('/api/auth/login')
        .send({ mobile: opsAdminMobile, password: adminPassword });

      expect(opsRes.status).toBe(401);
      expect(opsRes.body.success).toBe(false);
      expect(opsRes.body.token).toBeUndefined();
    });
  });

  // ========================================================
  // 3. Silent Backend Admin Detection & Password-First OTP Sequence
  // ========================================================
  describe('3. Silent Backend Admin Identification & Password-First Sequence', () => {
    test('Arbitrary words and invalid prefixes do NOT trigger administrator authentication', async () => {
      const arbitraryWords = ['admin', 'SUPERUSER', 'root', 'arbitraryWord', 'UNKNOWN9876522222'];

      for (const word of arbitraryWords) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ identifier: word, password: 'AnyPassword@123' });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe('Invalid login credentials. Please check your details and try again.');
        expect(res.body.token).toBeUndefined();
        expect(res.body.requiresOtp).toBeUndefined();
        expect(res.body.challengeToken).toBeUndefined();
      }
    });

    test('Invalid identifiers do NOT issue tokens, sessions, or OTP challenges', async () => {
      const beforeCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'XYZ9876599999', password: adminPassword });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid login credentials. Please check your details and try again.');
      expect(res.body.token).toBeUndefined();
      expect(res.body.challengeToken).toBeUndefined();

      const afterCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });
      expect(afterCount).toBe(beforeCount); // No OTP created on invalid identifier
    });

    test('Invalid administrator password does NOT issue OTP challenge or authenticated session', async () => {
      const beforeCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: `XYZ${billAdminMobile}`, password: 'WrongAdminPassword@999' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid login credentials. Please check your details and try again.');
      expect(res.body.token).toBeUndefined();
      expect(res.body.challengeToken).toBeUndefined();

      const afterCount = await prisma.otpRequest.count({ where: { mobile: billAdminMobile } });
      expect(afterCount).toBe(beforeCount); // Password validation failed before OTP generation
    });

    test('A valid configured administrator identifier follows password-first, OTP-second authentication via unified /login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: `XYZ${billAdminMobile}`, password: adminPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.type).toBe('ADMIN_OTP_REQUIRED');
      expect(res.body.requiresOtp).toBe(true);
      expect(res.body.challengeToken).toBeDefined();
      expect(res.body.challengeId).toBeDefined();
      expect(res.body.cooldownSeconds).toBe(60);

      // Password verification alone MUST NOT grant access token or create authenticated session
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user).toBeUndefined();
    });

    test('Incorrect OTP is rejected and does NOT issue administrator session', async () => {
      const challengeToken = 'dummy_challenge_token_fail_test';
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

      const verifyRes = await request(app)
        .post('/api/auth/admin/otp/verify')
        .send({
          identifier: `ABC${opsAdminMobile}`,
          otpCode: '000000',
          challengeToken,
        });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.token).toBeUndefined();
      expect(verifyRes.body.user).toBeUndefined();
    });

    test('Correct OTP verification is required before an administrator session is issued', async () => {
      const challengeToken = 'real_challenge_token_for_success_test_v2';
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

      // Verify single active session established
      const adminInDb = await prisma.user.findUnique({
        where: { id: billAdminId },
      });
      expect(adminInDb?.activeSessionId).toBe(verifyRes.body.sessionId);

      // Verify challenge token consumed (cannot be replayed)
      const tokenInDb = await prisma.verificationToken.findFirst({
        where: { tokenHash },
      });
      expect(tokenInDb?.isUsed).toBe(true);
    });

    test('Reusing already-consumed challenge token is rejected', async () => {
      const challengeToken = 'real_challenge_token_for_success_test_v2'; // already used
      const res = await request(app)
        .post('/api/auth/admin/otp/verify')
        .send({
          identifier: `XYZ${billAdminMobile}`,
          otpCode: '777888',
          challengeToken,
        });

      expect(res.status).toBe(400);
      expect(res.body.token).toBeUndefined();
    });
  });

  // ========================================================
  // 4. Role-Specific Dashboard Route Permissions
  // ========================================================
  describe('4. Role-Specific Dashboard Access Controls & Mobile Routing', () => {
    let billAdminToken: string;
    let opsAdminToken: string;
    let craftsmanToken: string;

    beforeAll(async () => {
      // Issue session for Bill Admin
      const c1 = 'token_bill_admin_gate_v2';
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
      const c2 = 'token_ops_admin_gate_v2';
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
        .send({ identifier: craftsmanMobile, password: craftsmanPassword });
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

    test('Mobile App.tsx navigates to correct role-specific dashboard based on user role', () => {
      const appPath = path.resolve(__dirname, '../../../mobile/App.tsx');
      expect(fs.existsSync(appPath)).toBe(true);
      const code = fs.readFileSync(appPath, 'utf8');

      // BILL_ADMIN routes to BillReviewScreen
      expect(code).toContain("user?.role === 'BILL_ADMIN'");
      expect(code).toContain('<BillReviewScreen />');

      // OPERATIONS_ADMIN routes to OperationsDashboardScreen
      expect(code).toContain("user?.role === 'OPERATIONS_ADMIN'");
      expect(code).toContain('<OperationsDashboardScreen />');

      // Ordinary Craftsman displays bottom tabs navigation
      expect(code).toContain('!isAdmin && <BottomNav />');
    });
  });

  // ========================================================
  // 5. Existing Registration, Password Reset, and Logout Functionality
  // ========================================================
  describe('5. Existing User Registration, Password Reset, and Logout Workflows', () => {
    test('Existing user registration sequence remains functional', async () => {
      // 1. Request Registration OTP
      const otpRes = await request(app)
        .post('/api/auth/otp/request')
        .send({ mobile: regMobile, purpose: 'REGISTRATION' });
      expect(otpRes.status).toBe(200);
      expect(otpRes.body.success).toBe(true);

      // Find OTP in test database
      const otpRecord = await prisma.otpRequest.findFirst({
        where: { mobile: regMobile, purpose: 'REGISTRATION', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(otpRecord).toBeDefined();

      // For test verification, generate known OTP hash and verify
      const testOtp = '123456';
      await prisma.otpRequest.update({
        where: { id: otpRecord!.id },
        data: { otpHash: sha256Hash(testOtp) },
      });

      // 2. Verify Registration OTP
      const verifyRes = await request(app)
        .post('/api/auth/otp/verify')
        .send({ mobile: regMobile, otpCode: testOtp, purpose: 'REGISTRATION' });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verificationToken).toBeDefined();

      // 3. Complete Registration
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          mobile: regMobile,
          firstName: 'Ramesh',
          lastName: 'Sharma',
          password: 'RegistrationPass@2026',
          profession: 'PLUMBER',
          verificationToken: verifyRes.body.verificationToken,
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.success).toBe(true);
      expect(regRes.body.user.role).toBe('USER');
      expect(regRes.body.wallet).toBeDefined();
    });

    test('Existing password reset 3-step sequence remains functional', async () => {
      // 1. Request Password Reset OTP
      const reqRes = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ mobile: resetMobile });
      expect(reqRes.status).toBe(200);

      const otpRecord = await prisma.otpRequest.findFirst({
        where: { mobile: resetMobile, purpose: 'FORGOT_PASSWORD', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(otpRecord).toBeDefined();

      const testOtp = '654321';
      await prisma.otpRequest.update({
        where: { id: otpRecord!.id },
        data: { otpHash: sha256Hash(testOtp) },
      });

      // 2. Verify Password Reset OTP
      const verifyRes = await request(app)
        .post('/api/auth/password-reset/verify')
        .send({ mobile: resetMobile, otpCode: testOtp });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verificationToken).toBeDefined();

      // 3. Complete Password Reset
      const newPassword = 'NewSecretPassword@2026';
      const completeRes = await request(app)
        .post('/api/auth/password-reset/complete')
        .send({
          mobile: resetMobile,
          verificationToken: verifyRes.body.verificationToken,
          newPassword,
        });
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.success).toBe(true);

      // Verify login with new password succeeds
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: resetMobile, password: newPassword });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
    });

    test('Existing session logout remains functional', async () => {
      // Login craftsman
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: craftsmanMobile, password: craftsmanPassword });
      const token = loginRes.body.token;
      const refreshToken = loginRes.body.refreshToken;

      // Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);
    });

    test('Administrator sessions cannot be refreshed via public user token refresh (Contract 4.4)', async () => {
      const opsUser = await prisma.user.findFirst({ where: { mobile: opsAdminMobile } });
      const testAdminSessionToken = 'test_admin_refresh_token_string_32_bytes_x';
      const tokenHash = sha256Hash(testAdminSessionToken);
      await prisma.authSession.create({
        data: {
          userId: opsUser!.id,
          sessionId: 'test_admin_session_for_refresh_check',
          tokenHash,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: testAdminSessionToken });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.message).toContain('Administrator sessions cannot be refreshed via public user token refresh');
    });
  });
});
