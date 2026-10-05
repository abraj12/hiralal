import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { sha256Hash } from '../utils/crypto.utils';

describe('Authentication, Single-Use Verification Tokens & Session Security Tests', () => {
  const testMobile = '9876543210';
  const testPassword = 'SecureCraftsman@2026';

  beforeAll(async () => {
    // Clean up test data
    await prisma.authSession.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: testMobile } });
    await prisma.otpRequest.deleteMany({ where: { mobile: testMobile } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: testMobile } });
    await prisma.otpRequest.deleteMany({ where: { mobile: testMobile } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });
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
        otpHash: sha256Hash(testOtpCode),
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
        otpHash: sha256Hash(resetOtp),
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
});
