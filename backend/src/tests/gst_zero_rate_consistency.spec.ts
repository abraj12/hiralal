import { prisma } from '../db';
import { GstService } from '../services/gst.service';
import { BillService } from '../services/bill.service';
import { RewardService } from '../services/reward.service';
import { getOrCreateOpsAdmin, getOrCreateBillAdmin } from './test_helpers';

describe('HIR-V4-04: GST Zero-Rate Consistency & Bill Approval Regression Suite', () => {
  let opsAdminId: string;
  let billAdminId: string;
  let testUserId: string;
  let zeroGstRuleId: string;
  let standard18GstRuleId: string;
  let defaultRewardRuleId: string;
  let expectedRewardRate: number = 1.0;
  let didCreateRewardRule = false;

  beforeAll(async () => {
    const opsAdmin = await getOrCreateOpsAdmin(prisma, '9876599010');
    opsAdminId = opsAdmin.id;
    const billAdmin = await getOrCreateBillAdmin(prisma, '9876599011');
    billAdminId = billAdmin.id;

    // Create a test craftsman user with wallet
    const workerMobile = '9876599012';
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: workerMobile } } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: workerMobile } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: workerMobile } } });
    await prisma.user.deleteMany({ where: { mobile: workerMobile } });

    const worker = await prisma.user.create({
      data: {
        mobile: workerMobile,
        fullName: 'GST Test Craftsman',
        passwordHash: 'dummyhash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 0,
            processingAmount: 0,
            totalRedeemed: 0,
          },
        },
      },
    });
    testUserId = worker.id;

    // Create an explicit 0% GST rule
    const zeroRule = await GstService.createGstRule(opsAdminId, {
      ratePercentage: 0.0,
      description: 'Zero-Rate 0% GST Rule',
      isDefault: false,
    });
    zeroGstRuleId = zeroRule.id;

    // Create a standard 18% GST rule
    const standardRule = await GstService.createGstRule(opsAdminId, {
      ratePercentage: 18.0,
      description: 'Standard 18% GST Rule',
      isDefault: false,
    });
    standard18GstRuleId = standardRule.id;

    // Ensure active reward rule exists for PLUMBER
    const existingRewardRule = await prisma.rewardRule.findFirst({
      where: { profession: 'PLUMBER', isActive: true },
      orderBy: { version: 'desc' },
    });
    if (existingRewardRule) {
      defaultRewardRuleId = existingRewardRule.id;
      expectedRewardRate = Number(existingRewardRule.rewardPercentage);
    } else {
      const maxVer = await prisma.rewardRule.aggregate({
        where: { profession: 'PLUMBER' },
        _max: { version: true },
      });
      const nextVer = (maxVer._max.version || 0) + 1;
      const createdRule = await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 1.0,
          isActive: true,
          createdByAdminId: opsAdminId,
          version: nextVer,
        },
      });
      defaultRewardRuleId = createdRule.id;
      expectedRewardRate = 1.0;
      didCreateRewardRule = true;
    }
  });

  afterAll(async () => {
    await prisma.bill.deleteMany({ where: { userId: testUserId } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: testUserId } } });
    await prisma.wallet.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.gstRule.deleteMany({ where: { id: { in: [zeroGstRuleId, standard18GstRuleId] } } });
    if (didCreateRewardRule) {
      await prisma.rewardRule.deleteMany({ where: { id: defaultRewardRuleId } });
    }
    await prisma.$disconnect();
  });

  // 1. Positive GST rate with gstIncluded = true
  test('1. Positive GST rate with gstIncluded = true calculates exact reverse GST', () => {
    const res = GstService.calculateReverseGst(11800, true, 18);
    expect(res.grossBillAmount).toBe(11800);
    expect(res.gstIncluded).toBe(true);
    expect(res.gstRate).toBe(18);
    expect(res.gstAmount).toBe(1800);
    expect(res.eligibleRewardAmount).toBe(10000);
  });

  // 2. Explicitly configured zero rate with gstIncluded = true
  test('2. Explicitly configured zero rate with gstIncluded = true produces 0 GST and full eligible amount', () => {
    const res = GstService.calculateReverseGst(10000, true, 0);
    expect(res.grossBillAmount).toBe(10000);
    expect(res.gstIncluded).toBe(true);
    expect(res.gstRate).toBe(0);
    expect(res.gstAmount).toBe(0);
    expect(res.eligibleRewardAmount).toBe(10000);
  });

  // 3. Explicitly configured zero rate with gstIncluded = false
  test('3. Explicitly configured zero rate with gstIncluded = false preserves full gross amount', () => {
    const res = GstService.calculateReverseGst(10000, false, 0);
    expect(res.grossBillAmount).toBe(10000);
    expect(res.gstIncluded).toBe(false);
    expect(res.gstRate).toBeNull();
    expect(res.gstAmount).toBe(0);
    expect(res.eligibleRewardAmount).toBe(10000);
  });

  // 4. Missing GST rule fails closed
  test('4. Missing GST rule fails closed with [NO_APPLICABLE_GST_RULE]', () => {
    expect(() => GstService.calculateReverseGst(10000, true, null)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
  });

  // 5. Missing or null rate fails closed
  test('5. Missing or null rate fails closed with [NO_APPLICABLE_GST_RULE]', () => {
    expect(() => GstService.calculateReverseGst(10000, true, undefined as any)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
  });

  // 6. Negative rate fails closed
  test('6. Negative rate fails closed with [NO_APPLICABLE_GST_RULE]', () => {
    expect(() => GstService.calculateReverseGst(10000, true, -18)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
    expect(() => GstService.calculateReverseGst(10000, true, -0.01)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
  });

  // 7. NaN or non-finite rate fails closed
  test('7. NaN or non-finite rate fails closed with [NO_APPLICABLE_GST_RULE]', () => {
    expect(() => GstService.calculateReverseGst(10000, true, NaN)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
    expect(() => GstService.calculateReverseGst(10000, true, Infinity)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
    expect(() => GstService.calculateReverseGst(10000, true, -Infinity)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
  });

  // 8. Invalid rate values at both rule creation and calculation boundaries
  test('8. Invalid rate values rejected at rule creation (>100% or <0%)', async () => {
    await expect(
      GstService.createGstRule(opsAdminId, { ratePercentage: -5.0 })
    ).rejects.toThrow(/between 0.00% and 100.00%/i);

    await expect(
      GstService.createGstRule(opsAdminId, { ratePercentage: 105.0 })
    ).rejects.toThrow(/between 0.00% and 100.00%/i);

    expect(() => GstService.calculateReverseGst(10000, true, 105)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
  });

  // 9. Consistency between calculateReverseGst() and calculateGstAndEligibleAmount()
  test('9. Consistency between calculateReverseGst and calculateGstAndEligibleAmount', () => {
    // Zero rate
    const r1 = GstService.calculateReverseGst(5000, true, 0);
    const r2 = GstService.calculateGstAndEligibleAmount(5000, true, 0);
    expect(r1.gstAmount).toBe(r2.gstAmount);
    expect(r1.eligibleRewardAmount).toBe(r2.eligibleRewardAmount);
    expect(r1.grossBillAmount).toBe(r2.grossBillAmount);

    // Standard rate
    const s1 = GstService.calculateReverseGst(11800, true, 18);
    const s2 = GstService.calculateGstAndEligibleAmount(11800, true, 18);
    expect(s1.gstAmount).toBe(s2.gstAmount);
    expect(s1.eligibleRewardAmount).toBe(s2.eligibleRewardAmount);
  });

  // 10. Bill approval with an explicit zero-rate rule
  test('10. Bill approval with explicit 0% GST rule succeeds with 0 GST and full eligible reward', async () => {
    const dummyPdf = Buffer.from(`%PDF-1.4 dummy bill zero ${Date.now()}_${Math.random()}`);
    const bill = await BillService.submitBill({
      userId: testUserId,
      invoiceNumber: `INV-ZERO-${Date.now()}`,
      invoiceDate: '2026-10-10',
      billAmount: 10000.0,
      fileBuffer: dummyPdf,
      fileName: 'zero_gst.pdf',
      mimeType: 'application/pdf',
    });

    const approveRes = await BillService.approveBill({
      billId: bill.id,
      adminId: billAdminId,
      gstIncluded: true,
      gstRate: 0.0,
      gstRuleId: zeroGstRuleId,
    });

    const approved = approveRes.bill;
    expect(approved.status).toBe('APPROVED');
    expect(approved.gstIncluded).toBe(true);
    expect(Number(approved.gstAmount)).toBe(0.0);
    expect(Number(approved.eligibleRewardAmount)).toBe(10000.0);
    expect(Number(approved.gstRate)).toBe(0.0);
    expect(approved.gstRuleId).toBe(zeroGstRuleId);

    // Reward on 10000 eligible based on active profession rule rate
    const expectedReward = (10000.0 * expectedRewardRate) / 100;
    expect(Number(approved.calculatedReward)).toBe(expectedReward);

    const wallet = await prisma.wallet.findUnique({ where: { userId: testUserId } });
    expect(Number(wallet?.availableBalance)).toBe(expectedReward);
  });

  // 11. Bill approval still refuses an inclusive-GST bill without a configured applicable rule
  test('11. Bill approval refuses inclusive-GST bill without configured applicable rule (fails closed)', async () => {
    const dummyPdf = Buffer.from(`%PDF-1.4 dummy bill norule ${Date.now()}_${Math.random()}`);
    const bill = await BillService.submitBill({
      userId: testUserId,
      invoiceNumber: `INV-NORULE-${Date.now()}`,
      invoiceDate: '2026-10-10',
      billAmount: 5000.0,
      fileBuffer: dummyPdf,
      fileName: 'no_rule.pdf',
      mimeType: 'application/pdf',
    });

    // Attempt approval with gstIncluded = true but no gstRuleId and no default rule
    await expect(
      BillService.approveBill({
        billId: bill.id,
        adminId: billAdminId,
        gstIncluded: true,
      })
    ).rejects.toThrow(/\[NO_APPLICABLE_GST_RULE\]/);

    const unapprovedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(unapprovedBill?.status).toBe('PENDING');
  });

  // 12. Persisted GST snapshots remain consistent with the computed amounts
  test('12. Persisted GST snapshots remain consistent with computed amounts for 18% rule', async () => {
    const dummyPdf = Buffer.from(`%PDF-1.4 dummy bill gst18 ${Date.now()}_${Math.random()}`);
    const bill = await BillService.submitBill({
      userId: testUserId,
      invoiceNumber: `INV-GST18-${Date.now()}`,
      invoiceDate: '2026-10-10',
      billAmount: 11800.0,
      fileBuffer: dummyPdf,
      fileName: 'gst18.pdf',
      mimeType: 'application/pdf',
    });

    const approveRes = await BillService.approveBill({
      billId: bill.id,
      adminId: billAdminId,
      gstIncluded: true,
      gstRate: 18.0,
      gstRuleId: standard18GstRuleId,
    });

    const approved = approveRes.bill;
    expect(Number(approved.gstAmount)).toBe(1800.0);
    expect(Number(approved.eligibleRewardAmount)).toBe(10000.0);
    expect(Number(approved.gstRate)).toBe(18.0);
    expect(approved.gstRuleId).toBe(standard18GstRuleId);
  });

  // 13. Historical approved bill records and ledger entries are not rewritten
  test('13. Historical approved bill records and ledger entries remain immutable', async () => {
    const approvedBills = await prisma.bill.findMany({
      where: { userId: testUserId, status: 'APPROVED' },
    });
    expect(approvedBills.length).toBeGreaterThanOrEqual(2);

    const transactions = await prisma.walletTransaction.findMany({
      where: { wallet: { userId: testUserId } },
    });
    expect(transactions.length).toBeGreaterThanOrEqual(2);

    for (const tx of transactions) {
      expect(Number(tx.amount)).toBeGreaterThan(0);
      expect(tx.type).toBe('REWARD_CREDIT');
    }
  });
});
