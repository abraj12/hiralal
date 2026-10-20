import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { PlayIntegrityService } from '../services/integrity/playIntegrity.service';
import { GstService } from '../services/gst.service';
import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { parseIndiaBusinessDate } from '../utils/timezone.utils';
import crypto from 'crypto';

describe('Hiralal Rewards Platform — Part 2 Master Remediation Suite', () => {
  const testWorkerMobile = '9870090001';
  const otherWorkerMobile = '9870090002';
  const billAdminMobile = '9870090003';
  const opsAdminMobile = '9870090004';
  const suspendedWorkerMobile = '9870090005';

  let workerUser: any;
  let otherWorker: any;
  let billAdminUser: any;
  let opsAdminUser: any;
  let suspendedUser: any;

  let workerToken: string;
  let otherWorkerToken: string;
  let billAdminToken: string;
  let opsAdminToken: string;
  let suspendedToken: string;

  beforeAll(async () => {
    const mobiles = [
      testWorkerMobile,
      otherWorkerMobile,
      billAdminMobile,
      opsAdminMobile,
      suspendedWorkerMobile,
    ];

    // Clean up previous test artifacts
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: mobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });

    // 1. Worker User
    workerUser = await prisma.user.create({
      data: {
        mobile: testWorkerMobile,
        fullName: 'Master Test Worker',
        passwordHash: 'dummy_hash_worker',
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 1500.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    workerToken = jwt.sign(
      { userId: workerUser.id, role: 'USER' },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // 2. Other Worker
    otherWorker = await prisma.user.create({
      data: {
        mobile: otherWorkerMobile,
        fullName: 'Other Test Worker',
        passwordHash: 'dummy_hash_other',
        role: 'USER',
        status: 'ACTIVE',
        profession: 'TILE_INSTALLER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 500.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    otherWorkerToken = jwt.sign(
      { userId: otherWorker.id, role: 'USER' },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // 3. Bill Admin
    const existingBill = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (existingBill) {
      billAdminUser = existingBill;
    } else {
      billAdminUser = await prisma.user.create({
        data: {
          mobile: billAdminMobile,
          fullName: 'Master Bill Admin',
          passwordHash: 'dummy_hash_bill_admin',
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    billAdminToken = jwt.sign(
      { userId: billAdminUser.id, role: 'BILL_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // 4. Operations Admin
    const existingOps = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (existingOps) {
      opsAdminUser = existingOps;
    } else {
      opsAdminUser = await prisma.user.create({
        data: {
          mobile: opsAdminMobile,
          fullName: 'Master Ops Admin',
          passwordHash: 'dummy_hash_ops_admin',
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    opsAdminToken = jwt.sign(
      { userId: opsAdminUser.id, role: 'OPERATIONS_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // 5. Suspended User
    suspendedUser = await prisma.user.create({
      data: {
        mobile: suspendedWorkerMobile,
        fullName: 'Suspended Worker',
        passwordHash: 'dummy_hash_suspended',
        role: 'USER',
        status: 'SUSPENDED',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });

    suspendedToken = jwt.sign(
      { userId: suspendedUser.id, role: 'USER' },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Ensure baseline reward rules exist
    for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
      const activeRule = await prisma.rewardRule.findFirst({
        where: { profession: prof, isActive: true },
      });
      if (!activeRule) {
        await prisma.rewardRule.create({
          data: {
            profession: prof,
            rewardPercentage: prof === 'PLUMBER' ? 0.50 : 0.75,
            effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
            isActive: true,
            version: 1,
          },
        });
      }
    }
  });

  afterAll(async () => {
    const mobiles = [
      testWorkerMobile,
      otherWorkerMobile,
      suspendedWorkerMobile,
    ];

    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: mobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
  });

  // =========================================================================
  // 1. Mobile Integrity Security & Fail-Closed Behavior
  // =========================================================================
  describe('1. Mobile Application Integrity (Play Integrity)', () => {
    beforeAll(() => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
    });

    afterAll(() => {
      PlayIntegrityService.overrideConfig(null);
    });

    it('fails closed in production environment when Play Integrity credentials are unconfigured', async () => {
      const savedEnv = process.env.NODE_ENV;
      const savedProd = config.isProduction;

      try {
        (config as any).isProduction = true;
        const nonceObj = await PlayIntegrityService.generateNonce();

        const verdict = await PlayIntegrityService.verifyToken({
          nonce: nonceObj.nonce,
          integrityToken: 'dummy_client_token',
        });

        expect(verdict.success).toBe(false);
        expect(verdict.isRealDevice).toBe(false);
        expect(verdict.error).toContain('Play Integrity credentials are not configured');
      } finally {
        (config as any).isProduction = savedProd;
        process.env.NODE_ENV = savedEnv;
      }
    });

    it('rejects verification if nonce is missing or invalid', async () => {
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: '',
        integrityToken: 'token_without_nonce',
      });
      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Nonce is required');
    });

    it('rejects replay of previously consumed nonce', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce();

      // First verification consumes nonce
      await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'first_token',
      });

      // Second verification attempt with same nonce must be rejected
      const secondVerdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'replayed_token',
      });

      expect(secondVerdict.success).toBe(false);
      expect(secondVerdict.error).toContain('Invalid, expired, or replayed');
    });
  });

  // =========================================================================
  // 2. Role-Based Access Control & Negative Authorization
  // =========================================================================
  describe('2. Role Separation & Negative Authorization Boundaries', () => {
    it('denies worker (USER role) access to admin dashboard and bill queues', async () => {
      const dashRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${workerToken}`);
      expect(dashRes.status).toBe(403);

      const billsRes = await request(app)
        .get('/api/admin/bills')
        .set('Authorization', `Bearer ${workerToken}`);
      expect(billsRes.status).toBe(403);
    });

    it('denies Bill Admin access to Operations Admin restricted endpoints', async () => {
      const usersRes = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${billAdminToken}`);
      expect(usersRes.status).toBe(403);

      const payoutsRes = await request(app)
        .get('/api/admin/payouts')
        .set('Authorization', `Bearer ${billAdminToken}`);
      expect(payoutsRes.status).toBe(403);

      const settingsRes = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ isEnabled: true });
      expect(settingsRes.status).toBe(403);
    });

    it('denies Operations Admin access to Bill verification (role separation)', async () => {
      const verifyRes = await request(app)
        .post('/api/admin/bills/some-bill-id/verify')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ action: 'APPROVE', gstIncluded: false });
      expect(verifyRes.status).toBe(403);
    });

    it('immediately denies suspended users access to authenticated endpoints', async () => {
      const walletRes = await request(app)
        .get('/api/wallet')
        .set('Authorization', `Bearer ${suspendedToken}`);
      expect(walletRes.status).toBe(403);
      expect(walletRes.body.message).toContain('suspended');
    });
  });

  // =========================================================================
  // 3. IDOR & Data Isolation Protections
  // =========================================================================
  describe('3. Insecure Direct Object Reference (IDOR) Protections', () => {
    it('prevents worker from marking another worker notification as read', async () => {
      const otherNotification = await prisma.notification.create({
        data: {
          userId: otherWorker.id,
          title: 'Private Notification',
          message: 'Confidential notification for worker B',
          type: 'SYSTEM',
        },
      });

      const patchRes = await request(app)
        .patch(`/api/notifications/${otherNotification.id}/read`)
        .set('Authorization', `Bearer ${workerToken}`);

      expect([400, 403, 404]).toContain(patchRes.status);

      const checkRecord = await prisma.notification.findUnique({
        where: { id: otherNotification.id },
      });
      expect(checkRecord?.isRead).toBe(false);
    });

    it('prevents worker from seeing another worker bills via /api/bills', async () => {
      const res = await request(app)
        .get('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`);

      expect(res.status).toBe(200);
      for (const bill of res.body.bills || []) {
        expect(bill.userId).toBe(workerUser.id);
      }
    });
  });

  // =========================================================================
  // 4. Invoice Date Calendar Bounds & Strict Input Validation
  // =========================================================================
  describe('4. Invoice Date Calendar Bounds & Bill Validation', () => {
    const validDummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    it('rejects impossible calendar date: 2026-02-31', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', 'INV-CAL-001')
        .field('invoiceDate', '2026-02-31')
        .field('billAmount', '1000.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid|calendar/i);
    });

    it('rejects leap day in non-leap year: 2025-02-29', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', 'INV-CAL-002')
        .field('invoiceDate', '2025-02-29')
        .field('billAmount', '1000.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid|calendar/i);
    });

    it('rejects invoice date more than 1 day in the future', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureStr = futureDate.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', 'INV-FUT-001')
        .field('invoiceDate', futureStr)
        .field('billAmount', '1000.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('future');
    });

    it('rejects invoice date older than 5 years', async () => {
      const oldStr = '2015-05-15';

      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', 'INV-OLD-001')
        .field('invoiceDate', oldStr)
        .field('billAmount', '1000.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('too old');
    });

    it('rejects single invoice amount exceeding ₹5,00,00,000 ceiling', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', 'INV-HIGH-001')
        .field('invoiceDate', '2024-06-15')
        .field('billAmount', '50000001.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/exceeds maximum permitted/i);
    });
  });

  // =========================================================================
  // 5. Reverse GST Calculation & Rule Selection Accuracy
  // =========================================================================
  describe('5. Reverse GST & Financial Precision', () => {
    it('correctly calculates reverse GST and eligible base amount', () => {
      // For gross ₹11,800 with 18% GST:
      // GST Amount = 11,800 * 18 / 118 = 1,800
      // Eligible Base = 11,800 - 1,800 = 10,000
      const calc18 = GstService.calculateGstAndEligibleAmount(11800, true, 18.0);
      expect(calc18.gstAmount).toBe(1800.0);
      expect(calc18.eligibleRewardAmount).toBe(10000.0);

      // Reward on ₹10,000 at 0.50% (Plumber rate) = ₹50.00
      const reward = RewardService.calculateReward(calc18.eligibleRewardAmount, 0.50);
      expect(reward).toBe(50.0);
    });

    it('non-GST inclusive bill sets gross amount as eligible reward amount', () => {
      const calcNonGst = GstService.calculateGstAndEligibleAmount(10000, false, 0);
      expect(calcNonGst.gstAmount).toBe(0.0);
      expect(calcNonGst.eligibleRewardAmount).toBe(10000.0);

      const reward = RewardService.calculateReward(calcNonGst.eligibleRewardAmount, 0.50);
      expect(reward).toBe(50.0);
    });

    it('prevents administrators from approving their own submitted bills', async () => {
      // Clean up previous test bill if any
      await prisma.bill.deleteMany({ where: { invoiceNumber: 'INV-ADMIN-SELF-001' } });
      // Create bill submitted by billAdmin
      const adminBill = await prisma.bill.create({
        data: {
          userId: billAdminUser.id,
          invoiceNumber: 'INV-ADMIN-SELF-001',
          invoiceDate: new Date('2024-05-01'),
          billAmount: 5000.0,
          grossBillAmount: 5000.0,
          calculatedReward: 0.0,
          fileUrl: 'https://storage.example.com/test.pdf',
          fileHash: 'dummy_hash_admin_self',
          fileKey: 'bills/admin/test.pdf',
          status: 'PENDING',
        },
      });

      await expect(
        BillService.approveBill(adminBill.id, billAdminUser.id, { gstIncluded: false })
      ).rejects.toThrow(/cannot approve bills submitted under their own account/i);
    });
  });

  // =========================================================================
  // 6. RazorpayX Webhook Security & Deduplication
  // =========================================================================
  describe('6. RazorpayX Webhook Cryptographic Security & Deduplication', () => {
    it('rejects webhooks with invalid HMAC signature', async () => {
      const payload = JSON.stringify({
        event: 'payout.processed',
        payload: { payout: { entity: { id: 'pout_test_1', amount: 100000 } } },
      });

      const res = await request(app)
        .post('/api/webhooks/razorpayx')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'invalid_signature_hex_0000000000000000')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid webhook signature');
    });

    it('rejects webhooks with mismatched currency (fail closed)', async () => {
      const secret = config.razorpayx.webhookSecret || 'webhook_secret_hiralal_rzpx_2026';
      config.razorpayx.webhookSecret = secret;

      // Ensure payment account exists
      const paymentAccount = await prisma.paymentAccount.create({
        data: {
          userId: workerUser.id,
          accountType: 'BANK_ACCOUNT',
          accountHolderName: 'Master Test Worker',
          accountNumber: '1234567890',
          ifscCode: 'HDFC0001234',
          maskedInfo: '••••••••7890',
          isVerified: true,
          isDefault: true,
        },
      });

      // Create test payout
      const testPayout = await prisma.payout.create({
        data: {
          userId: workerUser.id,
          walletId: workerUser.wallet.id,
          paymentAccountId: paymentAccount.id,
          idempotencyKey: `idemp_curr_${Date.now()}`,
          amount: 500.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_curr_test_1',
          paymentType: 'BANK_ACCOUNT',
        },
      });

      const payloadObj = {
        id: `evt_curr_${Date.now()}`,
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: testPayout.razorpayPayoutId,
              amount: 50000,
              currency: 'USD', // Invalid: system is INR only
            },
          },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payloadObj));
      const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/razorpayx')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(payloadObj);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Invalid or missing currency');
    });

    it('rejects webhooks with missing currency (fail closed)', async () => {
      const secret = config.razorpayx.webhookSecret || 'webhook_secret_hiralal_rzpx_2026';
      config.razorpayx.webhookSecret = secret;

      const paymentAccount = await prisma.paymentAccount.create({
        data: {
          userId: workerUser.id,
          accountType: 'BANK_ACCOUNT',
          accountHolderName: 'Master Test Worker',
          accountNumber: '1234567890',
          ifscCode: 'HDFC0001234',
          maskedInfo: '••••••••7890',
          isVerified: true,
          isDefault: true,
        },
      });

      const testPayout = await prisma.payout.create({
        data: {
          userId: workerUser.id,
          walletId: workerUser.wallet.id,
          paymentAccountId: paymentAccount.id,
          idempotencyKey: `idemp_nocurr_${Date.now()}`,
          amount: 500.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_nocurr_test_1',
          paymentType: 'BANK_ACCOUNT',
        },
      });

      const payloadObj = {
        id: `evt_nocurr_${Date.now()}`,
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: testPayout.razorpayPayoutId,
              amount: 50000,
              // currency omitted
            },
          },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payloadObj));
      const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/razorpayx')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(payloadObj);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Invalid or missing currency');
    });

    it('rejects webhooks with missing amount (fail closed)', async () => {
      const secret = config.razorpayx.webhookSecret || 'webhook_secret_hiralal_rzpx_2026';
      config.razorpayx.webhookSecret = secret;

      const paymentAccount = await prisma.paymentAccount.create({
        data: {
          userId: workerUser.id,
          accountType: 'BANK_ACCOUNT',
          accountHolderName: 'Master Test Worker',
          accountNumber: '1234567890',
          ifscCode: 'HDFC0001234',
          maskedInfo: '••••••••7890',
          isVerified: true,
          isDefault: true,
        },
      });

      const testPayout = await prisma.payout.create({
        data: {
          userId: workerUser.id,
          walletId: workerUser.wallet.id,
          paymentAccountId: paymentAccount.id,
          idempotencyKey: `idemp_noamt_${Date.now()}`,
          amount: 500.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_noamt_test_1',
          paymentType: 'BANK_ACCOUNT',
        },
      });

      const payloadObj = {
        id: `evt_noamt_${Date.now()}`,
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: testPayout.razorpayPayoutId,
              currency: 'INR',
              // amount omitted
            },
          },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payloadObj));
      const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/razorpayx')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(payloadObj);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Missing or invalid amount');
    });
  });
});
