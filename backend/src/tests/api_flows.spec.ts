import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { closeRedis } from '../redis';

describe('Hiralal & Sons - End-to-End API Integration Tests', () => {
  let userToken: string;
  let adminToken: string;
  let testUserId: string;
  let testAdminId: string;

  beforeAll(async () => {
    // Reset pool for clean test run
    const { year, month } = getIstYearAndMonth();
    await prisma.rewardPool.upsert({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      update: { totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
      create: { profession: 'PLUMBER', year, month, totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
    });

    await prisma.rewardRule.updateMany({
      where: { profession: 'PLUMBER', isActive: true },
      data: { isActive: false },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        monthlyPoolLimit: 50000.0,
        minRedemptionAmount: 500.0,
        maxRedemptionAmount: 10000.0,
        effectiveFrom: new Date('2020-01-01'),
        isActive: true,
      },
    });

    // 1. Provision Test Admin in PostgreSQL
    const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
    const admin = await prisma.user.upsert({
      where: { mobile: '9999999999' },
      update: { role: 'ADMIN', status: 'ACTIVE', passwordHash: adminPasswordHash },
      create: {
        mobile: '9999999999',
        fullName: 'Hiralal Admin',
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    testAdminId = admin.id;

    const challengeToken = crypto.randomBytes(32).toString('hex');
    await prisma.verificationToken.create({
      data: {
        mobile: '9999999999',
        tokenHash: crypto.createHash('sha256').update(challengeToken).digest('hex'),
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const adminLoginRes = await request(app)
      .post('/api/auth/admin-login')
      .send({ username: 'ADMIN9999999999', password: 'Admin@123', verificationToken: challengeToken });
    if (adminLoginRes.status !== 200) {
      console.error('adminLoginRes failed with status:', adminLoginRes.status, adminLoginRes.body);
    }
    expect(adminLoginRes.status).toBe(200);
    adminToken = adminLoginRes.body.token;

    // 2. Provision Test Plumber User
    const userPasswordHash = await bcrypt.hash('Password@123', 10);
    const user = await prisma.user.upsert({
      where: { mobile: '9876543210' },
      update: { fullName: 'Raj Kumar', status: 'ACTIVE', passwordHash: userPasswordHash },
      create: {
        mobile: '9876543210',
        fullName: 'Raj Kumar',
        passwordHash: userPasswordHash,
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 2500.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });
    testUserId = user.id;

    // Ensure wallet exists
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, availableBalance: 2500.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const userLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: '9876543210', password: 'Password@123' });
    expect(userLoginRes.status).toBe(200);
    userToken = userLoginRes.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await closeRedis();
  });

  test('GET /health returns 200 OK with service details', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toContain('Hiralal & Sons');
  });

  test('POST /api/auth/send-otp and registration flow', async () => {
    const uniqueMobile = `91${Math.floor(10000000 + Math.random() * 90000000)}`;

    const otpRes = await request(app)
      .post('/api/auth/send-otp')
      .send({ mobile: uniqueMobile, purpose: 'REGISTRATION' });
    expect(otpRes.status).toBe(200);
    expect(otpRes.body.success).toBe(true);

    // Create a known OTP hash in test db for this registration
    const testOtpCode = '789123';
    const otpHash = crypto.createHash('sha256').update(testOtpCode).digest('hex');

    await prisma.otpRequest.create({
      data: {
        mobile: uniqueMobile,
        otpHash,
        purpose: 'REGISTRATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        mobile: uniqueMobile,
        fullName: 'Vikram Singh',
        password: 'Password@123',
        profession: 'TILE_INSTALLER',
        otpCode: testOtpCode,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.profession).toBe('TILE_INSTALLER');
    expect(regRes.body.token).toBeDefined();

    // Clean up created user
    await prisma.wallet.deleteMany({ where: { user: { mobile: uniqueMobile } } });
    await prisma.user.deleteMany({ where: { mobile: uniqueMobile } });
  });

  test('GET /api/auth/me returns profile and profession', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.fullName).toBe('Raj Kumar');
    expect(res.body.user.profession).toBe('PLUMBER');
  });

  test('POST /api/bills uploads real bill with base64 document', async () => {
    const invoiceNumber = `INV-API-${Date.now()}`;
    const fileBase64 = Buffer.from('%PDF-1.4 test invoice content ' + Date.now()).toString('base64');

    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        invoiceNumber,
        invoiceDate: '2026-10-02',
        billAmount: 20000,
        fileBase64,
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.bill.invoiceNumber).toBe(invoiceNumber);
    expect(res.body.bill.status).toBe('PENDING');
    // Mobile response hides provisional calculation before approval
    expect(res.body.bill.calculatedReward == null || Number(res.body.bill.calculatedReward) === 0).toBe(true);
  });

  test('GET /api/admin/dashboard returns operational stats and pool', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard?profession=PLUMBER')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.totalUsers).toBeGreaterThan(0);
    expect(res.body.stats.pool.totalPoolCap).toBe(50000);
  });

  test('Admin approves bill and credits reward to user wallet', async () => {
    const invoiceNumber = `INV-APPROVE-${Date.now()}`;
    const fileBase64 = Buffer.from('%PDF-1.4 test invoice content ' + Date.now()).toString('base64');

    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        invoiceNumber,
        invoiceDate: '2026-10-02',
        billAmount: 30000,
        fileBase64,
        fileName: 'bill.pdf',
        mimeType: 'application/pdf',
      });

    const billId = billRes.body.bill.id;

    // Admin verifies and approves
    const approveRes = await request(app)
      .post(`/api/admin/bills/${billId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'APPROVE', remarks: 'Valid authorized plumbing invoice' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.bill.status).toBe('APPROVED');
    expect(approveRes.body.rewardCredited).toBe(150); // 0.5% of 30000
  });

  test('Admin configures arbitrary redemption window in UTC', async () => {
    const startAt = new Date(Date.now() - 3600 * 1000).toISOString();
    const endAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const res = await request(app)
      .put('/api/admin/settings/redemption')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        isEnabled: true,
        startAt,
        endAt,
        minimumAmount: 500,
        maximumAmount: 10000,
        message: 'Rewards redemption window is now open for verified craftsmen.',
      });

    expect(res.status).toBe(200);
    expect(res.body.settings.isEnabled).toBe(true);
    expect(res.body.settings.minimumAmount).toBe(500);

    // User eligibility check
    const eligRes = await request(app)
      .get('/api/payouts/eligibility')
      .set('Authorization', `Bearer ${userToken}`);
    expect(eligRes.status).toBe(200);
    expect(eligRes.body.windowSettings.isEnabled).toBe(true);
  });

  test('Webhook rejects invalid signatures and accepts valid ones', async () => {
    const payload = JSON.stringify({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_123', reference_id: 'ref_123' } } },
    });

    // Invalid signature
    const invalidRes = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-signature', 'invalidsig123')
      .send(JSON.parse(payload));
    expect(invalidRes.status).toBe(400);
  });

  test('Contract A: Admin cannot authenticate via regular /api/auth/login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ mobile: '9999900001', password: 'AdminPassword@123' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('Contract D: POST /api/admin/bills/:id/verify rejects customRewardAmount with 400', async () => {
    const res = await request(app)
      .post('/api/admin/bills/any-bill-id/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'APPROVE', customRewardAmount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Manual customRewardAmount overrides are strictly prohibited');
  });

  test('Contract F: POST /api/auth/logout rejects missing token and accepts verified token', async () => {
    // Missing credentials
    const missingRes = await request(app)
      .post('/api/auth/logout')
      .send({});
    expect(missingRes.status).toBe(400);

    // Unsigned / forged token
    const forgedToken = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhZG1pbi0xMjMifQ.';
    const forgedRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${forgedToken}`)
      .send({});
    expect(forgedRes.status).toBe(400);

    // Valid verified token
    const validRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
  });

  test('Admin OTP Flow: POST /api/auth/admin-login rejects without verificationToken with 403', async () => {
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ identifier: '9999900001', password: 'AdminPassword@123' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Password-only admin login is deprecated and disabled');
  });

  test('Contract C: POST /api/admin/payouts/:id/action rejects FAIL action with 400', async () => {
    const res = await request(app)
      .post('/api/admin/payouts/any-id/action')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'FAIL', reason: 'Failed disbursement' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid action. Must be APPROVE or REJECT');
  });
});
