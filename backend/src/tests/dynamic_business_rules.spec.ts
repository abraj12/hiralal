import { RewardRuleService } from '../services/reward-rule.service';
import { GstService } from '../services/gst.service';
import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { prisma } from '../db';
import crypto from 'crypto';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('Dynamic Business Rules, Profession Separation & GST Calculation Tests', () => {
  let plumberUserId: string;
  let tileUserId: string;
  let adminUserId: string;
  let defaultGstRuleId: string;
  let gst12RuleId: string;
  let gst0RuleId: string;

  const createDummyPdfBuffer = (label: string) => {
    return Buffer.concat([
      Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
      Buffer.from(`Invoice document ${label} - ${crypto.randomBytes(16).toString('hex')}\n%%EOF`),
    ]);
  };

  beforeAll(async () => {
    // 1. Clean up test users and data
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9700000001', '9700000002'] } } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9700000001', '9700000002'] } },
    });

    // 2. Ensure Admin User
    const admin = await getOrCreateOpsAdmin(prisma);
    adminUserId = admin.id;

    // 3. Create Plumber User
    const plumber = await prisma.user.create({
      data: {
        mobile: '9700000001',
        fullName: 'Ramesh Plumber',
        passwordHash: 'plumberhash',
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
      include: { wallet: true },
    });
    plumberUserId = plumber.id;

    // 4. Create Tile Installer User
    const tile = await prisma.user.create({
      data: {
        mobile: '9700000002',
        fullName: 'Suresh Tile Worker',
        passwordHash: 'tilehash',
        profession: 'TILE_INSTALLER',
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
      include: { wallet: true },
    });
    tileUserId = tile.id;

    // 5. Setup GST Rules
    const gst18 = await GstService.createGstRule(adminUserId, {
      ratePercentage: 18.0,
      description: 'Standard 18% GST for hardware & tiles',
      isDefault: true,
      effectiveFrom: new Date('2026-01-01'),
    });
    defaultGstRuleId = gst18.id;

    const gst12 = await GstService.createGstRule(adminUserId, {
      ratePercentage: 12.0,
      description: 'Concessional 12% GST',
      isDefault: false,
      effectiveFrom: new Date('2026-01-01'),
    });
    gst12RuleId = gst12.id;

    const gst0 = await GstService.createGstRule(adminUserId, {
      ratePercentage: 0.0,
      description: 'Tax exempt goods',
      isDefault: false,
      effectiveFrom: new Date('2026-01-01'),
    });
    gst0RuleId = gst0.id;

    // 6. Setup Active Reward Rules
    await prisma.rewardRule.deleteMany({
      where: { profession: { in: ['PLUMBER', 'TILE_INSTALLER'] } },
    });

    await RewardRuleService.createRule(adminUserId, {
      profession: 'PLUMBER',
      rewardPercentage: 0.50,
      effectiveFrom: new Date('2026-10-01'),
    });

    await RewardRuleService.createRule(adminUserId, {
      profession: 'TILE_INSTALLER',
      rewardPercentage: 0.50,
      effectiveFrom: new Date('2026-10-01'),
    });
  });

  afterAll(async () => {
    await prisma.payout.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9700000001', '9700000002'] } } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9700000001', '9700000002'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9700000001', '9700000002'] } },
    });

    // Restore baseline rules
    await prisma.rewardRule.deleteMany({
      where: { profession: { in: ['PLUMBER', 'TILE_INSTALLER'] } },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
        isActive: true,
        version: 1,
      },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
        isActive: true,
        version: 1,
      },
    });

    await prisma.$disconnect();
  });

  // -------------------------------------------------------------
  // Test 1: Bill Without GST (GST Not Included)
  // -------------------------------------------------------------
  it('Scenario 1: Bill without GST: Eligible amount equals gross bill and reward is calculated accurately', async () => {
    const bill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-NOGST-${Date.now()}`,
      invoiceDate: '2026-10-01',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('nogst'),
      fileName: 'nogst.pdf',
      mimeType: 'application/pdf',
    });

    // Verification by admin: GST not included
    const res = await BillService.approveBill({
      billId: bill.id,
      adminId: adminUserId,
      gstIncluded: false,
    });
    const approved = res.bill;

    expect(approved.status).toBe('APPROVED');
    expect(Number(approved.grossBillAmount)).toBe(10000.0);
    expect(approved.gstIncluded).toBe(false);
    expect(Number(approved.gstAmount)).toBe(0.0);
    expect(Number(approved.eligibleRewardAmount)).toBe(10000.0);
    // 0.50% of 10000 = 50.00
    expect(Number(approved.calculatedReward)).toBe(50.0);
    expect(Number(approved.rewardRateSnapshot)).toBe(0.50);

    // Verify wallet credit
    const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUserId } });
    expect(Number(wallet?.availableBalance)).toBe(50.0);
  });

  // -------------------------------------------------------------
  // Test 2: Bill With 18% GST (GST Included Reverse Calculation)
  // -------------------------------------------------------------
  it('Scenario 2: Bill with 18% GST: Accurately strips GST component and awards reward on eligible base', async () => {
    const bill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-GST18-${Date.now()}`,
      invoiceDate: '2026-10-02',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('gst18'),
      fileName: 'gst18.pdf',
      mimeType: 'application/pdf',
    });

    // Admin approves with GST included at 18%
    const res = await BillService.approveBill({
      billId: bill.id,
      adminId: adminUserId,
      gstIncluded: true,
      gstRate: 18.0,
      gstRuleId: defaultGstRuleId,
    });
    const approved = res.bill;

    // Exact formulas:
    // GST = round(10000 * 18 / 118, 2) = 1525.42
    // Eligible = 10000 - 1525.42 = 8474.58
    // Reward (0.50%) = round(8474.58 * 0.005, 2) = 42.37
    expect(approved.status).toBe('APPROVED');
    expect(Number(approved.grossBillAmount)).toBe(10000.0);
    expect(approved.gstIncluded).toBe(true);
    expect(Number(approved.gstRate)).toBe(18.0);
    expect(Number(approved.gstAmount)).toBe(1525.42);
    expect(Number(approved.eligibleRewardAmount)).toBe(8474.58);
    expect(Number(approved.calculatedReward)).toBe(42.37);
    expect(Number(approved.rewardRateSnapshot)).toBe(0.50);

    // Wallet balance increased by 42.37 (50 + 42.37 = 92.37)
    const wallet = await prisma.wallet.findUnique({ where: { userId: plumberUserId } });
    expect(Number(wallet?.availableBalance)).toBe(92.37);
  });

  // -------------------------------------------------------------
  // Test 3: Concessional and Zero GST Treatments
  // -------------------------------------------------------------
  it('Scenario 3: Concessional 12% and 0% GST treatment calculations', async () => {
    // Math validation unit test via GstService
    const calc12 = GstService.calculateGstAndEligibleAmount(10000.0, true, 12.0);
    // GST = round(10000 * 12 / 112, 2) = 1071.43
    // Eligible = 8928.57
    expect(calc12.gstAmount).toBe(1071.43);
    expect(calc12.eligibleRewardAmount).toBe(8928.57);

    const calc0 = GstService.calculateGstAndEligibleAmount(10000.0, true, 0.0);
    expect(calc0.gstAmount).toBe(0.0);
    expect(calc0.eligibleRewardAmount).toBe(10000.0);

    const calcExcluded = GstService.calculateGstAndEligibleAmount(10000.0, false);
    expect(calcExcluded.gstAmount).toBe(0.0);
    expect(calcExcluded.eligibleRewardAmount).toBe(10000.0);
  });

  // -------------------------------------------------------------
  // Test 4: Profession Defaults: Plumber (0.50%) & Tile Installer (0.50%)
  // -------------------------------------------------------------
  it('Scenario 4: Profession Defaults: Tile installer and plumber both receive standard 0.50% default reward', async () => {
    // Submit bill for Tile Worker
    const bill = await BillService.submitBill({
      userId: tileUserId,
      invoiceNumber: `INV-TILE-${Date.now()}`,
      invoiceDate: '2026-10-03',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('tile'),
      fileName: 'tile.pdf',
      mimeType: 'application/pdf',
    });

    const res = await BillService.approveBill({
      billId: bill.id,
      adminId: adminUserId,
      gstIncluded: false,
    });
    const approved = res.bill;

    // 0.50% of 10000 = 50.00
    expect(Number(approved.calculatedReward)).toBe(50.0);
    expect(Number(approved.rewardRateSnapshot)).toBe(0.50);

    const wallet = await prisma.wallet.findUnique({ where: { userId: tileUserId } });
    expect(Number(wallet?.availableBalance)).toBe(50.0);
  });

  // -------------------------------------------------------------
  // Test 5: Changing Plumber Rule Does NOT Alter Tile Rule
  // -------------------------------------------------------------
  it('Scenario 5: Changing Plumber rate preserves Tile Installer rate independently', async () => {
    // Deploy updated plumber rule: 0.60%
    const newPlumberRule = await RewardRuleService.createRule(adminUserId, {
      profession: 'PLUMBER',
      rewardPercentage: 0.60,
      effectiveFrom: new Date('2026-10-04'),
    });

    expect(Number(newPlumberRule.rewardPercentage)).toBe(0.60);

    // Fetch applicable rule for Plumber and Tile Installer
    const activePlumberRule = await RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-10-04'));
    const activeTileRule = await RewardRuleService.getApplicableRule('TILE_INSTALLER', new Date('2026-10-04'));

    expect(Number(activePlumberRule.rewardPercentage)).toBe(0.60);
    expect(Number(activeTileRule.rewardPercentage)).toBe(0.50); // Tile rule unaffected at 0.50%
  });

  // -------------------------------------------------------------
  // Test 6: Financial Immutability across Rule Versions
  // -------------------------------------------------------------
  it('Scenario 6: Financial Immutability: Historical approved bills maintain their exact historical reward snapshot', async () => {
    // 1. Plumber submits bill under 0.60% rule
    const billV1 = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-IMMUTABLE-${Date.now()}`,
      invoiceDate: '2026-10-04',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('v1'),
      fileName: 'v1.pdf',
      mimeType: 'application/pdf',
    });

    const resV1 = await BillService.approveBill({
      billId: billV1.id,
      adminId: adminUserId,
      gstIncluded: false,
    });
    const approvedV1 = resV1.bill;
    expect(Number(approvedV1.calculatedReward)).toBe(60.0);
    expect(Number(approvedV1.rewardRateSnapshot)).toBe(0.60);

    // 2. Admin creates a new Plumber rule v3 with 1.25%
    await RewardRuleService.createRule(adminUserId, {
      profession: 'PLUMBER',
      rewardPercentage: 1.25,
      effectiveFrom: new Date('2026-10-05'),
    });

    // 3. Re-query past approved bill from database
    const pastBill = await prisma.bill.findUnique({ where: { id: billV1.id } });
    expect(Number(pastBill?.calculatedReward)).toBe(60.0); // UNCHANGED!
    expect(Number(pastBill?.rewardRateSnapshot)).toBe(0.60); // UNCHANGED!

    // 4. New bill approved under rule v3 receives 1.25%
    const billV2 = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-V2-${Date.now()}`,
      invoiceDate: '2026-10-05',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('v2'),
      fileName: 'v2.pdf',
      mimeType: 'application/pdf',
    });

    const resV2 = await BillService.approveBill({
      billId: billV2.id,
      adminId: adminUserId,
      gstIncluded: false,
    });
    const approvedV2 = resV2.bill;
    expect(Number(approvedV2.calculatedReward)).toBe(125.0);
    expect(Number(approvedV2.rewardRateSnapshot)).toBe(1.25);
  });

  // -------------------------------------------------------------
  // Test 7: Mobile API Response Masks Internal Reward Rate
  // -------------------------------------------------------------
  it('Scenario 7: Mobile worker bill submission and listing masks internal reward rate and provisional amounts', async () => {
    const bill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-MOBILE-MASK-${Date.now()}`,
      invoiceDate: '2026-10-06',
      billAmount: 25000.0,
      fileBuffer: createDummyPdfBuffer('mask'),
      fileName: 'mask.pdf',
      mimeType: 'application/pdf',
    });

    expect(bill.status).toBe('PENDING');
    // Mobile view of pending bill:
    const mobileBills = await BillService.getUserBills(plumberUserId);
    const pendingBill = mobileBills.find((b) => b.id === bill.id);

    expect(pendingBill).toBeDefined();
    expect(pendingBill?.status).toBe('PENDING');
    // Should NOT expose internal rate in user-facing model
    expect(Number(pendingBill?.billAmount)).toBe(25000.0);
    expect(pendingBill?.calculatedReward).toBeNull();
  });

  // -------------------------------------------------------------
  // Test 8: Pool Isolation & Budget Exhaustion Safety
  // -------------------------------------------------------------
  it('Scenario 8: Reward distribution is not blocked by monthly reward pool exhaustion', async () => {
    // Plumber submits and approves bill yielding ₹125 reward
    const plumberBill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-POOL-CAP-${Date.now()}`,
      invoiceDate: '2026-10-07',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('cap'),
      fileName: 'cap.pdf',
      mimeType: 'application/pdf',
    });

    const resPlumber = await BillService.approveBill({
      billId: plumberBill.id,
      adminId: adminUserId,
      gstIncluded: false,
    });

    expect(resPlumber.bill.status).toBe('APPROVED');
    expect(Number(resPlumber.bill.calculatedReward)).toBe(125.0);

    // Meanwhile, Tile Installer bill approval also SUCCEEDS without pool restrictions
    const tileBill = await BillService.submitBill({
      userId: tileUserId,
      invoiceNumber: `INV-TILE-SUCCEED-${Date.now()}`,
      invoiceDate: '2026-10-08',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('tilesucc'),
      fileName: 'tilesucc.pdf',
      mimeType: 'application/pdf',
    });

    const resTile = await BillService.approveBill({
      billId: tileBill.id,
      adminId: adminUserId,
      gstIncluded: false,
    });
    const approvedTile = resTile.bill;

    expect(approvedTile.status).toBe('APPROVED');
    expect(Number(approvedTile.calculatedReward)).toBe(50.0);
  });

  // -------------------------------------------------------------
  // Test 9: Strict Server-Side Profession and Status Filtering
  // -------------------------------------------------------------
  it('Scenario 9: Server-side profession and status filtering returns only matching records', async () => {
    const plumberOnlyBills = await BillService.getAdminBills({
      profession: 'PLUMBER',
      status: 'ALL',
    });

    expect(plumberOnlyBills.length).toBeGreaterThan(0);
    expect(plumberOnlyBills.every((b) => b.profession === 'PLUMBER')).toBe(true);

    const tileOnlyBills = await BillService.getAdminBills({
      profession: 'TILE_INSTALLER',
      status: 'ALL',
    });

    expect(tileOnlyBills.length).toBeGreaterThan(0);
    expect(tileOnlyBills.every((b) => b.profession === 'TILE_INSTALLER')).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 10: Manual GST Override Rejection & Configured Rule Approval
  // -------------------------------------------------------------
  it('Scenario 10: Disallows manual GST override and requires configured GST rule', async () => {
    const bill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-OVERRIDE-${Date.now()}`,
      invoiceDate: '2026-10-09',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('override'),
      fileName: 'override.pdf',
      mimeType: 'application/pdf',
    });

    // 1. Manual override attempt without gstRuleId fails closed
    await expect(
      BillService.approveBill({
        billId: bill.id,
        adminId: adminUserId,
        gstIncluded: true,
        gstRate: 18.0,
        gstOverrideReason: 'Special tax rate verification approved by Director',
      })
    ).rejects.toThrow(/A valid applicable GST rule is required when GST is included/i);

    // 2. Approval with valid configured gstRuleId succeeds
    const res = await BillService.approveBill({
      billId: bill.id,
      adminId: adminUserId,
      gstIncluded: true,
      gstRuleId: defaultGstRuleId,
    });
    const approved = res.bill;

    expect(approved.status).toBe('APPROVED');
    expect(Number(approved.calculatedReward)).toBeGreaterThan(0);

    // Verify audit log entry exists
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: bill.id, action: 'BILL_APPROVED' },
    });
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------
  // Test 11: Fail Closed on Overlapping Reward Rules
  // -------------------------------------------------------------
  it('Scenario 11: getApplicableRule fails closed (throws OVERLAPPING_REWARD_RULES) when multiple active rules overlap', async () => {
    // Manually create two overlapping active rules in DB
    const overlapFrom = new Date('2026-11-01T00:00:00Z');
    const overlapUntil = new Date('2026-11-30T23:59:59Z');

    const rule1 = await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.80,
        effectiveFrom: overlapFrom,
        effectiveUntil: overlapUntil,
        isActive: true,
        version: 991,
      },
    });

    const rule2 = await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.90,
        effectiveFrom: overlapFrom,
        effectiveUntil: overlapUntil,
        isActive: true,
        version: 992,
      },
    });

    try {
      await expect(
        RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-11-15T12:00:00Z'))
      ).rejects.toThrow(/OVERLAPPING_REWARD_RULES/);
    } finally {
      await prisma.rewardRule.deleteMany({ where: { id: { in: [rule1.id, rule2.id] } } });
    }
  });

  // -------------------------------------------------------------
  // Test 12: Historical Rule Versions Authoritative Across Time Windows
  // -------------------------------------------------------------
  it('Scenario 12: Historical effective-dated rule versions are authoritative based on submission timestamp (Bill.createdAt)', async () => {
    // Create an explicit historical rule for 2025: 0.75%
    const histRule = await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.75,
        effectiveFrom: new Date('2025-01-01T00:00:00Z'),
        effectiveUntil: new Date('2025-12-31T23:59:59Z'),
        isActive: true,
        version: 801,
      },
    });

    try {
      // 1. Submit and approve bill dated in 2025 historical window
      const histBill = await BillService.submitBill({
        userId: plumberUserId,
        invoiceNumber: `INV-HIST-${Date.now()}`,
        invoiceDate: '2025-06-15',
        billAmount: 10000.0,
        fileBuffer: createDummyPdfBuffer('hist'),
        fileName: 'hist.pdf',
        mimeType: 'application/pdf',
      });

      // Server-recorded submission timestamp is authoritative
      await prisma.bill.update({
        where: { id: histBill.id },
        data: { createdAt: new Date('2025-06-15T12:00:00Z') },
      });

      const resHist = await BillService.approveBill({
        billId: histBill.id,
        adminId: adminUserId,
        gstIncluded: false,
      });

      expect(Number(resHist.bill.rewardRateSnapshot)).toBe(0.75);
      expect(Number(resHist.bill.calculatedReward)).toBe(75.0);

      // 2. Submit and approve bill dated in current 2026 window
      const currBill = await BillService.submitBill({
        userId: plumberUserId,
        invoiceNumber: `INV-CURR-${Date.now()}`,
        invoiceDate: '2026-10-05',
        billAmount: 10000.0,
        fileBuffer: createDummyPdfBuffer('curr'),
        fileName: 'curr.pdf',
        mimeType: 'application/pdf',
      });

      const resCurr = await BillService.approveBill({
        billId: currBill.id,
        adminId: adminUserId,
        gstIncluded: false,
      });

      // Under rule active on 2026-10-05 (v3 was 1.25% in Scenario 6)
      expect(Number(resCurr.bill.rewardRateSnapshot)).toBe(1.25);
      expect(Number(resCurr.bill.calculatedReward)).toBe(125.0);
    } finally {
      await prisma.rewardRule.deleteMany({ where: { id: histRule.id } });
    }
  });

  // -------------------------------------------------------------
  // Test 13: Full Balance Redemption (100% Reserved, No Caps or Thresholds)
  // -------------------------------------------------------------
  it('Scenario 13: Full balance redemption reserves 100% available balance without monthly caps or thresholds', async () => {
    // 1. Open redemption window with required minimum redemption amount
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: { isEnabled: true, startAt: null, endAt: null, minimumRedemptionAmount: 500.0 },
      create: { id: 'default', isEnabled: true, startAt: null, endAt: null, minimumRedemptionAmount: 500.0 },
    });

    // 2. Set user wallet balance to ₹1,250.75
    await prisma.wallet.update({
      where: { userId: plumberUserId },
      data: {
        availableBalance: 1250.75,
        processingAmount: 0.0,
      },
    });

    // 3. Create verified KYC and Payment Account
    await prisma.kycRecord.deleteMany({ where: { userId: plumberUserId } });
    const kyc = await prisma.kycRecord.create({
      data: {
        userId: plumberUserId,
        panName: 'Ramesh Plumber',
        verifiedName: 'Ramesh Plumber',
        panStatus: 'VERIFIED',
        nameMatched: true,
        maskedPan: 'ABCDE1234F',
        provider: 'SIGNCARE',
      },
    });

    await prisma.paymentAccount.deleteMany({ where: { userId: plumberUserId } });
    const acct = await prisma.paymentAccount.create({
      data: {
        userId: plumberUserId,
        accountType: 'UPI',
        upiId: 'ramesh@oksbi',
        maskedInfo: 'ramesh@oksbi',
        providerRegisteredName: 'Ramesh Plumber',
        providerNameVerified: true,
        isVerified: true,
        isDefault: true,
      },
    });

    // 4. Request full redemption
    const idempotencyKey = `full-redemption-${Date.now()}`;
    const result = await PayoutService.requestRedemption(plumberUserId, idempotencyKey);

    expect(Number(result.amountDebited)).toBe(1250.75);
    expect(Number(result.payout.amount)).toBe(1250.75);
    expect(result.payout.status).toBe('PENDING');

    // 5. Verify wallet state: 100% funds moved from available to processing
    const updatedWallet = await prisma.wallet.findUnique({ where: { userId: plumberUserId } });
    expect(Number(updatedWallet?.availableBalance)).toBe(0.0);
    expect(Number(updatedWallet?.processingAmount)).toBe(1250.75);

    // 6. Verify idempotency: re-calling returns same payout without re-debiting
    const retryResult = await PayoutService.requestRedemption(plumberUserId, idempotencyKey);
    expect(retryResult.payout.id).toBe(result.payout.id);

    // 7. Verify in-flight restriction: cannot start new payout while one is pending
    await expect(
      PayoutService.requestRedemption(plumberUserId, `second-attempt-${Date.now()}`)
    ).rejects.toThrow(/redemption request currently in progress/i);
  });
});
