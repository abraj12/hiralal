import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { AccountDeletionService } from '../services/account-deletion.service';
import { AuthService } from '../services/auth.service';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

describe('Immutable Invoices, Deviations, Legal Holds & Financial Integrity Suite', () => {
  const testBillAdminMobile = '9999900001';
  const testOpsAdminMobile = '9999900002';
  const testCraftsmanMobile = '9999900003';

  let billAdmin: any;
  let opsAdmin: any;
  let craftsman: any;
  let billAdminToken: string;
  let opsAdminToken: string;
  let craftsmanToken: string;
  let activeGstRule: any;
  let activeRewardRule: any;
  let craftsmanPaymentAccount: any;

  beforeAll(async () => {
    const mobiles = [testBillAdminMobile, testOpsAdminMobile, testCraftsmanMobile];
    await prisma.notificationCampaign.deleteMany({ where: { createdByAdmin: { mobile: { in: mobiles } } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.accountDeletionOperation.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: testCraftsmanMobile } });

    // 1. Create or load Bill Admin
    billAdmin = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (!billAdmin) {
      billAdmin = await prisma.user.create({
        data: {
          mobile: testBillAdminMobile,
          fullName: 'Test Bill Admin',
          passwordHash: await bcrypt.hash('SecureAdminPass1!', 10),
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    // 2. Create or load Operations Admin
    opsAdmin = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (!opsAdmin) {
      opsAdmin = await prisma.user.create({
        data: {
          mobile: testOpsAdminMobile,
          fullName: 'Test Ops Admin',
          passwordHash: await bcrypt.hash('SecureOpsPass1!', 10),
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    // 3. Create Craftsman User
    craftsman = await prisma.user.create({
      data: {
        mobile: testCraftsmanMobile,
        fullName: 'Test Plumber Craftsman',
        passwordHash: await bcrypt.hash('CraftsmanPass1!', 10),
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    await prisma.wallet.create({
      data: {
        userId: craftsman.id,
        availableBalance: 0,
        processingAmount: 0,
        totalRedeemed: 0,
      },
    });

    craftsmanPaymentAccount = await prisma.paymentAccount.create({
      data: {
        userId: craftsman.id,
        accountType: 'UPI',
        maskedInfo: 'craftsman@upi',
        isVerified: true,
        isDefault: true,
      },
    });

    billAdminToken = jwt.sign(
      { userId: billAdmin.id, role: billAdmin.role },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    opsAdminToken = jwt.sign(
      { userId: opsAdmin.id, role: opsAdmin.role },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    craftsmanToken = jwt.sign(
      { userId: craftsman.id, role: craftsman.role },
      config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    // Active GST rule
    activeGstRule = await prisma.gstRule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!activeGstRule) {
      activeGstRule = await prisma.gstRule.create({
        data: {
          ratePercentage: 18.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          description: 'Standard 18% GST',
        },
      });
    }

    // Active Reward rule
    activeRewardRule = await prisma.rewardRule.findFirst({
      where: { profession: 'PLUMBER', isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!activeRewardRule) {
      activeRewardRule = await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 5.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          version: 99,
        },
      });
    }
  });

  afterAll(async () => {
    const mobiles = [testBillAdminMobile, testOpsAdminMobile, testCraftsmanMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.accountDeletionOperation.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: testCraftsmanMobile } });
  });

  // 1. IMMUTABLE INVOICES
  describe('Rule 1: Immutable Invoice Submissions & Admin Tampering Defense', () => {
    it('should submit a bill with immutable gross amount and revision 1', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4\n%test invoice stream buffer\n%%EOF');
      const bill = await BillService.submitBill({
        userId: craftsman.id,
        invoiceNumber: 'INV-IMMUTABLE-001',
        invoiceDate: '2026-10-20',
        billAmount: 10000,
        fileBuffer: dummyBuffer,
        fileName: 'invoice1.pdf',
        mimeType: 'application/pdf',
      });

      expect(bill).toBeDefined();
      expect(bill.revisionNumber).toBe(1);
      expect(Number(bill.billAmount)).toBe(10000);
      expect(Number(bill.grossBillAmount)).toBe(10000);
      expect(bill.requiresSecondaryApproval).toBe(false);
      expect(bill.status).toBe('PENDING');
    });

    it('should reject API approval request if administrator attempts to send correctedGrossAmount', async () => {
      const existing = await prisma.bill.findFirst({
        where: { userId: craftsman.id, invoiceNumber: 'INV-IMMUTABLE-001' },
      });

      const res = await request(app)
        .post(`/api/v1/admin/bills/${existing!.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
          merchantName: `Test Merchant ${Math.random().toString(36).slice(2)}`,
          gstIncluded: false,
          correctedGrossAmount: 15000, // Tampering attempt
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IMMUTABLE_INVOICE_VIOLATION');
    });

    it('should calculate reward strictly using submitted amount on normal Bill Admin approval', async () => {
      const existing = await prisma.bill.findFirst({
        where: { userId: craftsman.id, invoiceNumber: 'INV-IMMUTABLE-001' },
      });

      const res = await request(app)
        .post(`/api/v1/admin/bills/${existing!.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'APPROVE',
          merchantName: `Test Merchant ${Math.random().toString(36).slice(2)}`,
          gstIncluded: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.status).toBe('APPROVED');
      // Reward on 10,000 at active rule percentage (e.g. 0.55% = 55)
      const expectedReward = (10000 * Number(activeRewardRule.rewardPercentage)) / 100;
      expect(Number(res.body.rewardCredited)).toBe(expectedReward);
    });
  });

  // 2. REVISIONS & 25% UPWARD DEVIATION ESCALATION
  describe('Rule 2: Revision Workflow & Secondary Review Escalation', () => {
    let rejectedBill: any;

    it('should reject a bill when rejection reason is provided', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4\n%invoice to reject\n%%EOF');
      const bill = await BillService.submitBill({
        userId: craftsman.id,
        invoiceNumber: 'INV-REVISION-002',
        invoiceDate: '2026-10-21',
        billAmount: 4000,
        fileBuffer: dummyBuffer,
        fileName: 'invoice2.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .post(`/api/v1/admin/bills/${bill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'REJECT',
          rejectionReason: 'Blurry invoice total and dealer stamp',
        });

      expect(res.status).toBe(200);
      expect(res.body.bill.status).toBe('REJECTED');
      expect(res.body.bill.rejectionReason).toBe('Blurry invoice total and dealer stamp');
      rejectedBill = res.body.bill;
    });

    it('should allow submitter to resubmit rejected invoice as a linked revision', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4\n%corrected resubmission buffer\n%%EOF');
      // Resubmit at 4,500 (+12.5%, within 25% threshold)
      const revision = await BillService.submitBill({
        userId: craftsman.id,
        invoiceNumber: 'INV-REVISION-002',
        invoiceDate: '2026-10-21',
        billAmount: 4500,
        fileBuffer: dummyBuffer,
        fileName: 'invoice2_resubmitted.pdf',
        mimeType: 'application/pdf',
        parentBillId: rejectedBill.id,
      });

      expect(revision.revisionNumber).toBe(2);
      expect(revision.parentBillId).toBe(rejectedBill.id);
      expect(revision.requiresSecondaryApproval).toBe(false);
      expect(revision.status).toBe('PENDING');

      // Reject revision 2 so we can test >25% deviation on revision 3
      await BillService.rejectBill(revision.id, billAdmin.id, 'Need clearer tax summary');
    });

    it('should flag requiresSecondaryApproval=true and status=UNDER_REVIEW if revision exceeds 25%', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4\n%high deviation buffer\n%%EOF');
      // Previous amount was 4,500. Resubmit at 6,000 (>33% increase)
      const highDevRevision = await BillService.submitBill({
        userId: craftsman.id,
        invoiceNumber: 'INV-REVISION-002',
        invoiceDate: '2026-10-21',
        billAmount: 6000,
        fileBuffer: dummyBuffer,
        fileName: 'invoice2_rev3.pdf',
        mimeType: 'application/pdf',
      });

      expect(highDevRevision.revisionNumber).toBe(3);
      expect(highDevRevision.requiresSecondaryApproval).toBe(true);
      expect(highDevRevision.status).toBe('UNDER_REVIEW');

      const merchantName = `Test Merchant ${Math.random().toString(36).slice(2)}`;

      // HIR-M-02: OPERATIONS_ADMIN cannot approve before BILL_ADMIN primary verification
      const prematureOpsRes = await request(app)
        .post(`/api/v1/admin/bills/${highDevRevision.id}/verify`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ action: 'APPROVE', merchantName, gstIncluded: false });

      expect(prematureOpsRes.status).toBe(409);
      expect(prematureOpsRes.body.code).toBe('PRIMARY_VERIFICATION_REQUIRED');

      // BILL_ADMIN "approve" records primary verification only — no reward credited
      const billAdminRes = await request(app)
        .post(`/api/v1/admin/bills/${highDevRevision.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ action: 'APPROVE', merchantName, gstIncluded: false });

      expect(billAdminRes.status).toBe(200);
      expect(billAdminRes.body.primaryVerified).toBe(true);
      expect(billAdminRes.body.bill.status).toBe('UNDER_REVIEW');
      expect(billAdminRes.body.bill.verifiedByAdminId).toBe(billAdmin.id);

      // A second BILL_ADMIN attempt cannot approve the bill itself
      const repeatBillAdminRes = await request(app)
        .post(`/api/v1/admin/bills/${highDevRevision.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ action: 'APPROVE', merchantName, gstIncluded: false });

      expect(repeatBillAdminRes.status).toBe(409);
      expect(repeatBillAdminRes.body.code).toBe('AWAITING_SECONDARY_APPROVAL');

      // OPERATIONS_ADMIN can now approve the revision
      const opsAdminRes = await request(app)
        .post(`/api/v1/admin/bills/${highDevRevision.id}/verify`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ action: 'APPROVE', merchantName, gstIncluded: false });

      expect(opsAdminRes.status).toBe(200);
      expect(opsAdminRes.body.bill.status).toBe('APPROVED');
      expect(opsAdminRes.body.bill.secondaryApprovedByAdminId).toBe(opsAdmin.id);
    });
  });

  // 3. BILL CANCELLATION
  describe('Rule 3: Bill Cancellation Workflow', () => {
    it('should cancel a bill with mandatory cancellation reason', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4\n%fraudulent invoice\n%%EOF');
      const bill = await BillService.submitBill({
        userId: craftsman.id,
        invoiceNumber: 'INV-FRAUD-003',
        invoiceDate: '2026-10-20',
        billAmount: 7500,
        fileBuffer: dummyBuffer,
        fileName: 'fake_invoice.pdf',
        mimeType: 'application/pdf',
      });

      const res = await request(app)
        .post(`/api/v1/admin/bills/${bill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          action: 'CANCEL',
          cancellationReason: 'Confirmed counterfeit dealer invoice and fabricated GSTIN stamp',
        });

      expect(res.status).toBe(200);
      expect(res.body.bill.status).toBe('CANCELLED');
      expect(res.body.bill.cancellationReason).toBe(
        'Confirmed counterfeit dealer invoice and fabricated GSTIN stamp'
      );
    });
  });

  // 4. LEGAL HOLD ENFORCEMENT (SEC-LEGALHOLD-01)
  describe('Rule 4: Legal Hold Compliance on Account Deletion', () => {
    let legalHoldUser: any;

    beforeAll(async () => {
      legalHoldUser = await prisma.user.create({
        data: {
          mobile: '9999900009',
          fullName: 'Legal Hold Subject',
          passwordHash: await bcrypt.hash('HoldPass123!', 10),
          role: 'USER',
          status: 'ACTIVE',
          legalHold: true, // Under statutory legal hold
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { mobile: '9999900009' } });
    });

    it('should reject requestDeletion when user has legalHold=true', async () => {
      await expect(
        AccountDeletionService.requestDeletion(legalHoldUser.id, 'HoldPass123!')
      ).rejects.toThrow(/legal hold/i);
    });

    it('should reject confirmDeletion when user has legalHold=true', async () => {
      await expect(
        AccountDeletionService.confirmDeletion(legalHoldUser.id, '123456')
      ).rejects.toThrow(/legal hold/i);
    });
  });

  // 5. TIER-1 ADMIN PREFIX GATE (ADV-01)
  describe('Rule 5: Tier-1 Admin Prefix Protection on /login', () => {
    it('should immediately return HTTP 403 ADMIN_TIER_REQUIRED when admin identifier hits craftsman /login', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          identifier: `${config.admin.billAdminPrefix}9876540011`,
          password: 'SomePassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ADMIN_TIER_REQUIRED');
    });
  });

  // 6. GATEWAY TIMEOUT AMBIGUITY (VULN-FIN-01)
  describe('Rule 6: Payout Gateway Ambiguity Protection', () => {
    it('should not refund reserved points when gateway status check fails with network error', async () => {
      // Mock queryGatewayByReference to return error
      const originalQuery = PayoutService.queryGatewayByReference;
      (PayoutService as any).queryGatewayByReference = jest.fn().mockResolvedValue({
        found: false,
        error: true,
        timeout: true,
        message: 'Gateway connection timed out (ETIMEDOUT)',
      });

      // Create test payout in IN_FLIGHT
      const wallet = await prisma.wallet.findUnique({ where: { userId: craftsman.id } });
      await prisma.wallet.update({
        where: { id: wallet!.id },
        data: { availableBalance: 1000, processingAmount: 1000 },
      });

      const payout = await prisma.payout.create({
        data: {
          userId: craftsman.id,
          walletId: wallet!.id,
          paymentAccountId: craftsmanPaymentAccount.id,
          amount: 1000,
          paymentType: 'UPI',
          status: 'PAYOUT_INITIATED',
          idempotencyKey: 'test-idem-' + Date.now(),
        },
      });

      await expect(
        PayoutService.rejectRedemption(payout.id, opsAdmin.id, 'Redemption rejected')
      ).rejects.toThrow(/payment gateway query failed/i);

      // Verify wallet processingAmount was NOT refunded
      const walletAfter = await prisma.wallet.findUnique({ where: { id: wallet!.id } });
      expect(Number(walletAfter!.processingAmount)).toBe(1000);

      // Cleanup
      await prisma.payout.delete({ where: { id: payout.id } });
      (PayoutService as any).queryGatewayByReference = originalQuery;
    });
  });
});
