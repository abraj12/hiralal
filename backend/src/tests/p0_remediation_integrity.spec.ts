import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { GstService } from '../services/gst.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { RewardRuleService } from '../services/reward-rule.service';
import { config } from '../config';
import jwt from 'jsonwebtoken';

describe('P0 Remediation & Financial Integrity Test Suite', () => {
  const adminMobile = '9876540011';
  const plumberMobile = '9876540012';
  const missingProfMobile = '9876540013';

  let adminUser: any;
  let plumberUser: any;
  let missingProfUser: any;
  let adminToken: string;
  let activeGstRule: any;
  let activeRewardRule: any;

  beforeAll(async () => {
    const mobiles = [adminMobile, plumberMobile, missingProfMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });

    // Create Admin User with BILL_ADMIN role
    adminUser = await prisma.user.create({
      data: {
        mobile: adminMobile,
        fullName: 'P0 Lead Admin',
        passwordHash: 'hash',
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    adminToken = jwt.sign(
      { userId: adminUser.id, role: adminUser.role },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    // Create Plumber User with wallet
    plumberUser = await prisma.user.create({
      data: {
        mobile: plumberMobile,
        fullName: 'Verified P0 Plumber',
        passwordHash: 'hash',
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 100.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
        kycRecords: {
          create: {
            panName: 'Verified P0 Plumber',
            maskedPan: 'ABCDE1234F',
            panStatus: 'VERIFIED',
            nameMatched: true,
          },
        },
        paymentAccounts: {
          create: {
            accountType: 'UPI',
            upiId: 'plumber@okhdfcbank',
            maskedInfo: 'plu****@okhdfcbank',
            providerRegisteredName: 'Verified P0 Plumber',
            providerNameVerified: true,
            isVerified: true,
            isDefault: true,
          },
        },
      },
      include: { wallet: true },
    });

    // Create User without profession
    missingProfUser = await prisma.user.create({
      data: {
        mobile: missingProfMobile,
        fullName: 'Worker Missing Profession',
        passwordHash: 'hash',
        role: 'USER',
        profession: null,
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 0.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    // Create active 18% GST Rule
    activeGstRule = await GstService.createGstRule(adminUser.id, {
      ratePercentage: 18.0,
      description: 'Standard 18% GST for Hardware',
      isDefault: true,
    });

    // Create active Plumber Reward Rule (0.50%)
    await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
    activeRewardRule = await RewardRuleService.createRule(adminUser.id, {
      profession: 'PLUMBER',
      rewardPercentage: 0.50,
      effectiveFrom: new Date('2026-01-01'),
    });
  });

  afterAll(async () => {
    const mobiles = [adminMobile, plumberMobile, missingProfMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
  });

  describe('1. GstService.calculateGstAndEligibleAmount Precision & Strict Typing', () => {
    test('1.1 Rejects non-boolean gstIncluded (e.g. string "true", "false", numbers, null)', () => {
      expect(() => GstService.calculateGstAndEligibleAmount(1000, 'true' as any)).toThrow(
        /GST selection must be a boolean/i
      );
      expect(() => GstService.calculateGstAndEligibleAmount(1000, 'false' as any)).toThrow(
        /GST selection must be a boolean/i
      );
      expect(() => GstService.calculateGstAndEligibleAmount(1000, 1 as any)).toThrow(
        /GST selection must be a boolean/i
      );
      expect(() => GstService.calculateGstAndEligibleAmount(1000, null as any)).toThrow(
        /GST selection must be a boolean/i
      );
    });

    test('1.2 Rejects invalid, negative or out-of-bounds GST rates', () => {
      expect(() => GstService.calculateGstAndEligibleAmount(1000, true, -5)).toThrow(
        /GST rate must be between 0% and 100%/i
      );
      expect(() => GstService.calculateGstAndEligibleAmount(1000, true, 105)).toThrow(
        /GST rate must be between 0% and 100%/i
      );
      expect(() => GstService.calculateGstAndEligibleAmount(1000, true, NaN)).toThrow(
        /GST rate must be between 0% and 100%/i
      );
    });

    test('1.3 Checkbox unchecked (gstIncluded: false): 0 GST deducted, 100% eligible', () => {
      const res = GstService.calculateGstAndEligibleAmount(10000.0, false);
      expect(res.gstIncluded).toBe(false);
      expect(res.gstRate).toBe(0.0);
      expect(res.gstAmount).toBe(0.0);
      expect(res.eligibleRewardAmount).toBe(10000.0);
    });

    test('1.4 Checkbox checked with 0% GST: preserves gstIncluded: true without deducting GST', () => {
      const res = GstService.calculateGstAndEligibleAmount(10000.0, true, 0.0);
      expect(res.gstIncluded).toBe(true);
      expect(res.gstRate).toBe(0.0);
      expect(res.gstAmount).toBe(0.0);
      expect(res.eligibleRewardAmount).toBe(10000.0);
    });

    test('1.5 Exact paise-level reverse GST calculations across standard rates', () => {
      // 18% standard rate: G = 1180.00 -> GST = 180.00, Eligible = 1000.00
      const res18 = GstService.calculateGstAndEligibleAmount(1180.0, true, 18.0);
      expect(res18.gstAmount).toBe(180.0);
      expect(res18.eligibleRewardAmount).toBe(1000.0);

      // 18% with non-clean paise: G = 1000.00 -> GST = round(1000 * 18 / 118) = 152.54, Eligible = 847.46
      const res18Odd = GstService.calculateGstAndEligibleAmount(1000.0, true, 18.0);
      expect(res18Odd.gstAmount).toBe(152.54);
      expect(res18Odd.eligibleRewardAmount).toBe(847.46);

      // 5% rate: G = 1050.00 -> GST = 50.00, Eligible = 1000.00
      const res5 = GstService.calculateGstAndEligibleAmount(1050.0, true, 5.0);
      expect(res5.gstAmount).toBe(50.0);
      expect(res5.eligibleRewardAmount).toBe(1000.0);

      // 12% rate: G = 1120.00 -> GST = 120.00, Eligible = 1000.00
      const res12 = GstService.calculateGstAndEligibleAmount(1120.0, true, 12.0);
      expect(res12.gstAmount).toBe(120.0);
      expect(res12.eligibleRewardAmount).toBe(1000.0);

      // 28% rate: G = 1280.00 -> GST = 280.00, Eligible = 1000.00
      const res28 = GstService.calculateGstAndEligibleAmount(1280.0, true, 28.0);
      expect(res28.gstAmount).toBe(280.0);
      expect(res28.eligibleRewardAmount).toBe(1000.0);
    });
  });

  describe('2. BillService Fail-Closed on Missing Profession', () => {
    test('2.1 Throws error when approving bill for worker with missing profession', async () => {
      const bill = await BillService.submitBill({
        userId: missingProfUser.id,
        invoiceNumber: `INV-NOPROF-${Date.now()}-${Math.random()}`,
        invoiceDate: '2026-10-10',
        billAmount: 5000.0,
        fileBuffer: Buffer.from(`%PDF-1.4 dummy bill content ${Date.now()}-${Math.random()}`),
        fileName: 'noprof.pdf',
        mimeType: 'application/pdf',
      });

      await expect(
        BillService.approveBill({
          billId: bill.id,
          adminId: adminUser.id,
          gstIncluded: false,
        })
      ).rejects.toThrow(/no registered profession/i);
    });
  });

  describe('3. Admin Verify Bill HTTP Endpoint Validations', () => {
    let testBill: any;

    beforeEach(async () => {
      testBill = await BillService.submitBill({
        userId: plumberUser.id,
        invoiceNumber: `INV-ADMIN-VERIFY-${Date.now()}-${Math.random()}`,
        invoiceDate: '2026-10-10',
        billAmount: 2000.0,
        fileBuffer: Buffer.from(`%PDF-1.4 dummy bill content ${Date.now()}-${Math.random()}`),
        fileName: 'testbill.pdf',
        mimeType: 'application/pdf',
      });
    });

    test('3.1 Rejects non-boolean gstIncluded with 400', async () => {
      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: 'true', // string instead of boolean
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/GST selection must be a boolean/i);
    });

    test('3.2 Rejects REJECT action without rejectionReason with 400', async () => {
      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'REJECT',
          rejectionReason: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Rejection reason is required/i);
    });

    test('3.3 Rejects manual GST override without gstRuleId and without override reason with 400', async () => {
      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: true,
          gstRate: 12.0,
          // no gstRuleId and no gstOverrideReason
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/A reason is required for a manual GST rate override/i);
    });

    test('3.4 Approves with gstIncluded: false and credits reward on full bill amount', async () => {
      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.gstIncluded).toBe(false);
      expect(Number(res.body.bill.gstAmount)).toBe(0.0);
      expect(Number(res.body.bill.eligibleRewardAmount)).toBe(2000.0);
      // 0.50% of 2000 = 10.00
      expect(Number(res.body.bill.calculatedReward)).toBe(10.0);
    });
  });

  describe('4. Full-Balance Redemption & Elimination of Minimum Threshold', () => {
    test('4.1 Worker with ₹100 eligible balance can request redemption of ₹100 without being blocked', async () => {
      // Ensure wallet balance is ₹100
      await prisma.wallet.update({
        where: { userId: plumberUser.id },
        data: { availableBalance: 100.0, processingAmount: 0.0 },
      });

      // Clear any pending payouts
      await prisma.payout.deleteMany({ where: { userId: plumberUser.id } });

      // Check eligibility
      const eligibility = await PayoutService.checkUserEligibility(plumberUser.id);
      expect(eligibility.canRedeem).toBe(true);
      expect(eligibility.availableBalance).toBe(100.0);

      // Request redemption
      const result = await PayoutService.requestRedemption(plumberUser.id, `p0-idemp-${Date.now()}`);
      expect(result.amountDebited).toBe(100.0);
      expect(result.payout.status).toBe('PENDING');
      expect(Number(result.payout.amount)).toBe(100.0);

      // Check wallet state after full-balance debit
      const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(wallet?.availableBalance)).toBe(0.0);
      expect(Number(wallet?.processingAmount)).toBe(100.0);
    });

    test('4.2 Worker with ₹0 balance cannot request redemption', async () => {
      // Clear any pending payouts
      await prisma.payout.deleteMany({ where: { userId: plumberUser.id } });

      await prisma.wallet.update({
        where: { userId: plumberUser.id },
        data: { availableBalance: 0.0, processingAmount: 0.0 },
      });

      const eligibility = await PayoutService.checkUserEligibility(plumberUser.id);
      expect(eligibility.canRedeem).toBe(false);
      expect(eligibility.reason).toContain('No balance available');

      await expect(
        PayoutService.requestRedemption(plumberUser.id, `p0-zero-${Date.now()}`)
      ).rejects.toThrow(/No balance available for redemption/i);
    });
  });
});
