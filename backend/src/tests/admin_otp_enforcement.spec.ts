import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { AuthService } from '../services/auth.service';
import { sha256Hash, hmacHashOtp } from '../utils/crypto.utils';
import { resetAdmins } from './test_helpers';

describe('Admin OTP Enforcement & Security Closure Test Suite', () => {
  const billAdminMobile = '9876543201';
  const opsAdminMobile = '9876543202';
  const workerMobile = '9876543203';
  const testPassword = 'AdminPassword@123';
  const workerPassword = 'WorkerPassword@123';

  let billAdminId: string;
  let opsAdminId: string;
  let workerUserId: string;

  beforeAll(async () => {
    await resetAdmins(prisma);

    const testMobiles = [billAdminMobile, opsAdminMobile, workerMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });

    const adminHash = await bcrypt.hash(testPassword, 10);
    const workerHash = await bcrypt.hash(workerPassword, 10);

    const billAdmin = await prisma.user.create({
      data: {
        mobile: billAdminMobile,
        fullName: 'Bill Verification Lead',
        passwordHash: adminHash,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    billAdminId = billAdmin.id;

    const opsAdmin = await prisma.user.create({
      data: {
        mobile: opsAdminMobile,
        fullName: 'Operations Lead',
        passwordHash: adminHash,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    opsAdminId = opsAdmin.id;

    const worker = await prisma.user.create({
      data: {
        mobile: workerMobile,
        fullName: 'Craftsman Worker',
        passwordHash: workerHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });
    workerUserId = worker.id;
    await prisma.wallet.create({
      data: {
        userId: worker.id,
        availableBalance: 100,
        processingAmount: 0,
        totalRedeemed: 0,
      },
    });
  });

  afterAll(async () => {
    await resetAdmins(prisma);
    await prisma.user.deleteMany({ where: { mobile: workerMobile } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset verification tokens and sessions between tests for test isolation
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: [billAdminMobile, opsAdminMobile] } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: [billAdminMobile, opsAdminMobile] } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: [billAdminId, opsAdminId] } } });
    await prisma.user.updateMany({
      where: { id: { in: [billAdminId, opsAdminId, workerUserId] } },
      data: { failedPasswordAttempts: 0, lockedUntil: null, activeSessionId: null },
    });
  });

  describe('HIR-V4-01: Runtime Allowlist & Administrator OTP Bypass Closure', () => {
    // 1. Generic OTP request with purpose: ADMIN_LOGIN is rejected
    test('1. Generic OTP request with purpose: ADMIN_LOGIN is rejected', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid OTP purpose/i);

      // Verify service layer also rejects directly
      await expect(
        AuthService.requestOtp({ mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' as any })
      ).rejects.toThrow(/Invalid OTP purpose/i);
    });

    // 2. The rejection creates no administrator challenge and no unauthorized verification token or session
    test('2. Rejection creates no administrator challenge and no unauthorized verification token or session', async () => {
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' });

      const tokens = await prisma.verificationToken.findMany({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' },
      });
      expect(tokens).toHaveLength(0);

      const otpRequests = await prisma.otpRequest.findMany({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' },
      });
      expect(otpRequests).toHaveLength(0);

      const sessions = await prisma.authSession.findMany({
        where: { userId: billAdminId },
      });
      expect(sessions).toHaveLength(0);
    });

    // 3. Generic OTP verification with purpose: ADMIN_LOGIN is rejected
    test('3. Generic OTP verification with purpose: ADMIN_LOGIN is rejected', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ mobile: billAdminMobile, otpCode: '123456', purpose: 'ADMIN_LOGIN' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid OTP purpose/i);

      // Verify service layer also rejects directly
      await expect(
        AuthService.verifyOtp({ mobile: billAdminMobile, otpCode: '123456', purpose: 'ADMIN_LOGIN' as any })
      ).rejects.toThrow(/Invalid OTP purpose/i);

      const tokens = await prisma.verificationToken.findMany({
        where: { mobile: billAdminMobile },
      });
      expect(tokens).toHaveLength(0);
    });

    // 4. The same restrictions apply to /auth/send-otp and /auth/verify-otp compatibility aliases
    test('4. The same restrictions apply to /auth/send-otp and /auth/verify-otp aliases', async () => {
      const reqAlias = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' });
      expect(reqAlias.status).toBe(400);
      expect(reqAlias.body.success).toBe(false);
      expect(reqAlias.body.message).toMatch(/Invalid OTP purpose/i);

      const verifyAlias = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ mobile: billAdminMobile, otpCode: '123456', purpose: 'ADMIN_LOGIN' });
      expect(verifyAlias.status).toBe(400);
      expect(verifyAlias.body.success).toBe(false);
      expect(verifyAlias.body.message).toMatch(/Invalid OTP purpose/i);

      const tokens = await prisma.verificationToken.findMany({
        where: { mobile: billAdminMobile },
      });
      expect(tokens).toHaveLength(0);
    });

    // 5. Unknown and malformed purposes are rejected
    test('5. Unknown, missing, and malformed purposes are rejected', async () => {
      const invalidPurposes = ['SUPERADMIN_LOGIN', 'ROOT', '', null, 12345, 'FORGED'];
      for (const badPurpose of invalidPurposes) {
        const resReq = await request(app)
          .post('/api/v1/auth/otp/request')
          .send({ mobile: workerMobile, purpose: badPurpose });
        expect(resReq.status).toBe(400);
        expect(resReq.body.success).toBe(false);

        const resVerify = await request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ mobile: workerMobile, otpCode: '123456', purpose: badPurpose });
        expect(resVerify.status).toBe(400);
        expect(resVerify.body.success).toBe(false);
      }

      // Missing purpose completely
      const resMissing = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: workerMobile });
      expect(resMissing.status).toBe(400);
      expect(resMissing.body.success).toBe(false);
    });

    // 6. The disallowed paths do not set an authentication cookie or issue a usable session
    test('6. Disallowed paths do not set an authentication cookie or issue a usable session', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' });

      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.token).toBeUndefined();
      expect(res.body.sessionId).toBeUndefined();

      const sessions = await prisma.authSession.findMany({
        where: { userId: billAdminId },
      });
      expect(sessions).toHaveLength(0);
    });

    // 7. Dedicated administrator OTP issuance rejects a wrong password without issuing a usable administrator challenge or OTP
    test('7. Dedicated admin OTP issuance rejects a wrong password without issuing challenge or OTP', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/otp/request')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.challengeToken).toBeUndefined();

      const tokens = await prisma.verificationToken.findMany({
        where: { mobile: billAdminMobile },
      });
      expect(tokens).toHaveLength(0);

      const otpRequests = await prisma.otpRequest.findMany({
        where: { mobile: billAdminMobile },
      });
      expect(otpRequests).toHaveLength(0);
    });

    // 8. Correct password followed by the correct OTP succeeds through the intended dedicated path
    test('8. Correct password followed by correct OTP succeeds through intended dedicated path', async () => {
      // 1. Password check & challenge issuance
      const reqRes = await request(app)
        .post('/api/v1/auth/admin/otp/request')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          password: testPassword,
        });

      expect(reqRes.status).toBe(200);
      expect(reqRes.body.success).toBe(true);
      expect(reqRes.body.challengeToken).toBeDefined();
      const challengeToken = reqRes.body.challengeToken;

      // In test environment, set a known OTP code in database for verification
      const realOtp = '774411';
      const latestOtp = await prisma.otpRequest.findFirst({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(latestOtp).toBeDefined();
      await prisma.otpRequest.update({
        where: { id: latestOtp!.id },
        data: { otpHash: sha256Hash(realOtp) },
      });

      // 2. OTP & Challenge verification
      const verifyRes = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          otpCode: realOtp,
          challengeToken,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.accessToken).toBeDefined();
      expect(verifyRes.body.user.role).toBe('BILL_ADMIN');
      expect(verifyRes.headers['set-cookie']).toBeDefined();

      const session = await prisma.authSession.findFirst({
        where: { userId: billAdminId, revokedAt: null },
      });
      expect(session).toBeDefined();
    });

    // 9. Incorrect or expired OTPs do not create an administrator session
    test('9. Incorrect or expired OTPs do not create an administrator session', async () => {
      const otpReq = await AuthService.requestAdminOtp({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: testPassword,
      });

      // Incorrect OTP
      const resBad = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          otpCode: '000000',
          challengeToken: otpReq.challengeToken,
        });
      expect(resBad.body.success).toBe(false);
      expect(resBad.body.accessToken).toBeUndefined();

      // Expire OTP in DB
      await prisma.otpRequest.updateMany({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' },
        data: { expiresAt: new Date(Date.now() - 60000) },
      });

      const resExpired = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          otpCode: '123456',
          challengeToken: otpReq.challengeToken,
        });
      expect(resExpired.body.success).toBe(false);
      expect(resExpired.body.accessToken).toBeUndefined();

      const sessions = await prisma.authSession.findMany({
        where: { userId: billAdminId, revokedAt: null },
      });
      expect(sessions).toHaveLength(0);
    });

    // 10. An already-used challenge/OTP cannot be replayed
    test('10. An already-used challenge/OTP cannot be replayed', async () => {
      const otpReq = await AuthService.requestAdminOtp({
        identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
        password: testPassword,
      });
      const realOtp = '882299';
      const latestOtp = await prisma.otpRequest.findFirst({
        where: { mobile: opsAdminMobile, purpose: 'ADMIN_LOGIN', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpRequest.update({
        where: { id: latestOtp!.id },
        data: { otpHash: sha256Hash(realOtp) },
      });

      // First verification succeeds
      const res1 = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
          otpCode: realOtp,
          challengeToken: otpReq.challengeToken,
        });
      expect(res1.status).toBe(200);

      // Replay attempt must fail
      const resReplay = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
          otpCode: realOtp,
          challengeToken: otpReq.challengeToken,
        });
      expect(resReplay.body.success).toBe(false);
      expect(resReplay.body.accessToken).toBeUndefined();

      const sessions = await prisma.authSession.findMany({
        where: { userId: opsAdminId, revokedAt: null },
      });
      expect(sessions).toHaveLength(1);
    });

    // 11. A worker OTP cannot be substituted for an administrator challenge
    test('11. A worker OTP cannot be substituted for an administrator challenge', async () => {
      // Worker legitimately requests and verifies OTP
      const testWorkerMobile = '9876543299';
      await prisma.user.upsert({
        where: { mobile: testWorkerMobile },
        update: {},
        create: {
          mobile: testWorkerMobile,
          fullName: 'Sub Worker',
          passwordHash: 'dummy',
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      const workerReq = await AuthService.requestOtp({
        mobile: testWorkerMobile,
        purpose: 'LOGIN',
      });
      expect(workerReq).toBeDefined();

      const workerOtp = '334455';
      const wOtpRow = await prisma.otpRequest.findFirst({
        where: { mobile: testWorkerMobile, purpose: 'LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpRequest.update({
        where: { id: wOtpRow!.id },
        data: { otpHash: sha256Hash(workerOtp) },
      });

      const workerVerify = await AuthService.verifyOtp({
        mobile: testWorkerMobile,
        otpCode: workerOtp,
        purpose: 'LOGIN',
      });
      expect(workerVerify.verificationToken).toBeDefined();

      // Attacker attempts to pass worker's verificationToken to admin verification
      const resAttack = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          otpCode: workerOtp,
          challengeToken: workerVerify.verificationToken,
        });

      expect(resAttack.status).toBe(400);
      expect(resAttack.body.success).toBe(false);
      expect(resAttack.body.accessToken).toBeUndefined();

      const sessions = await prisma.authSession.findMany({
        where: { userId: billAdminId, revokedAt: null },
      });
      expect(sessions).toHaveLength(0);
    });

    // 12. Valid generic worker OTP use cases still work
    test('12. Valid generic worker OTP use cases still work', async () => {
      const freshWorkerMobile = '9876543288';
      await prisma.user.deleteMany({ where: { mobile: freshWorkerMobile } });
      await prisma.otpRequest.deleteMany({ where: { mobile: freshWorkerMobile } });
      await prisma.verificationToken.deleteMany({ where: { mobile: freshWorkerMobile } });

      // Request REGISTRATION OTP
      const regReq = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: freshWorkerMobile, purpose: 'REGISTRATION' });
      expect(regReq.status).toBe(200);
      expect(regReq.body.success).toBe(true);

      const knownOtp = '654321';
      const otpRow = await prisma.otpRequest.findFirst({
        where: { mobile: freshWorkerMobile, purpose: 'REGISTRATION' },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpRequest.update({
        where: { id: otpRow!.id },
        data: { otpHash: sha256Hash(knownOtp) },
      });

      // Verify REGISTRATION OTP
      const regVerify = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ mobile: freshWorkerMobile, otpCode: knownOtp, purpose: 'REGISTRATION' });
      expect(regVerify.status).toBe(200);
      expect(regVerify.body.success).toBe(true);
      expect(regVerify.body.verificationToken).toBeDefined();

      // Request FORGOT_PASSWORD OTP for existing worker
      const resetReq = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ mobile: workerMobile, purpose: 'FORGOT_PASSWORD' });
      expect(resetReq.status).toBe(200);
      expect(resetReq.body.success).toBe(true);
    });

    // 13. Both administrative roles remain correctly scoped after successful login
    test('13. Both administrative roles remain correctly scoped after successful login', async () => {
      // 1. Bill Admin login
      const billReq = await AuthService.requestAdminOtp({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: testPassword,
      });
      const billOtp = '121212';
      const billOtpRow = await prisma.otpRequest.findFirst({
        where: { mobile: billAdminMobile, purpose: 'ADMIN_LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpRequest.update({
        where: { id: billOtpRow!.id },
        data: { otpHash: sha256Hash(billOtp) },
      });

      const billVerify = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          otpCode: billOtp,
          challengeToken: billReq.challengeToken,
        });
      expect(billVerify.status).toBe(200);
      expect(billVerify.body.user.role).toBe('BILL_ADMIN');
      expect(billVerify.body.role).toBe('BILL_ADMIN');

      // 2. Operations Admin login
      const opsReq = await AuthService.requestAdminOtp({
        identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
        password: testPassword,
      });
      const opsOtp = '343434';
      const opsOtpRow = await prisma.otpRequest.findFirst({
        where: { mobile: opsAdminMobile, purpose: 'ADMIN_LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.otpRequest.update({
        where: { id: opsOtpRow!.id },
        data: { otpHash: sha256Hash(opsOtp) },
      });

      const opsVerify = await request(app)
        .post('/api/v1/auth/admin/otp/verify')
        .send({
          identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
          otpCode: opsOtp,
          challengeToken: opsReq.challengeToken,
        });
      expect(opsVerify.status).toBe(200);
      expect(opsVerify.body.user.role).toBe('OPERATIONS_ADMIN');
      expect(opsVerify.body.role).toBe('OPERATIONS_ADMIN');
    });
  });

  // 1. Correct administrator password produces an OTP challenge but no authenticated session
  test('1. Correct administrator password produces an OTP challenge but no authenticated session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.type).toBe('ADMIN_OTP_REQUIRED');
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.challengeToken).toBeDefined();
    expect(res.body.role).toBe('BILL_ADMIN');

    // Security invariant: NO access token, NO session token, NO session in database
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    expect(res.body.sessionId).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const sessions = await prisma.authSession.findMany({ where: { userId: billAdminId } });
    expect(sessions).toHaveLength(0);
  });

  // 2. Calling /admin/login with the valid pre-OTP challenge returns 410 and creates no session
  test('2. Calling /admin/login with valid pre-OTP challenge returns 410 and creates no session', async () => {
    const otpReq = await AuthService.requestAdminOtp({
      identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
      password: testPassword,
    });
    expect(otpReq.challengeToken).toBeDefined();

    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: testPassword,
        verificationToken: otpReq.challengeToken,
      });

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('LEGACY_ADMIN_LOGIN_DISABLED');
    expect(res.body.message).toContain('disabled');

    // Assert no session was issued
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    const sessions = await prisma.authSession.findMany({ where: { userId: billAdminId } });
    expect(sessions).toHaveLength(0);
  });

  // 3. Calling /admin-login with the valid pre-OTP challenge returns 410 and creates no session
  test('3. Calling /admin-login with valid pre-OTP challenge returns 410 and creates no session', async () => {
    const otpReq = await AuthService.requestAdminOtp({
      identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
      password: testPassword,
    });

    const res = await request(app)
      .post('/api/v1/auth/admin-login')
      .send({
        username: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
        password: testPassword,
        verificationToken: otpReq.challengeToken,
      });

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('LEGACY_ADMIN_LOGIN_DISABLED');

    // Assert no session was issued
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    const sessions = await prisma.authSession.findMany({ where: { userId: opsAdminId } });
    expect(sessions).toHaveLength(0);
  });

  // 4. A malformed or expired challenge cannot establish a session
  test('4. A malformed or expired challenge cannot establish a session', async () => {
    const testOtp = '123456';
    const expiredToken = crypto.randomBytes(32).toString('hex');

    // Insert an expired verification token
    await prisma.verificationToken.create({
      data: {
        mobile: billAdminMobile,
        tokenHash: sha256Hash(expiredToken),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() - 10000), // Expired 10 seconds ago
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: billAdminMobile,
        otpHash: sha256Hash(testOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    const resExpired = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: testOtp,
        challengeToken: expiredToken,
      });

    expect(resExpired.status).toBe(400);
    expect(resExpired.body.success).toBe(false);
    expect(resExpired.body.accessToken).toBeUndefined();

    // Now test with malformed challenge token
    const resMalformed = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: testOtp,
        challengeToken: 'nonexistent_malformed_token_123',
      });

    expect(resMalformed.status).toBe(400);
    expect(resMalformed.body.success).toBe(false);
    expect(resMalformed.body.accessToken).toBeUndefined();

    const sessions = await prisma.authSession.findMany({ where: { userId: billAdminId } });
    expect(sessions).toHaveLength(0);
  });

  // 5. Incorrect OTP cannot establish a session
  test('5. Incorrect OTP cannot establish a session', async () => {
    const validChallenge = crypto.randomBytes(32).toString('hex');
    const realOtp = '884422';

    await prisma.verificationToken.create({
      data: {
        mobile: billAdminMobile,
        tokenHash: sha256Hash(validChallenge),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: billAdminMobile,
        otpHash: sha256Hash(realOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: '000000', // Incorrect OTP
        challengeToken: validChallenge,
      });

    expect(res.body.success).toBe(false);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.token).toBeUndefined();

    const sessions = await prisma.authSession.findMany({ where: { userId: billAdminId } });
    expect(sessions).toHaveLength(0);
  });

  // 6. Correct OTP through the canonical verification endpoint establishes exactly one valid session
  test('6. Correct OTP through canonical verification endpoint establishes exactly one valid session', async () => {
    const validChallenge = crypto.randomBytes(32).toString('hex');
    const realOtp = '654321';

    await prisma.verificationToken.create({
      data: {
        mobile: billAdminMobile,
        tokenHash: sha256Hash(validChallenge),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: billAdminMobile,
        otpHash: sha256Hash(realOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.user.role).toBe('BILL_ADMIN');

    // Exactly one active session in database
    const sessions = await prisma.authSession.findMany({
      where: { userId: billAdminId, revokedAt: null },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(res.body.sessionId);

    const user = await prisma.user.findUnique({ where: { id: billAdminId } });
    expect(user?.activeSessionId).toBe(res.body.sessionId);
  });

  // 7. Reusing an already-consumed OTP/challenge fails
  test('7. Reusing an already-consumed OTP/challenge fails', async () => {
    const validChallenge = crypto.randomBytes(32).toString('hex');
    const realOtp = '112233';

    await prisma.verificationToken.create({
      data: {
        mobile: opsAdminMobile,
        tokenHash: sha256Hash(validChallenge),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: opsAdminMobile,
        otpHash: sha256Hash(realOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    // First attempt succeeds
    const res1 = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
      });
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    // Second attempt with same credentials must fail
    const res2 = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.operationsAdminPrefix}${opsAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
      });

    expect(res2.body.success).toBe(false);
    expect(res2.body.accessToken).toBeUndefined();

    // Verify still only 1 active session in database
    const sessions = await prisma.authSession.findMany({
      where: { userId: opsAdminId, revokedAt: null },
    });
    expect(sessions).toHaveLength(1);
  });

  // 8. The administrator identity and role are derived from the server-side account
  test('8. The administrator identity and role are derived from server-side account', async () => {
    const validChallenge = crypto.randomBytes(32).toString('hex');
    const realOtp = '998877';

    await prisma.verificationToken.create({
      data: {
        mobile: billAdminMobile,
        tokenHash: sha256Hash(validChallenge),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: billAdminMobile,
        otpHash: sha256Hash(realOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    // Client maliciously passes forged role: OPERATIONS_ADMIN
    const res = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
        role: 'OPERATIONS_ADMIN', // Forged role
      });

    expect(res.status).toBe(200);
    // Server-side account truth must override forged client payload
    expect(res.body.user.role).toBe('BILL_ADMIN');
    expect(res.body.role).toBe('BILL_ADMIN');
  });

  // 9. Ten concurrent incorrect worker-password attempts result in exactly ten persisted increments, with persistent lockout
  test('9. Ten concurrent incorrect worker-password attempts result in exactly 10 increments and lockout', async () => {
    // Fire 10 simultaneous failed password attempts using atomic database updater
    const promises = Array.from({ length: 10 }).map(() =>
      AuthService.recordFailedPasswordAttempt(workerUserId)
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);

    const workerAfter = await prisma.user.findUnique({ where: { id: workerUserId } });
    expect(workerAfter?.failedPasswordAttempts).toBe(10);
    expect(workerAfter?.lockedUntil).not.toBeNull();
    expect(workerAfter!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Subsequent login must be rejected with lockout message
    await expect(
      AuthService.login(workerMobile, workerPassword)
    ).rejects.toThrow(/temporarily locked/i);
  });

  // 10. Administrator failed-password attempts also persist and enforce intended lockout policy
  test('10. Administrator failed-password attempts persist and enforce lockout policy', async () => {
    // Submit 10 consecutive incorrect passwords for bill admin
    for (let i = 0; i < 9; i++) {
      await expect(
        AuthService.requestAdminOtp({
          identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
          password: 'IncorrectPassword@999',
        })
      ).rejects.toThrow(/Invalid login credentials/i);
    }

    const adminCheck = await prisma.user.findUnique({ where: { id: billAdminId } });
    expect(adminCheck?.failedPasswordAttempts).toBe(9);
    expect(adminCheck?.lockedUntil).toBeNull();

    // 10th failed attempt triggers lockout
    await expect(
      AuthService.requestAdminOtp({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: 'IncorrectPassword@999',
      })
    ).rejects.toThrow(/temporarily locked/i);

    const adminLocked = await prisma.user.findUnique({ where: { id: billAdminId } });
    expect(adminLocked?.failedPasswordAttempts).toBe(10);
    expect(adminLocked?.lockedUntil).not.toBeNull();
    expect(adminLocked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even correct password is now blocked by lockout
    await expect(
      AuthService.requestAdminOtp({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        password: testPassword,
      })
    ).rejects.toThrow(/temporarily locked/i);
  });

  // 11. Password failure followed by retry cannot reuse a consumed token to circumvent OTP verification
  test('11. Consumed challenge token cannot be reused to circumvent OTP verification after failure', async () => {
    const validChallenge = crypto.randomBytes(32).toString('hex');
    const realOtp = '556677';

    await prisma.verificationToken.create({
      data: {
        mobile: billAdminMobile,
        tokenHash: sha256Hash(validChallenge),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    await prisma.otpRequest.create({
      data: {
        mobile: billAdminMobile,
        otpHash: sha256Hash(realOtp),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    // Successfully verify OTP
    const res1 = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
      });
    expect(res1.status).toBe(200);

    // Attempt to reuse consumed challenge token in any flow
    const resReuse = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: realOtp,
        challengeToken: validChallenge,
      });
    expect(resReuse.body.success).toBe(false);
    expect(resReuse.body.accessToken).toBeUndefined();

    // Verify token row is permanently marked isUsed: true
    const tokenInDb = await prisma.verificationToken.findFirst({
      where: { tokenHash: sha256Hash(validChallenge) },
    });
    expect(tokenInDb?.isUsed).toBe(true);
  });

  // 12. Assert no token, authenticated cookie, active session or authenticated-user payload is returned from any rejected login request
  test('12. Assert no token, authenticated cookie, active session or authenticated-user payload is returned from any rejected request', async () => {
    // Vector A: Admin trying craftsman login without prefix
    await expect(
      AuthService.login(billAdminMobile, testPassword)
    ).rejects.toThrow(/Administrator accounts must authenticate using designated role prefix and two-factor authentication/i);

    // Vector B: POST /api/v1/auth/admin/login
    const resLegacy1 = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`, password: testPassword });
    expect(resLegacy1.status).toBe(410);
    expect(resLegacy1.body.accessToken).toBeUndefined();
    expect(resLegacy1.body.token).toBeUndefined();
    expect(resLegacy1.body.user).toBeUndefined();
    expect(resLegacy1.headers['set-cookie']).toBeUndefined();

    // Vector C: POST /api/v1/auth/admin-login
    const resLegacy2 = await request(app)
      .post('/api/v1/auth/admin-login')
      .send({ identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`, password: testPassword });
    expect(resLegacy2.status).toBe(410);
    expect(resLegacy2.body.accessToken).toBeUndefined();
    expect(resLegacy2.body.token).toBeUndefined();
    expect(resLegacy2.body.user).toBeUndefined();
    expect(resLegacy2.headers['set-cookie']).toBeUndefined();

    // Vector D: Invalid OTP code on verify endpoint
    const resBadOtp = await request(app)
      .post('/api/v1/auth/admin/otp/verify')
      .send({
        identifier: `${config.admin.billAdminPrefix}${billAdminMobile}`,
        otpCode: '000000',
        challengeToken: 'bogus_token',
      });
    expect(resBadOtp.body.success).toBe(false);
    expect(resBadOtp.body.accessToken).toBeUndefined();
    expect(resBadOtp.body.token).toBeUndefined();
    expect(resBadOtp.body.user).toBeUndefined();
    expect(resBadOtp.headers['set-cookie']).toBeUndefined();

    // Database check: Zero active sessions
    const sessions = await prisma.authSession.findMany({
      where: { userId: billAdminId, revokedAt: null },
    });
    expect(sessions).toHaveLength(0);
  });
});
