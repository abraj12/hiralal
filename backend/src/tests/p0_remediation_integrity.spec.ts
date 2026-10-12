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

    // Find or create Admin User with BILL_ADMIN role
    const existingBillAdmin = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (existingBillAdmin) {
      adminUser = existingBillAdmin;
    } else {
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
    }

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

  describe('1b. GstService.getApplicableGstRules Invoice Date Boundary Integrity', () => {
    let exactBoundaryRule: any;
    let expiredBoundaryRule: any;
    let futureRule: any;
    let inactiveRule: any;

    beforeAll(async () => {
      exactBoundaryRule = await prisma.gstRule.create({
        data: {
          description: 'TEST_EXACT_BOUNDARY_RULE',
          ratePercentage: 18.0,
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
          effectiveUntil: new Date('2026-07-01T00:00:00.000Z'),
          isActive: true,
          createdByAdminId: adminUser.id,
        },
      });

      expiredBoundaryRule = await prisma.gstRule.create({
        data: {
          description: 'TEST_EXPIRED_BOUNDARY_RULE',
          ratePercentage: 12.0,
          effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
          effectiveUntil: new Date('2026-06-01T00:00:00.000Z'),
          isActive: true,
          createdByAdminId: adminUser.id,
        },
      });

      futureRule = await prisma.gstRule.create({
        data: {
          description: 'TEST_FUTURE_RULE',
          ratePercentage: 5.0,
          effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
          isActive: true,
          createdByAdminId: adminUser.id,
        },
      });

      inactiveRule = await prisma.gstRule.create({
        data: {
          description: 'TEST_INACTIVE_RULE',
          ratePercentage: 28.0,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          isActive: false,
          createdByAdminId: adminUser.id,
        },
      });
    });

    afterAll(async () => {
      await prisma.gstRule.deleteMany({
        where: {
          id: {
            in: [
              exactBoundaryRule.id,
              expiredBoundaryRule.id,
              futureRule.id,
              inactiveRule.id,
            ],
          },
        },
      });
    });

    test('includes rule when invoiceDate matches effectiveFrom exactly', async () => {
      const applicable = await GstService.getApplicableGstRules(new Date('2026-06-01T00:00:00.000Z'));
      const ids = applicable.map((r) => r.id);
      expect(ids).toContain(exactBoundaryRule.id);
    });

    test('excludes rule when invoiceDate matches effectiveUntil exactly (exclusive bound)', async () => {
      const applicable = await GstService.getApplicableGstRules(new Date('2026-06-01T00:00:00.000Z'));
      const ids = applicable.map((r) => r.id);
      expect(ids).not.toContain(expiredBoundaryRule.id);
    });

    test('excludes future rules whose effectiveFrom is after invoiceDate', async () => {
      const applicable = await GstService.getApplicableGstRules(new Date('2026-06-15T00:00:00.000Z'));
      const ids = applicable.map((r) => r.id);
      expect(ids).not.toContain(futureRule.id);
    });

    test('excludes rules where isActive is false', async () => {
      const applicable = await GstService.getApplicableGstRules(new Date('2026-06-15T00:00:00.000Z'));
      const ids = applicable.map((r) => r.id);
      expect(ids).not.toContain(inactiveRule.id);
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
      expect(res.body.message).toMatch(/A valid configured GST rule must be selected when GST is included/i);
    });

    test('3.3b Rejects manual GST override attempt without configured gstRuleId with 400', async () => {
      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: true,
          gstRate: 12.0,
          gstOverrideReason: 'Attempt manual override',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('GST_RULE_REQUIRED');
      expect(res.body.message).toMatch(/valid configured GST rule must be selected/i);
    });

    test('3.3c Approves with configured gstRuleId when GST is included', async () => {
      const activeRule = await prisma.gstRule.findFirst({
        where: { isActive: true },
      });
      expect(activeRule).toBeDefined();

      const res = await request(app)
        .post(`/api/admin/bills/${testBill.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          gstIncluded: true,
          gstRuleId: activeRule!.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Number(res.body.bill.gstRate)).toBe(Number(activeRule!.ratePercentage));
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

  describe('4. Full-Balance Redemption & Complete Elimination of Min/Max Caps', () => {
    beforeAll(async () => {
      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: { isEnabled: true, minimumRedemptionAmount: 0.01, startAt: null, endAt: null },
        create: { id: 'default', isEnabled: true, minimumRedemptionAmount: 0.01, startAt: null, endAt: null },
      });
    });

    test('4.1 Worker with ₹100 eligible balance can request redemption of ₹100 without being blocked (below former ₹500 min)', async () => {
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
      expect(eligibility).not.toHaveProperty('minimumAmount');
      expect(eligibility).not.toHaveProperty('maximumAmount');

      // Request redemption
      const result = await PayoutService.requestRedemption(plumberUser.id, `p0-idemp-100-${Date.now()}`);
      expect(result.amountDebited).toBe(100.0);
      expect(result.payout.status).toBe('PENDING');
      expect(Number(result.payout.amount)).toBe(100.0);

      // Check wallet state after full-balance debit
      const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(wallet?.availableBalance)).toBe(0.0);
      expect(Number(wallet?.processingAmount)).toBe(100.0);
    });

    test('4.2 Worker with ₹25,000 eligible balance can request redemption of ₹25,000 (above former ₹10,000 max)', async () => {
      // Clear pending payouts and set wallet balance to ₹25,000
      await prisma.payout.deleteMany({ where: { userId: plumberUser.id } });
      await prisma.wallet.update({
        where: { userId: plumberUser.id },
        data: { availableBalance: 25000.0, processingAmount: 0.0 },
      });

      const eligibility = await PayoutService.checkUserEligibility(plumberUser.id);
      expect(eligibility.canRedeem).toBe(true);
      expect(eligibility.availableBalance).toBe(25000.0);

      const result = await PayoutService.requestRedemption(plumberUser.id, `p0-idemp-25k-${Date.now()}`);
      expect(result.amountDebited).toBe(25000.0);
      expect(Number(result.payout.amount)).toBe(25000.0);

      const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(wallet?.availableBalance)).toBe(0.0);
      expect(Number(wallet?.processingAmount)).toBe(25000.0);
    });

    test('4.3 Worker with ₹0.01 eligible balance can request redemption of ₹0.01 (exact fractional balance)', async () => {
      // Clear pending payouts and set wallet balance to ₹0.01
      await prisma.payout.deleteMany({ where: { userId: plumberUser.id } });
      await prisma.wallet.update({
        where: { userId: plumberUser.id },
        data: { availableBalance: 0.01, processingAmount: 0.0 },
      });

      const eligibility = await PayoutService.checkUserEligibility(plumberUser.id);
      expect(eligibility.canRedeem).toBe(true);
      expect(eligibility.availableBalance).toBe(0.01);

      const result = await PayoutService.requestRedemption(plumberUser.id, `p0-idemp-1paise-${Date.now()}`);
      expect(result.amountDebited).toBe(0.01);
      expect(Number(result.payout.amount)).toBe(0.01);

      const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUser.id } });
      expect(Number(wallet?.availableBalance)).toBe(0.0);
      expect(Number(wallet?.processingAmount)).toBe(0.01);
    });

    test('4.4 Worker with ₹0 balance cannot request redemption', async () => {
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

    test('4.5 Database and service contract: RedemptionSettings and RewardRule have no obsolete amount limits', async () => {
      const redemptionSettings = await PayoutService.getRedemptionSettings();
      expect(redemptionSettings).toBeDefined();
      expect(redemptionSettings).not.toHaveProperty('minimumAmount');
      expect(redemptionSettings).not.toHaveProperty('maximumAmount');

      const rules = await RewardRuleService.listRules('PLUMBER');
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule).not.toHaveProperty('minRedemptionAmount');
        expect(rule).not.toHaveProperty('maxRedemptionAmount');
      }
    });
  });
});
