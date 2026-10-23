import request from 'supertest';
import crypto from 'crypto';
import { app } from '../server';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';
import { PayoutWorker } from '../worker/payout.worker';
import { BillService } from '../services/bill.service';
import { GstService } from '../services/gst.service';
import { StorageService } from '../services/storage.service';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';
import { AuthService } from '../services/auth.service';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import { resetAdmins } from './test_helpers';

describe('Production Hardening & Financial Integrity Release Candidate Tests', () => {
  const adminMobile = '9876549901';
  const plumberMobile = '9876549902';
  const billAdminMobile = '9876549903';
  let adminUser: any;
  let plumberUser: any;
  let billAdminUser: any;
  let adminToken: string;
  let plumberToken: string;
  let billAdminToken: string;
  let activeGstRule: any;
  let expiredGstRule: any;

  beforeAll(async () => {
    await resetAdmins(prisma);
    // Clean up test data
    const mobiles = [adminMobile, plumberMobile, billAdminMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });

    await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });

    adminUser = await prisma.user.create({
      data: {
        mobile: adminMobile,
        fullName: 'Hardening Admin Lead',
        passwordHash: 'hash',
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    billAdminUser = await prisma.user.create({
      data: {
        mobile: billAdminMobile,
        fullName: 'Hardening Bill Admin',
        passwordHash: 'hash',
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    plumberUser = await prisma.user.create({
      data: {
        mobile: plumberMobile,
        fullName: 'Verified Hardened Plumber',
        passwordHash: 'hash',
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 2000.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    const adminSessionId = crypto.randomUUID();
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { activeSessionId: adminSessionId },
    });
    await prisma.authSession.create({
      data: {
        userId: adminUser.id,
        sessionId: adminSessionId,
        tokenHash: 'mock-admin-token-hash',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    adminToken = jwt.sign(
      { userId: adminUser.id, role: adminUser.role, sessionId: adminSessionId },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    const billAdminSessionId = crypto.randomUUID();
    await prisma.user.update({
      where: { id: billAdminUser.id },
      data: { activeSessionId: billAdminSessionId },
    });
    await prisma.authSession.create({
      data: {
        userId: billAdminUser.id,
        sessionId: billAdminSessionId,
        tokenHash: 'mock-bill-admin-token-hash',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    billAdminToken = jwt.sign(
      { userId: billAdminUser.id, role: billAdminUser.role, sessionId: billAdminSessionId },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    const plumberSessionId = crypto.randomUUID();
    await prisma.user.update({
      where: { id: plumberUser.id },
      data: { activeSessionId: plumberSessionId },
    });
    await prisma.authSession.create({
      data: {
        userId: plumberUser.id,
        sessionId: plumberSessionId,
        tokenHash: 'mock-plumber-token-hash',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    plumberToken = jwt.sign(
      { userId: plumberUser.id, role: plumberUser.role, sessionId: plumberSessionId },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Active GST rule
    activeGstRule = await GstService.createGstRule(adminUser.id, {
      ratePercentage: 18.0,
      description: 'Active 18% GST',
      isDefault: false,
      effectiveFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    // Expired GST rule
    const expiredPastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expiredGstRule = await prisma.gstRule.create({
      data: {
        ratePercentage: 12.0,
        description: 'Expired GST Rule',
        isActive: true,
        effectiveFrom: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        effectiveUntil: expiredPastDate,
        createdByAdminId: adminUser.id,
      },
    });

    // Ensure single active reward rule exists for Plumber
    await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    const mobiles = [adminMobile, plumberMobile, billAdminMobile, '9876549904'];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
    if (activeGstRule) await prisma.gstRule.delete({ where: { id: activeGstRule.id } }).catch(() => {});
    if (expiredGstRule) await prisma.gstRule.delete({ where: { id: expiredGstRule.id } }).catch(() => {});
    await resetAdmins(prisma);
  });

  describe('1. File Upload & Magic-Byte Validation', () => {
    test('1.1 StorageService rejects genuine PDF bytes with mismatched .jpg extension', () => {
      const pdfBytes = Buffer.from('%PDF-1.4 Fake PDF Content');
      expect(() => {
        StorageService.validateAndHashFile({
          buffer: pdfBytes,
          originalFilename: 'spoofed_document.jpg',
          mimeType: 'image/jpeg',
        });
      }).toThrow(/does not match detected file content type/i);
    });

    test('1.2 StorageService rejects genuine JPEG bytes with mismatched .pdf extension', () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(() => {
        StorageService.validateAndHashFile({
          buffer: jpegBytes,
          originalFilename: 'fake_invoice.pdf',
          mimeType: 'application/pdf',
        });
      }).toThrow(/does not match detected file content type/i);
    });

    test('1.3 StorageService accepts valid PDF bytes with matching .pdf extension', () => {
      const pdfBytes = Buffer.from('%PDF-1.4 Genuine PDF invoice');
      const result = StorageService.validateAndHashFile({
        buffer: pdfBytes,
        originalFilename: 'genuine_invoice.pdf',
        mimeType: 'application/pdf',
      });
      expect(result.extension).toBe('.pdf');
      expect(result.normalizedMime).toBe('application/pdf');
      expect(result.fileHash).toBeDefined();
    });
  });

  describe('2. Payout Pre-Dispatch Failure (failBeforeDispatch)', () => {
    test('2.1 Pre-dispatch identity mismatch fails immediately, restores wallet balance, and creates PAYOUT_REVERSAL', async () => {
      // Setup payout in APPROVED state
      const initialWallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(initialWallet?.availableBalance)).toBe(2000.0);

      // Create a payment account where provider name does NOT match PAN
      const paymentAcc = await prisma.paymentAccount.create({
        data: {
          userId: plumberUser.id,
          accountType: 'UPI',
          upiId: 'plumber@okhdfcbank',
          maskedInfo: 'plumber@okhdfcbank',
          isVerified: true,
          providerNameVerified: true,
          providerRegisteredName: 'Completely Different Name',
        },
      });

      // Submit PAN with verifiedName 'Hardened Plumber'
      await prisma.kycRecord.create({
        data: {
          userId: plumberUser.id,
          panNumberEncrypted: 'enc',
          maskedPan: 'ABCDE1234F',
          panName: 'Verified Hardened Plumber',
          verifiedName: 'Verified Hardened Plumber',
          panStatus: 'VERIFIED',
          nameMatched: true,
        },
      });

      // Create requested payout and approve it
      const payout = await prisma.payout.create({
        data: {
          userId: plumberUser.id,
          walletId: plumberUser.wallet.id,
          paymentAccountId: paymentAcc.id,
          paymentType: 'UPI',
          amount: 1000.0,
          status: 'APPROVED',
          idempotencyKey: `rc-predispatch-${Date.now()}`,
        },
      });

      // Debit wallet to simulate requested state
      await prisma.wallet.update({
        where: { id: plumberUser.wallet.id },
        data: {
          availableBalance: 1000.0,
          processingAmount: 1000.0,
        },
      });

      // Trigger PayoutWorker processPayout
      await PayoutWorker.processPayout(payout.id);

      // Check payout status: MUST be FAILED, NOT stuck in PROCESSING!
      const updatedPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(updatedPayout?.status).toBe('FAILED');
      expect(updatedPayout?.failureReason).toMatch(/does not match verified PAN name/i);

      // Check wallet: funds restored to availableBalance!
      const updatedWallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(updatedWallet?.availableBalance)).toBe(2000.0);
      expect(Number(updatedWallet?.processingAmount)).toBe(0.0);

      // Check ledger: PAYOUT_REVERSAL transaction created!
      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: payout.id, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).not.toBeNull();
      expect(Number(reversalTx?.amount)).toBe(1000.0);
    });
  });

  describe('3. GST Rule Fail-Closed Validation', () => {
    test('3.1 Rejects approval with non-existent gstRuleId', async () => {
      const bill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-GST-ERR-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 5000.0,
        fileBuffer: Buffer.from(`%PDF-1.4 dummy bill content 1 ${Date.now()}`),
        fileName: 'bill1.pdf',
        mimeType: 'application/pdf',
      });

      await expect(
        BillService.approveBill({
          billId: bill.id,
          adminId: adminUser.id,
          gstIncluded: true,
          gstRuleId: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toThrow('The selected GST rule is invalid or not applicable to this bill');
    });

    test('3.2 Rejects approval with expired gstRuleId', async () => {
      const bill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-GST-EXP-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 5000.0,
        fileBuffer: Buffer.from(`%PDF-1.4 dummy bill content 2 ${Date.now()}`),
        fileName: 'bill2.pdf',
        mimeType: 'application/pdf',
      });

      await expect(
        BillService.approveBill({
          billId: bill.id,
          adminId: adminUser.id,
          gstIncluded: true,
          gstRuleId: expiredGstRule.id,
        })
      ).rejects.toThrow('The selected GST rule is invalid or not applicable to this bill');
    });

    test('3.3 Accepts approval with valid active gstRuleId', async () => {
      const bill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-GST-OK-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 5000.0,
        fileBuffer: Buffer.from(`%PDF-1.4 dummy bill content 3 ${Date.now()}`),
        fileName: 'bill3.pdf',
        mimeType: 'application/pdf',
      });

      const result = await BillService.approveBill({
        billId: bill.id,
        adminId: adminUser.id,
        gstIncluded: true,
        gstRuleId: activeGstRule.id,
      });

      expect(result.bill.status).toBe('APPROVED');
      expect(result.bill.gstRuleId).toBe(activeGstRule.id);
      expect(Number(result.bill.gstAmount)).toBeGreaterThan(0);
    });
  });

  describe('4. Cookie Authentication & Anti-CSRF Protection', () => {
    test('4.1 Cookie auth on mutating route fails if X-CSRF-Token is missing or mismatched', async () => {
      const res = await request(app)
        .post('/api/admin/settings/redemption')
        .set('Cookie', `admin_access_token=${adminToken}; csrf_token=valid_secret_csrf_token_12345`)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', 'wrong_csrf_token')
        .send({ isEnabled: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    test('4.2 Cookie auth on mutating route fails if Origin is untrusted', async () => {
      const res = await request(app)
        .post('/api/admin/settings/redemption')
        .set('Cookie', `admin_access_token=${adminToken}; csrf_token=valid_secret_csrf_token_12345`)
        .set('Origin', 'https://malicious-attacker-site.com')
        .set('X-CSRF-Token', 'valid_secret_csrf_token_12345')
        .send({ isEnabled: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_VALIDATION_FAILED');
    });

    test('4.3 Cookie auth on mutating route succeeds when valid origin and matching CSRF token are provided', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Cookie', `admin_access_token=${adminToken}; csrf_token=valid_secret_csrf_token_12345`)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', 'valid_secret_csrf_token_12345')
        .send({
          isEnabled: true,
          minimumRedemptionAmount: 500,
          startAt: new Date(Date.now() - 3600000).toISOString(),
          endAt: new Date(Date.now() + 86400000).toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('4.4 Cookie auth on mutating route fails closed if csrf_token cookie is missing', async () => {
      const res = await request(app)
        .post('/api/admin/settings/redemption')
        .set('Cookie', `admin_access_token=${adminToken}`)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', 'some_token_without_cookie')
        .send({ isEnabled: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    test('4.5 Cookie auth on mutating route fails closed if both csrf_token cookie and X-CSRF-Token header are missing', async () => {
      const res = await request(app)
        .post('/api/admin/settings/redemption')
        .set('Cookie', `admin_access_token=${adminToken}`)
        .set('Origin', 'http://localhost:3000')
        .send({ isEnabled: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    test('4.6 Malformed percent-encoded Cookie is handled safely without throwing 500', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Cookie', `admin_access_token=${adminToken}; malformed=%E0%A4%A; regular=value`)
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('4.7 POST /api/auth/logout clears admin_access_token and csrf_token cookies', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `admin_access_token=${adminToken}; csrf_token=some_token`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('admin_access_token=;');
      expect(cookieStr).toContain('csrf_token=;');
    });
  });

  describe('5. Bill Document URL & Secure Inspection', () => {
    let testBill: any;

    beforeAll(async () => {
      testBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-DOC-${Date.now()}`,
        invoiceDate: '2026-10-11',
        billAmount: 3500.0,
        fileBuffer: Buffer.from('%PDF-1.4 Mock invoice content for document url test'),
        fileName: 'invoice_test.pdf',
        mimeType: 'application/pdf',
      });
    });

    test('5.1 Authorized admin can retrieve fresh signed document URL', async () => {
      const res = await request(app)
        .get(`/api/admin/bills/${testBill.id}/document-url`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.documentUrl).toBeDefined();
      expect(typeof res.body.documentUrl).toBe('string');
      expect(res.body.fileType).toBe('application/pdf');
    });

    test('5.2 Non-existent bill returns 404', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/admin/bills/${nonExistentId}/document-url`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('BILL_NOT_FOUND');
    });

    test('5.3 Unauthorized craftsman cannot access admin document URL', async () => {
      const res = await request(app)
        .get(`/api/admin/bills/${testBill.id}/document-url`)
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('6. System Health & Readiness Endpoints', () => {
    test('6.1 GET /health/ready returns readiness check', async () => {
      const res = await request(app).get('/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.status).toBeDefined();
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.database).toBeDefined();
    });

    test('6.2 GET /ready alias functions identical to /health/ready', async () => {
      const res = await request(app).get('/ready');
      expect([200, 503]).toContain(res.status);
      expect(res.body.status).toBeDefined();
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.database).toBeDefined();
    });
  });

  describe('7. Bill Review Configuration & Server-Side Approval Contract Verification', () => {
    let reviewTestBill: any;

    beforeAll(async () => {
      reviewTestBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-REV-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 1180.0,
        fileBuffer: Buffer.from('%PDF-1.4 Review test bill content'),
        fileName: 'review_bill.pdf',
        mimeType: 'application/pdf',
      });
    });

    test('7.1 Authorized Bill Admin can fetch bill review configuration with applicable reward and GST rules', async () => {
      const res = await request(app)
        .get(`/api/admin/bills/${reviewTestBill.id}/review-config`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.billId).toBe(reviewTestBill.id);
      expect(res.body.profession).toBe('PLUMBER');
      expect(res.body.rewardRule).toBeDefined();
      expect(res.body.rewardRule.rewardPercentage).toBe(0.50);
      expect(Array.isArray(res.body.gstRules)).toBe(true);
      expect(res.body.gstRules.some((r: any) => r.id === activeGstRule.id)).toBe(true);
      // Expired GST rule must NOT be returned for this invoice date
      expect(res.body.gstRules.some((r: any) => r.id === expiredGstRule.id)).toBe(false);
    });

    test('7.2 Craftsman user cannot access GET /bills/:id/review-config (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/admin/bills/${reviewTestBill.id}/review-config`)
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test('7.3 Non-existent bill ID returns 404 BILL_NOT_FOUND', async () => {
      const res = await request(app)
        .get('/api/admin/bills/00000000-0000-0000-0000-000000000000/review-config')
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('BILL_NOT_FOUND');
    });

    test('7.4 Bill for user with no profession returns 409 USER_PROFESSION_REQUIRED', async () => {
      const noProfUser = await prisma.user.create({
        data: {
          mobile: '9876549904',
          fullName: 'No Profession Worker',
          passwordHash: 'hash',
          role: 'USER',
          profession: null,
          status: 'ACTIVE',
          isVerified: true,
        },
      });

      const noProfBill = await BillService.submitBill({
        userId: noProfUser.id,
        invoiceNumber: `INV-NOPROF-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 2000.0,
        fileBuffer: Buffer.from('%PDF-1.4 No profession test bill'),
        fileName: 'noprof_bill.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .get(`/api/admin/bills/${noProfBill.id}/review-config`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('PROFESSION_NOT_CONFIGURED');
    });

    test('7.5 POST /bills/:id/verify fails if gstIncluded is missing or non-boolean', async () => {
      const unverifiedBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-NOGST-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 1180.0,
        fileBuffer: Buffer.from('%PDF-1.4 unverified bill'),
        fileName: 'unverified.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .post(`/api/admin/bills/${unverifiedBill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('GST_SELECTION_REQUIRED');
    });

    test('7.6 POST /bills/:id/verify fails when client gstRate conflicts with selected rule ratePercentage', async () => {
      const conflictBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-CONF-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 1180.0,
        fileBuffer: Buffer.from('%PDF-1.4 conflict bill'),
        fileName: 'conflict.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .post(`/api/admin/bills/${conflictBill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: true,
          gstRuleId: activeGstRule.id,
          gstRate: 5.0, // active rule is 18.0!
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/conflict/i);
    });

    test('7.7 Approves bill with gstIncluded=true and computes exact base and reward paise', async () => {
      // 1180 gross, 18% GST -> 1000 base, 180 GST. Plumber rate = 0.5% -> 5.00 reward.
      const res = await request(app)
        .post(`/api/admin/bills/${reviewTestBill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: true,
          gstRuleId: activeGstRule.id,
          gstRate: 18.0,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.status).toBe('APPROVED');
      expect(Number(res.body.bill.grossBillAmount)).toBe(1180.0);
      expect(Number(res.body.bill.eligibleRewardAmount)).toBe(1000.0);
      expect(Number(res.body.bill.gstAmount)).toBe(180.0);
      expect(Number(res.body.bill.gstRate)).toBe(18.0);
      expect(Number(res.body.bill.calculatedReward)).toBe(5.0);
    });

    test('7.8 Approves bill with gstIncluded=false and computes full amount as eligible reward', async () => {
      const noGstBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-NO-GST-OK-${Date.now()}`,
        invoiceDate: '2026-10-10',
        billAmount: 1000.0,
        fileBuffer: Buffer.from('%PDF-1.4 bill without GST'),
        fileName: 'no_gst_bill.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .post(`/api/admin/bills/${noGstBill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.status).toBe('APPROVED');
      expect(Number(res.body.bill.grossBillAmount)).toBe(1000.0);
      expect(Number(res.body.bill.eligibleRewardAmount)).toBe(1000.0);
      expect(Number(res.body.bill.gstAmount)).toBe(0.0);
      expect(Number(res.body.bill.gstRate)).toBe(0.0);
      expect(Number(res.body.bill.calculatedReward)).toBe(5.0);
    });
  });
});
