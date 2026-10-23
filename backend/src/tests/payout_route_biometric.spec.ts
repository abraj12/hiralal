import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { generateBlindIndex } from '../utils/crypto.utils';

describe('TEST-004: Payout Route Biometric Step-Up and Password Fallback Regression', () => {
  const testMobile = '9870000099';
  const testPassword = 'SecureCraftsmanPass123!';
  let userId: string;
  let userToken: string;
  let walletId: string;
  let paymentAccountId: string;

  beforeAll(async () => {
    // Clean up test fixtures
    await prisma.payout.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: testMobile } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });

    const passwordHash = await bcrypt.hash(testPassword, 10);

    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        fullName: 'Biometric Test Craftsman',
        firstName: 'Biometric',
        lastName: 'Craftsman',
        passwordHash,
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    userId = user.id;

    await prisma.kycRecord.create({
      data: {
        userId,
        panName: 'Biometric Craftsman',
        verifiedName: 'Biometric Craftsman',
        maskedPan: 'ABCXXXX34F',
        panBlindIndex: generateBlindIndex('ABCDE1234F'),
        panStatus: 'VERIFIED',
        nameMatched: true,
      },
    });

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 5000.0,
        processingAmount: 0.0,
        totalRedeemed: 0.0,
      },
    });
    walletId = wallet.id;

    // Provision verified default payment account
    const paymentAccount = await prisma.paymentAccount.create({
      data: {
        userId,
        accountType: 'UPI',
        upiId: 'biometric@okaxis',
        maskedInfo: 'biom****@okaxis',
        accountHolderName: 'Biometric Craftsman',
        isDefault: true,
        isVerified: true,
        providerNameVerified: true,
        providerRegisteredName: 'BIOMETRIC CRAFTSMAN',
        beneficiaryBlindIndex: generateBlindIndex('UPI:biometric@okaxis'),
      },
    });
    paymentAccountId = paymentAccount.id;

    // Ensure default redemption window is open
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
        maximumRedemptionAmount: 50000.0,
      },
      create: {
        id: 'default',
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
        maximumRedemptionAmount: 50000.0,
      },
    });

    userToken = jwt.sign(
      { userId, role: 'USER' },
      config.jwt.accessSecret,
      { expiresIn: '2h' }
    );
  });

  afterAll(async () => {
    await prisma.payout.deleteMany({ where: { userId } });
    await prisma.paymentAccount.deleteMany({ where: { userId } });
    await prisma.kycRecord.deleteMany({ where: { userId } });
    await prisma.walletTransaction.deleteMany({ where: { walletId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('should reject redemption when password fallback contains an invalid format (< 6 chars)', async () => {
    const res = await request(app)
      .post('/api/v1/payouts/redeem')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        idempotencyKey: `idem-bio-short-${Date.now()}`,
        password: '123',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid password format');
  });

  it('should reject redemption when fallback password does not match account password', async () => {
    const res = await request(app)
      .post('/api/v1/payouts/redeem')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        idempotencyKey: `idem-bio-wrong-${Date.now()}`,
        password: 'WrongPassword999!',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Incorrect account password. Verification failed.');
  });

  it('should succeed with redemption when fallback password correctly authenticates the craftsman', async () => {
    const res = await request(app)
      .post('/api/v1/payouts/redeem')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        idempotencyKey: `idem-bio-valid-${Date.now()}`,
        password: testPassword,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.payout).toBeDefined();
    expect(res.body.payout.status).toBe('PENDING');
    expect(Number(res.body.payout.amount)).toBe(5000.0);
    expect(Number(res.body.amountDebited)).toBe(5000.0);

    // Verify wallet balance debited
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    expect(Number(wallet?.availableBalance)).toBe(0.0);
    expect(Number(wallet?.processingAmount)).toBe(5000.0);
  });

  it('should support biometric pass-through without password field when client completed biometric attestation', async () => {
    // Clear previous pending payout to permit next redemption
    await prisma.payout.deleteMany({ where: { userId } });
    // Top up balance for second test
    await prisma.wallet.update({
      where: { id: walletId },
      data: { availableBalance: 2500.0, processingAmount: 0.0 },
    });

    const res = await request(app)
      .post('/api/v1/payouts/redeem')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        idempotencyKey: `idem-bio-none-${Date.now()}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.payout).toBeDefined();
    expect(Number(res.body.payout.amount)).toBe(2500.0);
  });

  it('should support legacy alias POST /api/v1/payouts/request with password authentication fallback', async () => {
    // Clear previous pending payout to permit next redemption
    await prisma.payout.deleteMany({ where: { userId } });
    // Top up balance for alias test
    await prisma.wallet.update({
      where: { id: walletId },
      data: { availableBalance: 1200.0, processingAmount: 0.0 },
    });

    const res = await request(app)
      .post('/api/v1/payouts/request')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        idempotencyKey: `idem-bio-alias-${Date.now()}`,
        password: testPassword,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.payout).toBeDefined();
    expect(Number(res.body.payout.amount)).toBe(1200.0);
  });
});
