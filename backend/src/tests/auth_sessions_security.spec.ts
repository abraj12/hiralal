import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { AuthService } from '../services/auth.service';
import { sha256Hash, hmacHashOtp } from '../utils/crypto.utils';
import { closeRedis, checkRedisConnection, isRedisReady, getRedisClient } from '../redis';
import { clearRateLimitCache } from '../middleware/rateLimit.middleware';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('Authentication, Single-Use Verification Tokens & Session Security Tests', () => {
  const testMobile = '9876500001';
  const testPassword = 'SecureCraftsman@2026';

  beforeAll(async () => {
    await checkRedisConnection();
    // Clean up test data
    await prisma.authSession.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: testMobile } });
    await prisma.otpRequest.deleteMany({ where: { mobile: testMobile } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: testMobile } });
    await prisma.otpRequest.deleteMany({ where: { mobile: testMobile } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });
    await prisma.$disconnect();
    await closeRedis();
  });

  let validVerificationToken: string;

  test('1. OTP Request creates valid non-expired OTP record', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ mobile: testMobile, purpose: 'REGISTRATION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expiresAt).toBeDefined();
  });

  test('2. OTP Verification issues short-lived single-use verificationToken without requiring user creation yet', async () => {
    // Generate known test OTP in database
    const testOtpCode = '654321';
    await prisma.otpRequest.create({
      data: {
        mobile: testMobile,
        otpHash: hmacHashOtp(testOtpCode),
        purpose: 'REGISTRATION',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ mobile: testMobile, otpCode: testOtpCode, purpose: 'REGISTRATION' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.verificationToken).toBeDefined();
    expect(typeof verifyRes.body.verificationToken).toBe('string');

    validVerificationToken = verifyRes.body.verificationToken;
  });

  test('3. Registration consumes verificationToken WITHOUT re-verifying original OTP', async () => {
    // Register using only the verificationToken
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        mobile: testMobile,
        fullName: 'Ramesh Plumber',
        password: testPassword,
        profession: 'PLUMBER',
        verificationToken: validVerificationToken,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.user.mobile).toBe(testMobile);
    expect(regRes.body.user.profession).toBe('PLUMBER');
    expect(regRes.body.accessToken).toBeDefined();
    expect(regRes.body.refreshToken).toBeDefined();

    // Verify verificationToken is now marked as used in DB
    const tokenRecord = await prisma.verificationToken.findFirst({
      where: { mobile: testMobile, isUsed: true },
    });
    expect(tokenRecord).not.toBeNull();
    expect(tokenRecord?.isUsed).toBe(true);

    // Replay check: attempting to reuse same verification token MUST fail
    const replayRes = await request(app)
      .post('/api/auth/register')
      .send({
        mobile: testMobile,
        fullName: 'Ramesh Plumber 2',
        password: testPassword,
        profession: 'PLUMBER',
        verificationToken: validVerificationToken,
      });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.message).toMatch(/Invalid or expired registration verification token/i);
  });

  test('4. Rotating AuthSession: Refresh token yields new tokens and updates session', async () => {
    // Login to get fresh refresh token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: testPassword });

    expect(loginRes.status).toBe(200);
    const initialRefresh = loginRes.body.refreshToken;

    // Call refresh
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: initialRefresh });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).toBeDefined();
    expect(refreshRes.body.refreshToken).not.toBe(initialRefresh);

    const rotatedRefresh = refreshRes.body.refreshToken;

    // Call refresh again with new rotated token -> should succeed
    const secondRefreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotatedRefresh });

    expect(secondRefreshRes.status).toBe(200);
  });

  test('5. Replay Attack Detection: Reusing old refresh token revokes all user sessions', async () => {
    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: testPassword });

    const tokenA = loginRes.body.refreshToken;

    // Rotate once: tokenA -> tokenB
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokenA });
    expect(refreshRes.status).toBe(200);
    const tokenB = refreshRes.body.refreshToken;

    // Attacker attempts to reuse tokenA!
    const replayAttemptRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokenA });

    expect(replayAttemptRes.status).toBe(401);
    expect(replayAttemptRes.body.message).toMatch(/Compromised or reused refresh token/i);

    // tokenB must ALSO now be revoked due to family revocation!
    const tokenBAttemptRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokenB });

    expect(tokenBAttemptRes.status).toBe(401);
  });

  test('6. Password Reset Flow: Request -> Verify -> Complete with session revocation', async () => {
    const resetOtp = '112233';
    await prisma.otpRequest.create({
      data: {
        mobile: testMobile,
        otpHash: hmacHashOtp(resetOtp),
        purpose: 'FORGOT_PASSWORD',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // 1. Verify reset OTP
    const verifyRes = await request(app)
      .post('/api/auth/password-reset/verify')
      .send({ mobile: testMobile, otpCode: resetOtp });

    expect(verifyRes.status).toBe(200);
    const resetToken = verifyRes.body.verificationToken;

    // 2. Complete password reset
    const newPassword = 'NewSecretPassword@2026';
    const completeRes = await request(app)
      .post('/api/auth/password-reset/complete')
      .send({
        mobile: testMobile,
        verificationToken: resetToken,
        newPassword,
      });

    expect(completeRes.status).toBe(200);

    // 3. Old password fails
    const oldLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: testPassword });
    expect(oldLoginRes.status).toBe(401);

    // 4. New password succeeds
    const newLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: newPassword });
    expect(newLoginRes.status).toBe(200);
  });

  test('7. Concurrent Registration with Single-Use Token: only 1 succeeds, second receives 400', async () => {
    const concurrentMobile = `92${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testOtp = '987123';
    await prisma.otpRequest.create({
      data: {
        mobile: concurrentMobile,
        otpHash: hmacHashOtp(testOtp),
        purpose: 'REGISTRATION',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ mobile: concurrentMobile, otpCode: testOtp, purpose: 'REGISTRATION' });

    expect(verifyRes.status).toBe(200);
    const token = verifyRes.body.verificationToken;

    // Fire 2 concurrent registration requests with the exact same token
    const [reg1, reg2] = await Promise.all([
      request(app)
        .post('/api/auth/register')
        .send({
          mobile: concurrentMobile,
          fullName: 'Concurrent Craftsman 1',
          password: 'Password@123',
          profession: 'PLUMBER',
          verificationToken: token,
        }),
      request(app)
        .post('/api/auth/register')
        .send({
          mobile: concurrentMobile,
          fullName: 'Concurrent Craftsman 2',
          password: 'Password@123',
          profession: 'PLUMBER',
          verificationToken: token,
        }),
    ]);

    const statuses = [reg1.status, reg2.status].sort();
    expect(statuses).toEqual([201, 400]);

    // Cleanup
    await prisma.authSession.deleteMany({ where: { user: { mobile: concurrentMobile } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: concurrentMobile } } });
    await prisma.user.deleteMany({ where: { mobile: concurrentMobile } });
    await prisma.verificationToken.deleteMany({ where: { mobile: concurrentMobile } });
    await prisma.otpRequest.deleteMany({ where: { mobile: concurrentMobile } });
  });

  test('8. Admin Login Rate Limiting: 6th attempt within window receives 429 Too Many Requests', async () => {
    await checkRedisConnection();
    clearRateLimitCache();
    if (isRedisReady()) {
      const redis = getRedisClient();
      await redis.del(
        'ratelimit:auth:admin_login_user:9999999999',
        'ratelimit:auth:admin_login_ip:127.0.0.1',
        'ratelimit:auth:admin_login_ip:::1',
        'ratelimit:auth:admin_login_ip:::ffff:127.0.0.1'
      );
    }

    // Send 5 login requests with x-test-rate-limit header
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/admin-login')
        .set('x-test-rate-limit', 'true')
        .send({ username: '9999999999', password: 'WrongPassword@123' });
      expect([400, 401, 403, 410]).toContain(res.status);
    }

    // 6th attempt should be blocked by rate limiter
    const blockedRes = await request(app)
      .post('/api/auth/admin-login')
      .set('x-test-rate-limit', 'true')
      .send({ username: '9999999999', password: 'WrongPassword@123' });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  test('9. Logout revokes active session, clears activeSessionId, and causes subsequent authenticated requests to fail with 401', async () => {
    // 1. Log in to establish fresh session
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: 'NewSecretPassword@2026' });

    expect(loginRes.status).toBe(200);
    const { accessToken, refreshToken, user } = loginRes.body;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    // 2. Verified authenticated request succeeds before logout
    const preLogoutRes = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(preLogoutRes.status).toBe(200);

    // 3. Perform logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // 4. Verify in DB that activeSessionId is null and session is revoked
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.activeSessionId).toBeNull();

    const activeSessions = await prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeSessions.length).toBe(0);

    // 5. Subsequent request with the same access token MUST be rejected with 401
    const postLogoutRes = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(postLogoutRes.status).toBe(401);
    expect(postLogoutRes.body.success).toBe(false);

    // 6. Attempting to use the revoked refresh token must also fail with 401
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.success).toBe(false);
  });

  test('10. Sessionless JWTs are rejected with 401 when active session is present or in sensitive environments', async () => {
    // 1. Log in to establish fresh active session
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: 'NewSecretPassword@2026' });

    expect(loginRes.status).toBe(200);
    const { user } = loginRes.body;

    // 2. Craft a token WITHOUT sessionId
    const sessionlessToken = jwt.sign(
      { userId: user.id, role: user.role, mobile: user.mobile },
      config.jwt.accessSecret,
      { expiresIn: '15m' }
    );

    // 3. Attempt authenticated request with sessionless token
    const res = await request(app)
      .get('/api/wallet')
      .set('x-enforce-session', 'true')
      .set('Authorization', `Bearer ${sessionlessToken}`);

    // Must be rejected with 401
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('11. Stale user access token from superseded session cannot revoke newer active session', async () => {
    // 1. Device A Login
    const loginA = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: 'NewSecretPassword@2026' });
    expect(loginA.status).toBe(200);
    const tokenA = loginA.body.accessToken || loginA.body.token;
    const sessionA = loginA.body.sessionId;

    // 2. Device B Login (supersedes Session A)
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ mobile: testMobile, password: 'NewSecretPassword@2026' });
    expect(loginB.status).toBe(200);
    const tokenB = loginB.body.accessToken || loginB.body.token;
    const sessionB = loginB.body.sessionId;

    expect(sessionA).not.toBe(sessionB);

    // Verify user's active session is now Session B
    const user = await prisma.user.findUnique({ where: { mobile: testMobile } });
    expect(user?.activeSessionId).toBe(sessionB);

    // 3. Device A attempts logout with stale access token
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    // Must be rejected as STALE_SESSION with HTTP 401
    expect(logoutRes.status).toBe(401);
    expect(logoutRes.body.code).toBe('STALE_SESSION');

    // 4. Invariant: Device B's active session MUST NOT be revoked!
    const userAfter = await prisma.user.findUnique({ where: { mobile: testMobile } });
    expect(userAfter?.activeSessionId).toBe(sessionB);

    // 5. Device B is still authenticated and can access protected endpoints
    const walletRes = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(walletRes.status).toBe(200);
  });

  test('12. Stale admin access token from superseded session cannot revoke newer admin session', async () => {
    const admin = await getOrCreateOpsAdmin(prisma);
    const adminSecret = config.admin.accessSecret || config.jwt.accessSecret;

    // Session 1 for admin
    const session1Id = `adm-sess-1-${Date.now()}`;
    await prisma.authSession.create({
      data: {
        userId: admin.id,
        sessionId: session1Id,
        tokenHash: sha256Hash(`adm-refresh-1-${Date.now()}`),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await prisma.user.update({
      where: { id: admin.id },
      data: { activeSessionId: session1Id },
    });
    const adminToken1 = jwt.sign(
      { userId: admin.id, role: admin.role, mobile: admin.mobile, sessionId: session1Id },
      adminSecret,
      { expiresIn: '1d' }
    );

    // Session 2 for admin (supersedes Session 1)
    const session2Id = `adm-sess-2-${Date.now()}`;
    await prisma.authSession.create({
      data: {
        userId: admin.id,
        sessionId: session2Id,
        tokenHash: sha256Hash(`adm-refresh-2-${Date.now()}`),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await prisma.authSession.updateMany({
      where: { userId: admin.id, sessionId: session1Id },
      data: { revokedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: admin.id },
      data: { activeSessionId: session2Id },
    });
    const adminToken2 = jwt.sign(
      { userId: admin.id, role: admin.role, mobile: admin.mobile, sessionId: session2Id },
      adminSecret,
      { expiresIn: '1d' }
    );

    // Workstation 1 calls logout with stale admin token
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({});

    expect(logoutRes.status).toBe(401);
    expect(logoutRes.body.code).toBe('STALE_SESSION');

    // Verify Session 2 is still the active session
    const adminAfter = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(adminAfter?.activeSessionId).toBe(session2Id);
  });

  test('13. Anti-enumeration: OTP request endpoints return consistent format and enforce uniform limits across existing, non-existent, and inactive accounts', async () => {
    const nonExistentMobile = '9876543999';
    await prisma.otpRequest.deleteMany({ where: { mobile: nonExistentMobile } });

    // 1. Password reset OTP for non-existent mobile
    const resetNonExistent = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ mobile: nonExistentMobile });
    expect(resetNonExistent.status).toBe(200);
    expect(resetNonExistent.body.success).toBe(true);
    expect(resetNonExistent.body.message).toMatch(/If an eligible account exists/i);

    // 2. Second request immediately triggers cooldown protection uniformly
    const resetNonExistent2 = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ mobile: nonExistentMobile });
    // Same safe response without revealing account status
    expect(resetNonExistent2.status).toBe(200);
    expect(resetNonExistent2.body.success).toBe(true);

    // 3. Login OTP request for non-existent mobile
    const loginNonExistent = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ mobile: nonExistentMobile, purpose: 'LOGIN' });
    expect(loginNonExistent.status).toBe(200);
    expect(loginNonExistent.body.success).toBe(true);

    // 4. Second login OTP request immediately triggers cooldown
    const loginNonExistent2 = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ mobile: nonExistentMobile, purpose: 'LOGIN' });
    expect(loginNonExistent2.status).toBe(400);
    expect(loginNonExistent2.body.message).toMatch(/Please wait \d+ seconds/i);
  });
});


