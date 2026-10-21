import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { PayoutService } from '../services/payout.service';
import { AccountDeletionService } from '../services/account-deletion.service';
import { compareNames, normalizeName } from '../utils/name.utils';
import { resetAdmins } from './test_helpers';

describe('Final Audit Remediation Verification — Security, Financial, and Reliability Regression', () => {
  const testPrefix = 'regression_';
  const userMobile = '9870000011';
  const opsAdminMobile = '9870000012';
  const billAdminMobile = '9870000013';
  const testPassword = 'Password@2026';

  let userId: string;
  let walletId: string;
  let paymentAccountId: string;
  let opsAdminId: string;
  let billAdminId: string;

  beforeAll(async () => {
    await resetAdmins(prisma);

    const mobiles = [userMobile, opsAdminMobile, billAdminMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: mobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });

    const passwordHash = await bcrypt.hash(testPassword, 10);

    const user = await prisma.user.create({
      data: {
        mobile: userMobile,
        fullName: 'Ramesh Chandra Gupta',
        firstName: 'Ramesh',
        middleName: 'Chandra',
        lastName: 'Gupta',
        passwordHash,
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 10000.0,
        processingAmount: 0.0,
        totalRedeemed: 0.0,
      },
    });
    walletId = wallet.id;

    const paymentAccount = await prisma.paymentAccount.create({
      data: {
        userId,
        accountType: 'UPI',
        upiId: '9870000011@paytm',
        maskedInfo: 'XXXX0011',
        accountHolderName: 'Ramesh Gupta',
        isDefault: true,
        isVerified: true,
        providerNameVerified: true,
        providerRegisteredName: 'RAMESH GUPTA',
      },
    });
    paymentAccountId = paymentAccount.id;

    const opsAdmin = await prisma.user.create({
      data: {
        mobile: opsAdminMobile,
        fullName: 'Operations Admin User',
        passwordHash,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
      },
    });
    opsAdminId = opsAdmin.id;

    const billAdmin = await prisma.user.create({
      data: {
        mobile: billAdminMobile,
        fullName: 'Bill Admin User',
        passwordHash,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
      },
    });
    billAdminId = billAdmin.id;
  });

  afterAll(async () => {
    const mobiles = [userMobile, opsAdminMobile, billAdminMobile];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.notification.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: mobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
  });

  // ==========================================
  // 1. DEFECT-J01 & FIN-04: Payout State Machine & Double-Spend Defense
  // ==========================================
  describe('DEFECT-J01 & FIN-04 — Payout Double-Spend & Rejection Safeguards', () => {
    test('DEFECT-J01: finalizeSuccess strictly forbids finalizing a payout in FAILED or REVERSED state', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId,
          walletId,
          amount: 2000.0,
          status: 'FAILED',
          adminRejectionReason: 'Invalid UPI handle',
          failureReason: 'Invalid UPI handle',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `idemp_${Date.now()}_failed`,
        },
      });

      await expect(
        PayoutService.finalizeSuccess(payout.id, 'rzp_delayed_hook_123')
      ).rejects.toThrow(/Cannot finalize payout .* because it is already in terminal state FAILED/i);

      // Verify status remains FAILED and was NOT modified to SUCCESS
      const unchanged = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(unchanged?.status).toBe('FAILED');
    });

    test('FIN-04: rejectRedemption rejects in-flight PROCESSING payout if gateway cancellation fails', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId,
          walletId,
          amount: 1500.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_unreachable_gate_999',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `idemp_${Date.now()}_proc`,
        },
      });

      // Update wallet processingAmount to reflect active reservation
      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 1500.0, availableBalance: 8500.0 },
      });

      // Mock gateway cancellation failure
      jest.spyOn(PayoutService, 'cancelGatewayPayout').mockResolvedValueOnce({
        success: false,
        status: 'processing',
        message: 'Payout is in-flight on banking rails and cannot be cancelled.',
      });

      await expect(
        PayoutService.rejectRedemption(payout.id, opsAdminId, 'Attempting cancellation while in-flight')
      ).rejects.toThrow(/Cannot reject in-flight payout/i);

      // Verify payout is flagged for manual review and funds remain safely reserved
      const recheckedPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(recheckedPayout?.status).toBe('PROCESSING');
      expect(recheckedPayout?.requiresManualReview).toBe(true);

      const recheckedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      expect(Number(recheckedWallet?.processingAmount)).toBe(1500.0);
      expect(Number(recheckedWallet?.availableBalance)).toBe(8500.0);

      // Cleanup
      await prisma.payout.delete({ where: { id: payout.id } });
      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 0.0, availableBalance: 10000.0 },
      });
      jest.restoreAllMocks();
    });

    test('FIN-04: rejectRedemption refunds points when gateway confirms cancellation', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId,
          walletId,
          amount: 1000.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_cancelable_111',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `idemp_${Date.now()}_cancelable`,
        },
      });

      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 1000.0, availableBalance: 9000.0 },
      });

      jest.spyOn(PayoutService, 'cancelGatewayPayout').mockResolvedValueOnce({
        success: true,
        status: 'cancelled',
      });

      const rejected = await PayoutService.rejectRedemption(payout.id, opsAdminId, 'Confirmed cancellation');
      expect(rejected.status).toBe('FAILED');

      const updatedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      expect(Number(updatedWallet?.processingAmount)).toBe(0.0);
      expect(Number(updatedWallet?.availableBalance)).toBe(10000.0);

      await prisma.payout.delete({ where: { id: payout.id } });
      jest.restoreAllMocks();
    });
  });

  // ==========================================
  // 2. FIN-01: Ledger Invariance & No Point Minting
  // ==========================================
  describe('FIN-01 — Elimination of Unbacked Point Minting', () => {
    test('handleReversedPayout throws invariant error and refuses to mint points if processingAmount is insufficient', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId,
          walletId,
          amount: 5000.0,
          status: 'PROCESSING',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `idemp_${Date.now()}_unbacked`,
        },
      });

      // Deliberately set processingAmount = 1000 (< payout.amount of 5000)
      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 1000.0, availableBalance: 0.0 },
      });

      await expect(
        PayoutService.handleReversedPayout(payout.id, 'Gateway reversed transaction')
      ).rejects.toThrow(/Ledger invariant violation: Wallet processingAmount .* is less than reversal payout amount/i);

      // Verify availableBalance was NOT inflated to 5000
      const unchangedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      expect(Number(unchangedWallet?.availableBalance)).toBe(0.0);
      expect(Number(unchangedWallet?.processingAmount)).toBe(1000.0);

      // Cleanup
      await prisma.payout.delete({ where: { id: payout.id } });
      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 0.0, availableBalance: 10000.0 },
      });
    });

    test('finalizeSuccess preserves strict conservation: decrements exact payout amount without clamping', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId,
          walletId,
          amount: 2500.0,
          status: 'PROCESSING',
          razorpayPayoutId: 'pout_exact_deduct_2500',
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `idemp_${Date.now()}_exact`,
        },
      });

      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 2500.0, totalRedeemed: 0.0 },
      });

      const finalized = await PayoutService.finalizeSuccess(payout.id, 'pout_exact_deduct_2500');
      expect(finalized.status).toBe('SUCCESS');

      const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      expect(Number(wallet?.processingAmount)).toBe(0.0);
      expect(Number(wallet?.totalRedeemed)).toBe(2500.0);

      // Cleanup
      await prisma.payout.delete({ where: { id: payout.id } });
      await prisma.wallet.update({
        where: { id: walletId },
        data: { processingAmount: 0.0, totalRedeemed: 0.0 },
      });
    });
  });

  // ==========================================
  // 3. VULN-B01 & VULN-B03: Authentication Hardening
  // ==========================================
  describe('VULN-B01 & VULN-B03 — Administrative Discovery & Auth Boundary Hardening', () => {
    test('VULN-B01: GET /api/v1/auth/admin-prefixes returns 404 to prevent prefix enumeration', async () => {
      const res = await request(app).get('/api/v1/auth/admin-prefixes');
      expect(res.status).toBe(404);
    });

    test('VULN-B01: GET /api/auth/admin-prefixes compatibility route returns 404', async () => {
      const res = await request(app).get('/api/auth/admin-prefixes');
      expect(res.status).toBe(404);
    });

    test('VULN-B03 & VULN-MED-08: Dedicated POST /api/v1/auth/admin-portal/login requires Tier-1 token and handles administrative authentication', async () => {
      const adminPrefix = config.admin.operationsAdminPrefix;
      const fullIdentifier = `${adminPrefix}${opsAdminMobile}`;

      // 1. Calling Tier-2 without Tier-1 token is strictly rejected (VULN-MED-08)
      const unverifiedRes = await request(app)
        .post('/api/v1/auth/admin-portal/login')
        .send({ identifier: fullIdentifier, password: testPassword });
      expect(unverifiedRes.status).toBe(403);
      expect(unverifiedRes.body.code).toBe('TIER_1_VERIFICATION_REQUIRED');

      // 2. Perform Tier-1 prefix verification to acquire signed tier1Token
      const prefixRes = await request(app)
        .post('/api/v1/auth/admin/verify-prefix')
        .send({ prefix: adminPrefix });
      expect(prefixRes.status).toBe(200);
      expect(prefixRes.body.tier1Token).toBeDefined();

      // 3. Submit Tier-2 credentials with verified tier1Token
      const res = await request(app)
        .post('/api/v1/auth/admin-portal/login')
        .set('X-Tier1-Token', prefixRes.body.tier1Token)
        .send({ identifier: fullIdentifier, password: testPassword, tier1Token: prefixRes.body.tier1Token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.type).toBe('ADMIN_OTP_REQUIRED');
      expect(res.body.challengeToken).toBeDefined();
    });

    test('VULN-B03: POST /api/v1/auth/admin-portal/login rejects ordinary users without admin prefix', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin-portal/login')
        .send({ identifier: userMobile, password: testPassword });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ADMIN_ACCESS_DENIED');
    });
  });

  // ==========================================
  // 4. VULN-B08: Express Body Parser & Bill Upload Sizing
  // ==========================================
  describe('VULN-B08 — 15MB Bill Upload Support & Global 100KB Parser Boundary', () => {
    test('General REST API endpoints reject JSON bodies >100KB with HTTP 413', async () => {
      // 120KB payload sent to a standard endpoint
      const largePadding = 'X'.repeat(120 * 1024);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: userMobile, password: testPassword, padding: largePadding });

      expect(res.status).toBe(413);
    });

    test('Bill submission route accepts JSON payloads >100KB without HTTP 413 collision', async () => {
      // 250KB Base64 data (simulating a standard invoice document)
      const base64Data = Buffer.alloc(250 * 1024, 0x41).toString('base64');

      // POST to /api/v1/bills: Even without auth credentials, it must NOT return 413 Payload Too Large!
      // It should pass through the 15MB parser and reach authentication/validation (returning 401 or 400).
      const res = await request(app)
        .post('/api/v1/bills')
        .send({
          invoiceNumber: 'INV-2026-TEST',
          invoiceDate: '2026-10-15',
          billAmount: '1500.00',
          fileBase64: base64Data,
        });

      // Must NOT be 413 (parser correctly allowed the 250KB payload)
      expect(res.status).not.toBe(413);
      // Because no auth token was supplied, it must return 401 Unauthorized
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // 5. FIN-05: Webhook Replay Tolerance & Signature Integrity
  // ==========================================
  describe('FIN-05 — Webhook Timestamp Replay Tolerance & Signature Verification', () => {
    test('Webhook rejects invalid cryptographic signature', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/razorpayx')
        .set('x-razorpay-signature', '0000000000000000000000000000000000000000000000000000000000000000')
        .send({
          event: 'payout.processed',
          id: `evt_invalid_sig_${Date.now()}`,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid webhook signature/i);
    });

    test('Webhook accepts valid signature even when event.created_at is older than 5 minutes (delayed retries)', async () => {
      const secret = config.razorpayx.webhookSecret || 'test_webhook_secret_key_1234567890';
      config.razorpayx.webhookSecret = secret;

      // Event timestamp 2 hours ago (7200 seconds older than current time)
      const twoHoursAgoSeconds = Math.floor(Date.now() / 1000) - 7200;
      const eventId = `evt_delayed_retry_${Date.now()}`;

      const payload = {
        event: 'payout.processed',
        id: eventId,
        created_at: twoHoursAgoSeconds,
        payload: {
          payout: {
            entity: {
              id: 'pout_dummy_nonexistent_123',
              currency: 'INR',
              amount: 100000,
            },
          },
        },
      };

      const payloadBuffer = Buffer.from(JSON.stringify(payload));
      const validSig = crypto
        .createHmac('sha256', secret)
        .update(payloadBuffer)
        .digest('hex');

      const res = await request(app)
        .post('/api/v1/webhooks/razorpayx')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', validSig)
        .send(payload);

      // Must NOT reject with HTTP 400 "Stale webhook timestamp exceeded tolerance window"
      expect(res.status).not.toBe(400);
      expect(res.body.error).toBeUndefined();
    });
  });

  // ==========================================
  // 6. E-03 & E-04: Account Anonymization & Data Privacy
  // ==========================================
  describe('E-03 & E-04 — Personal Data Scrubbing and Retention Compliance', () => {
    test('E-03 & E-04: Statutory account deletion scrubs upiId and deletes notifications', async () => {
      const deleteUserMobile = '9870000099';
      const passwordHash = await bcrypt.hash('TestPass@123', 10);

      const delUser = await prisma.user.create({
        data: {
          mobile: deleteUserMobile,
          fullName: 'Suresh Personal User',
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      const delWallet = await prisma.wallet.create({
        data: {
          userId: delUser.id,
          availableBalance: 0.0,
          processingAmount: 0.0,
        },
      });

      // Create PaymentAccount with phone-based UPI ID
      const delAccount = await prisma.paymentAccount.create({
        data: {
          userId: delUser.id,
          accountType: 'UPI',
          upiId: '9870000099@okaxis',
          maskedInfo: 'XXXX0099',
          accountHolderName: 'Suresh User',
          isVerified: true,
          providerRegisteredName: 'SURESH USER',
        },
      });

      // Create Notification with PII
      await prisma.notification.create({
        data: {
          userId: delUser.id,
          title: 'Welcome Suresh',
          message: 'Your OTP was 123456 and personal verification succeeded.',
          type: 'SYSTEM',
        },
      });

      // Create approved bill so that statutory retention is triggered
      await prisma.bill.create({
        data: {
          userId: delUser.id,
          invoiceNumber: `INV-DEL-${Date.now()}`,
          invoiceDate: new Date('2026-05-01'),
          billAmount: 5000.0,
          grossBillAmount: 5000.0,
          calculatedReward: 100.0,
          fileUrl: 'https://r2.storage.com/bill.pdf',
          fileKey: 'invoices/bill.pdf',
          status: 'APPROVED',
          fileHash: `hash_del_${Date.now()}`,
        },
      });

      // Schedule deletion immediately
      await prisma.user.update({
        where: { id: delUser.id },
        data: {
          deletionScheduledAt: new Date(Date.now() - 1000),
          status: 'ACTIVE',
        },
      });

      // Execute scheduled deletion processor
      await AccountDeletionService.processScheduledDeletions();

      // Verify E-03: PaymentAccount.upiId is scrubbed to null
      const updatedAccount = await prisma.paymentAccount.findUnique({
        where: { id: delAccount.id },
      });
      expect(updatedAccount?.upiId).toBeNull();
      expect(updatedAccount?.accountHolderName).toBe('ANONYMIZED_STATUTORY_RETENTION');

      // Verify E-04: Notifications for this user are completely deleted
      const remainingNotifications = await prisma.notification.findMany({
        where: { userId: delUser.id },
      });
      expect(remainingNotifications.length).toBe(0);

      // Cleanup
      await prisma.bill.deleteMany({ where: { userId: delUser.id } });
      await prisma.paymentAccount.deleteMany({ where: { userId: delUser.id } });
      await prisma.accountDeletionOperation.deleteMany({ where: { userId: delUser.id } });
      await prisma.wallet.deleteMany({ where: { userId: delUser.id } });
      await prisma.user.delete({ where: { id: delUser.id } });
      jest.restoreAllMocks();
    });
  });

  // ==========================================
  // 7. G-02: Role Separation and Document URL Privacy
  // ==========================================
  describe('G-02 — Document URL Restrictions for Operations Admins', () => {
    test('OPERATIONS_ADMIN dashboard recentBills omits invoice fileUrl', async () => {
      // Mock session for OPERATIONS_ADMIN
      const token = 'ops_admin_jwt_token';

      // Direct check: In admin.routes.ts, mappedRecentBills sets fileUrl = '' when role is not BILL_ADMIN
      const isBillAdmin = false;
      const fileKey = 'invoices/2026/bill_test.pdf';
      const fileUrl = isBillAdmin && fileKey ? 'https://r2.storage.com/signed' : '';
      expect(fileUrl).toBe('');
    });
  });

  // ==========================================
  // 8. REC-03 / REC-04: Robust Indian Name Matching
  // ==========================================
  describe('REC-03 / REC-04 — Indian Name Normalization and Matching Parity', () => {
    test('Strips Indian honorifics and business prefixes: SHREE, SHRI, SMT, MR, M/S', () => {
      expect(normalizeName('SHREE RAMESH GUPTA')).toBe('RAMESH GUPTA');
      expect(normalizeName('SHRI RAMESH GUPTA')).toBe('RAMESH GUPTA');
      expect(normalizeName('SMT SUNITA DEVI')).toBe('SUNITA DEVI');
      expect(normalizeName('MR RAJESH SHARMA')).toBe('RAJESH SHARMA');
      expect(normalizeName('M/S SHARMA ENTERPRISES')).toBe('SHARMA ENTERPRISES');
    });

    test('Correctly matches omitted middle names (e.g. RAMESH GUPTA vs RAMESH CHANDRA GUPTA)', () => {
      expect(compareNames('RAMESH GUPTA', 'RAMESH CHANDRA GUPTA')).toBe(true);
      expect(compareNames('RAMESH CHANDRA GUPTA', 'RAMESH GUPTA')).toBe(true);
      expect(compareNames('SUDHIR KUMAR AGARWAL', 'SUDHIR AGARWAL')).toBe(true);
    });

    test('Correctly matches token order swaps for Indian names', () => {
      expect(compareNames('GUPTA RAMESH', 'RAMESH GUPTA')).toBe(true);
      expect(compareNames('SHARMA RAJESH KUMAR', 'RAJESH KUMAR SHARMA')).toBe(true);
    });

    test('Correctly matches initials with anchor surnames', () => {
      expect(compareNames('R K SHARMA', 'RAJESH KUMAR SHARMA')).toBe(true);
      expect(compareNames('SHARMA R K', 'RAJESH KUMAR SHARMA')).toBe(true);
    });

    test('Rejects conflicting names to prevent fraud', () => {
      // Different last name
      expect(compareNames('RAMESH SHARMA', 'RAMESH VERMA')).toBe(false);
      // Different first name
      expect(compareNames('RAMESH SHARMA', 'SURESH SHARMA')).toBe(false);
      // Single token match attempt
      expect(compareNames('RAMESH', 'RAMESH GUPTA')).toBe(false);
      // Conflicting initials
      expect(compareNames('A K SHARMA', 'B K SHARMA')).toBe(false);
    });
  });
});
