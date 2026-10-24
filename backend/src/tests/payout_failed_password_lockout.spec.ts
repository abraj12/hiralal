import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';
import { prisma } from '../db';
import request from 'supertest';
import { app } from '../server';

describe('Finding 12 Regression Suite: Payout Password Lockout Counter Enforcement', () => {
  const testMobile = '9800000401';
  const testPassword = 'CorrectPassword@123';
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { entityType: 'User', entityId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        passwordHash,
        fullName: 'Payout Lockout User',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
        isVerified: true,
      },
    });
    userId = user.id;

    await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 1000.0,
      },
    });

    // Login to obtain auth session token
    const loginRes = await AuthService.login(testMobile, testPassword);
    authToken = loginRes.token;
  });

  afterAll(async () => {
    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { entityType: 'User', entityId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it('increments failedPasswordAttempts on incorrect password during payout redemption and locks account', async () => {
    // 1. Submit incorrect password
    const res1 = await request(app)
      .post('/api/payouts/redeem')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        idempotencyKey: 'idem-key-1234567890-1',
        password: 'WrongPassword@123',
      });

    expect(res1.status).toBe(400);
    expect(res1.body.message).toMatch(/Incorrect account password/i);

    const userAfter1 = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfter1?.failedPasswordAttempts).toBe(1);

    // 2. Simulate reaching max lockout threshold
    await prisma.user.update({
      where: { id: userId },
      data: { failedPasswordAttempts: 9 }, // next attempt reaches 10
    });

    const resLock = await request(app)
      .post('/api/payouts/redeem')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        idempotencyKey: 'idem-key-1234567890-2',
        password: 'WrongPassword@123',
      });

    expect(resLock.status).toBe(429);
    expect(resLock.body.message).toMatch(/Account is temporarily locked/i);

    const userLocked = await prisma.user.findUnique({ where: { id: userId } });
    expect(userLocked?.lockedUntil).not.toBeNull();
    expect(userLocked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // 3. Even with correct password, locked account is rejected with 429
    const resWhileLocked = await request(app)
      .post('/api/payouts/redeem')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        idempotencyKey: 'idem-key-1234567890-3',
        password: testPassword,
      });

    expect(resWhileLocked.status).toBe(429);
    expect(resWhileLocked.body.message).toMatch(/Account is temporarily locked/i);

    // 4. Reset lockout manually and verify counter resets on success
    await prisma.user.update({
      where: { id: userId },
      data: { failedPasswordAttempts: 3, lockedUntil: null },
    });

    await AuthService.resetFailedPasswordAttempts(userId);
    const userReset = await prisma.user.findUnique({ where: { id: userId } });
    expect(userReset?.failedPasswordAttempts).toBe(0);
    expect(userReset?.lockedUntil).toBeNull();
  });
});
