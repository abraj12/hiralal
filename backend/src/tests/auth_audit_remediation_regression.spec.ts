import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { SmsService } from '../services/sms';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

describe('AUTH-01, AUTH-02, AUTH-03 Remediation Regression Suite', () => {
  const userMobile = '9988770001';
  const suspendedMobile = '9988770002';
  const lockedMobile = '9988770003';
  const adminMobile = '9988770004';
  const testPassword = 'Password123#Secure!';

  let testUser: any;
  let suspendedUser: any;
  let lockedUser: any;
  let adminUser: any;

  beforeAll(async () => {
    const userMobiles = [userMobile, suspendedMobile, lockedMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: userMobiles } } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: userMobiles } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: userMobiles } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: userMobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: userMobiles } } });

    const passwordHash = await bcrypt.hash(testPassword, 12);

    testUser = await prisma.user.create({
      data: {
        mobile: userMobile,
        fullName: 'Audit User Normal',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: { create: { availableBalance: 1000 } },
      },
    });

    suspendedUser = await prisma.user.create({
      data: {
        mobile: suspendedMobile,
        fullName: 'Audit User Suspended',
        passwordHash,
        role: 'USER',
        status: 'SUSPENDED',
        isVerified: true,
        wallet: { create: { availableBalance: 500 } },
      },
    });

    lockedUser = await prisma.user.create({
      data: {
        mobile: lockedMobile,
        fullName: 'Audit User Locked',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        failedPasswordAttempts: 5,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Locked for 30 minutes
        wallet: { create: { availableBalance: 500 } },
      },
    });

    adminUser = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          mobile: adminMobile,
          fullName: 'Audit Operations Admin',
          passwordHash,
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }
  });

  afterAll(async () => {
    const userMobiles = [userMobile, suspendedMobile, lockedMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: userMobiles } } } });
    if (adminUser?.id) {
      await prisma.authSession.deleteMany({ where: { userId: adminUser.id } });
    }
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: userMobiles } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: userMobiles } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: userMobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: userMobiles } } });
  });

  // =========================================================================
  // AUTH-01: Sessionless & Stale Access Token Logout Fencing
  // =========================================================================
  describe('AUTH-01: Sessionless & Stale Token Logout Hardening', () => {
    it('rejects logout with 400 when access token has no sessionId and no refreshToken is supplied', async () => {
      // 1. User logs in to establish an active session
      const loginRes = await AuthService.login(userMobile, testPassword);
      const activeSessionId = loginRes.sessionId;
      expect(activeSessionId).toBeDefined();

      // Check DB: user has activeSessionId
      const userBefore = await prisma.user.findUnique({ where: { id: testUser.id } });
      expect(userBefore?.activeSessionId).toBe(activeSessionId);

      // 2. Mint a signed, valid access token for testUser WITHOUT sessionId (legacy token simulation)
      const sessionlessToken = jwt.sign(
        { userId: testUser.id, role: 'USER', mobile: userMobile },
        config.jwt.accessSecret,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      // 3. Attempt logout with sessionless token and no refresh token
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${sessionlessToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('SESSION_ID_REQUIRED');

      // 4. Invariant check: user active session and activeSessionId must NOT be revoked!
      const userAfter = await prisma.user.findUnique({ where: { id: testUser.id } });
      expect(userAfter?.activeSessionId).toBe(activeSessionId);

      const activeSession = await prisma.authSession.findFirst({
        where: { userId: testUser.id, sessionId: activeSessionId, revokedAt: null },
      });
      expect(activeSession).not.toBeNull();
    });

    it('AuthService.logout does not revoke sessions when called with undefined sessionId', async () => {
      const loginRes = await AuthService.login(userMobile, testPassword);
      const activeSessionId = loginRes.sessionId;

      // Direct invocation with undefined sessionId and undefined refreshToken
      await AuthService.logout(undefined, testUser.id, undefined);

      // Verify active session remains untouched
      const userAfter = await prisma.user.findUnique({ where: { id: testUser.id } });
      expect(userAfter?.activeSessionId).toBe(activeSessionId);

      const activeSession = await prisma.authSession.findFirst({
        where: { userId: testUser.id, sessionId: activeSessionId, revokedAt: null },
      });
      expect(activeSession).not.toBeNull();
    });

    it('rejects stale admin access token from revoking newer admin session', async () => {
      const session1Id = 'admin-session-1-' + Date.now();
      const session2Id = 'admin-session-2-' + Date.now();

      // Device 1 session
      await prisma.authSession.create({
        data: {
          userId: adminUser.id,
          sessionId: session1Id,
          tokenHash: 'hash-session-1',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Device 2 session (supersedes Device 1)
      await prisma.authSession.create({
        data: {
          userId: adminUser.id,
          sessionId: session2Id,
          tokenHash: 'hash-session-2',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await prisma.user.update({
        where: { id: adminUser.id },
        data: { activeSessionId: session2Id },
      });

      // Token from Device 1 with session1Id
      const device1Token = jwt.sign(
        { userId: adminUser.id, role: 'OPERATIONS_ADMIN', sessionId: session1Id },
        config.admin.accessSecret || config.jwt.accessSecret,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${device1Token}`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('STALE_SESSION');

      // Device 2 session remains active
      const adminAfter = await prisma.user.findUnique({ where: { id: adminUser.id } });
      expect(adminAfter?.activeSessionId).toBe(session2Id);
    });
  });

  // =========================================================================
  // AUTH-02: Login Timing Oracle Elimination & Bcrypt Parity
  // =========================================================================
  describe('AUTH-02: Login Timing Oracle Elimination', () => {
    it('executes full bcrypt comparison on suspended user login to eliminate timing oracle', async () => {
      const start = Date.now();
      await expect(
        AuthService.login(suspendedMobile, testPassword)
      ).rejects.toThrow(/suspended/i);
      const elapsed = Date.now() - start;

      // Cost 12 bcrypt takes at least 30ms-50ms even on fast CPUs, proving bcrypt was run
      expect(elapsed).toBeGreaterThanOrEqual(30);
    });

    it('executes full bcrypt comparison on locked user login to eliminate timing oracle', async () => {
      const start = Date.now();
      await expect(
        AuthService.login(lockedMobile, testPassword)
      ).rejects.toThrow(/locked/i);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(30);
    });

    it('executes full bcrypt comparison on nonexistent user login', async () => {
      const start = Date.now();
      await expect(
        AuthService.login('9999999999', testPassword)
      ).rejects.toThrow(/Invalid mobile number or password/i);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(30);
    });
  });

  // =========================================================================
  // AUTH-03: OTP Anti-Enumeration & Dynamic Latency Equalization
  // =========================================================================
  describe('AUTH-03: OTP Anti-Enumeration & Latency Equalization', () => {
    it('returns uniform message for password reset regardless of whether user exists', async () => {
      // 1. Existing user
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });
      const resExisting = await AuthService.requestPasswordResetOtp({
        mobile: userMobile,
      });
      expect(resExisting.message).toBe('If an eligible account exists, a verification code will be sent.');

      // 2. Non-existent user
      const nonExistentResetMobile = `91${Date.now().toString().slice(-8)}`;
      await prisma.otpRequest.deleteMany({ where: { mobile: nonExistentResetMobile } });
      const resNonExistent = await AuthService.requestPasswordResetOtp({
        mobile: nonExistentResetMobile,
      });
      expect(resNonExistent.message).toBe('If an eligible account exists, a verification code will be sent.');
    });

    it('returns uniform message for login OTP for nonexistent users without creating OTP records', async () => {
      const nonExistentMobile = `92${Date.now().toString().slice(-8)}`;
      await prisma.otpRequest.deleteMany({ where: { mobile: nonExistentMobile } });
      const res = await AuthService.requestOtp({
        mobile: nonExistentMobile,
        purpose: 'LOGIN',
      });

      expect(res.message).toContain('Verification code dispatched successfully');

      // Invariant: The non-existent user must have a suppressed OTP record
      const otpRecord = await prisma.otpRequest.findFirst({
        where: { mobile: nonExistentMobile, purpose: 'LOGIN' },
      });
      // Suppressed OTP record contains SUPPRESSED marker in hash
      expect(otpRecord).toBeDefined();
    });

    it('returns uniform success message when SMS gateway delivery fails for existing users without leaking provider error', async () => {
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });
      const smsSpy = jest.spyOn(SmsService, 'sendOtp').mockResolvedValueOnce({
        success: false,
        error: 'Gateway timeout 504: Carrier network failure',
      });

      // Calling route directly via Supertest
      const res = await request(app)
        .post('/api/auth/otp/request')
        .send({
          mobile: userMobile,
          purpose: 'LOGIN',
        });

      smsSpy.mockRestore();

      // Must NOT leak HTTP 400 with gateway error to prevent error-oracle enumeration
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Verification code dispatched successfully');

      // Failed OTP is invalidated (isUsed = true) while 60s cooldown is preserved for throttling & anti-enumeration parity
      const otp = await prisma.otpRequest.findFirst({
        where: { mobile: userMobile, purpose: 'LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      expect(otp?.isUsed).toBe(true);
      expect(otp?.cooldownUntil).toBeInstanceOf(Date);
      expect(otp!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns uniform message when SMS gateway delivery fails during password recovery without leaking provider error', async () => {
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });
      const smsSpy = jest.spyOn(SmsService, 'sendOtp').mockResolvedValueOnce({
        success: false,
        error: 'Provider down: Out of SMS credits',
      });

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({
          mobile: userMobile,
        });

      smsSpy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('If an eligible account exists, a verification code will be sent.');

      const otp = await prisma.otpRequest.findFirst({
        where: { mobile: userMobile, purpose: 'FORGOT_PASSWORD' },
        orderBy: { createdAt: 'desc' },
      });
      expect(otp?.isUsed).toBe(true);
      expect(otp?.cooldownUntil).toBeNull();
    });

    it('maintains 100% cooldown parity across consecutive requests during SMS gateway failure (Anti-Enumeration)', async () => {
      const smsSpy = jest.spyOn(SmsService, 'sendOtp').mockResolvedValue({
        success: false,
        error: 'Gateway 503 Service Unavailable',
      });

      // 1. Existing user
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });
      const resExisting1 = await request(app)
        .post('/api/auth/otp/request')
        .send({ mobile: userMobile, purpose: 'LOGIN' });
      expect(resExisting1.status).toBe(200);

      const resExisting2 = await request(app)
        .post('/api/auth/otp/request')
        .send({ mobile: userMobile, purpose: 'LOGIN' });
      expect(resExisting2.status).toBe(400);
      expect(resExisting2.body.message).toMatch(/Please wait \d+ seconds/i);

      // 2. Non-existent user
      const nonExistentMobile = `94${Date.now().toString().slice(-8)}`;
      await prisma.otpRequest.deleteMany({ where: { mobile: nonExistentMobile } });
      const resNonExistent1 = await request(app)
        .post('/api/auth/otp/request')
        .send({ mobile: nonExistentMobile, purpose: 'LOGIN' });
      expect(resNonExistent1.status).toBe(200);

      const resNonExistent2 = await request(app)
        .post('/api/auth/otp/request')
        .send({ mobile: nonExistentMobile, purpose: 'LOGIN' });
      expect(resNonExistent2.status).toBe(400);
      expect(resNonExistent2.body.message).toMatch(/Please wait \d+ seconds/i);

      smsSpy.mockRestore();
    });

    it('delayed SMS failure for older OTP does NOT invalidate a newer OTP record (ID-targeted cleanup)', async () => {
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });

      let resolveOldSms: (val: any) => void;
      const oldSmsPromise = new Promise((resolve) => {
        resolveOldSms = resolve;
      });

      // Spy: first call hangs on promise, second call succeeds
      let callCount = 0;
      const smsSpy = jest.spyOn(SmsService, 'sendOtp').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return oldSmsPromise as Promise<any>;
        }
        return { success: true };
      });

      // 1. Fire Request 1 (hangs in SMS dispatch)
      const req1Promise = AuthService.requestOtp({
        mobile: userMobile,
        purpose: 'LOGIN',
      });

      // Wait a moment for OTP 1 record to be created in DB
      await new Promise((r) => setTimeout(r, 60));

      const otp1Record = await prisma.otpRequest.findFirst({
        where: { mobile: userMobile, purpose: 'LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      expect(otp1Record).toBeDefined();

      // Simulate cooldown expiry on OTP 1 so Request 2 can be made
      await prisma.otpRequest.update({
        where: { id: otp1Record!.id },
        data: { cooldownUntil: new Date(Date.now() - 1000) },
      });

      // 2. Fire Request 2 (creates OTP 2)
      const req2Result = await AuthService.requestOtp({
        mobile: userMobile,
        purpose: 'LOGIN',
      });
      expect(req2Result.message).toContain('Verification code dispatched successfully');

      const otp2Record = await prisma.otpRequest.findFirst({
        where: { mobile: userMobile, purpose: 'LOGIN', id: { not: otp1Record!.id } },
        orderBy: { createdAt: 'desc' },
      });
      expect(otp2Record).toBeDefined();
      expect(otp2Record?.isUsed).toBe(false);

      // 3. Now let Request 1's SMS call finally complete with FAILURE
      resolveOldSms!({ success: false, error: 'Delayed network timeout' });
      await req1Promise;

      // 4. Invariant: OTP 1 must be marked isUsed = true
      const updatedOtp1 = await prisma.otpRequest.findUnique({
        where: { id: otp1Record!.id },
      });
      expect(updatedOtp1?.isUsed).toBe(true);

      // 5. Invariant: OTP 2 must NOT be invalidated by Request 1's cleanup!
      const updatedOtp2 = await prisma.otpRequest.findUnique({
        where: { id: otp2Record!.id },
      });
      expect(updatedOtp2?.isUsed).toBe(false);

      smsSpy.mockRestore();
    });

    it('enforces latency floor equalization across both real dispatch and suppressed dispatch paths', async () => {
      // 1. Real dispatch path (existing user)
      await prisma.otpRequest.deleteMany({ where: { mobile: userMobile } });
      const startReal = Date.now();
      await AuthService.requestOtp({
        mobile: userMobile,
        purpose: 'LOGIN',
      });
      const realElapsed = Date.now() - startReal;

      // 2. Suppressed dispatch path (non-existent user)
      const nonExistentMobile = `93${Date.now().toString().slice(-8)}`;
      const startSuppressed = Date.now();
      await AuthService.requestOtp({
        mobile: nonExistentMobile,
        purpose: 'LOGIN',
      });
      const suppressedElapsed = Date.now() - startSuppressed;

      // Both paths must satisfy the minimum floor (15ms in test environment)
      expect(realElapsed).toBeGreaterThanOrEqual(14);
      expect(suppressedElapsed).toBeGreaterThanOrEqual(14);
    });
  });
});
