import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { resetAllRateLimiters, clearRateLimitCache } from '../middleware/rateLimit.middleware';
import { ensureBaselineAdmins, resetAdmins, DEFAULT_BILL_ADMIN_MOBILE, DEFAULT_OPS_ADMIN_MOBILE } from './test_helpers';

describe('TEST-HARNESS-01 — Test Harness Isolation & Rate Limiting Specialist Verification', () => {
  beforeEach(async () => {
    await resetAllRateLimiters();
  });

  afterAll(async () => {
    await resetAllRateLimiters();
    await ensureBaselineAdmins(prisma);
  });

  test('1. Rate limiter resets cleanly after hitting rate limit, preventing cross-test pollution', async () => {
    // Fill up the admin-login rate limiter for 127.0.0.1 (limit is 5 attempts)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/admin-login')
        .set('x-test-rate-limit', 'true')
        .send({ username: '9999999999', password: 'WrongPassword@123' });
    }

    // 6th attempt receives 429
    const blockedRes = await request(app)
      .post('/api/auth/admin-login')
      .set('x-test-rate-limit', 'true')
      .send({ username: '9999999999', password: 'WrongPassword@123' });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.code).toBe('RATE_LIMIT_EXCEEDED');

    // Execute resetAllRateLimiters()
    await resetAllRateLimiters();

    // After reset, request is no longer 429 blocked
    const freshRes = await request(app)
      .post('/api/auth/admin-login')
      .set('x-test-rate-limit', 'true')
      .send({ username: '9999999999', password: 'WrongPassword@123' });

    expect(freshRes.status).not.toBe(429);
    expect([400, 401, 403, 410]).toContain(freshRes.status);
  });

  test('2. ensureBaselineAdmins seamlessly restores seeded admins after destructive test teardowns', async () => {
    // Simulate destructive test teardown that wiped all admins
    await resetAdmins(prisma);

    const countBefore = await prisma.user.count({
      where: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } },
    });
    expect(countBefore).toBe(0);

    // Call ensureBaselineAdmins
    const { billAdmin, opsAdmin } = await ensureBaselineAdmins(prisma);

    expect(billAdmin).toBeDefined();
    expect(billAdmin.mobile).toBe(DEFAULT_BILL_ADMIN_MOBILE);
    expect(billAdmin.role).toBe('BILL_ADMIN');
    expect(billAdmin.status).toBe('ACTIVE');

    expect(opsAdmin).toBeDefined();
    expect(opsAdmin.mobile).toBe(DEFAULT_OPS_ADMIN_MOBILE);
    expect(opsAdmin.role).toBe('OPERATIONS_ADMIN');
    expect(opsAdmin.status).toBe('ACTIVE');

    // Calling ensureBaselineAdmins again idempotently retains the existing admins
    const secondCall = await ensureBaselineAdmins(prisma);
    expect(secondCall.billAdmin.id).toBe(billAdmin.id);
    expect(secondCall.opsAdmin.id).toBe(opsAdmin.id);
  });

  test('3. In-memory and Redis reset helper resetAllRateLimiters cleanses all rate limit states', async () => {
    // Generate rate limit hits across OTP request
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/otp/request')
        .set('x-test-rate-limit', 'true')
        .send({ mobile: '9999900010', purpose: 'LOGIN' });
    }

    await resetAllRateLimiters();

    // Verify OTP request succeeds cleanly without rate limit blockage
    const res = await request(app)
      .post('/api/auth/otp/request')
      .set('x-test-rate-limit', 'true')
      .send({ mobile: '9999900010', purpose: 'REGISTRATION' });

    expect([200, 400]).toContain(res.status);
    expect(res.status).not.toBe(429);
  });
});
