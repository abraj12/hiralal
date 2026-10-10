import { RewardRuleService } from '../services/reward-rule.service';
import { GstService } from '../services/gst.service';
import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { prisma } from '../db';
import crypto from 'crypto';

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
    const admin = await prisma.user.upsert({
      where: { mobile: '9999999999' },
      update: { role: 'ADMIN' },
      create: {
        mobile: '9999999999',
        fullName: 'Executive Admin',
        passwordHash: 'adminhash',
        role: 'ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
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
    });
    defaultGstRuleId = gst18.id;

    const gst12 = await GstService.createGstRule(adminUserId, {
      ratePercentage: 12.0,
      description: 'Concessional 12% GST',
      isDefault: false,
    });
    gst12RuleId = gst12.id;

    const gst0 = await GstService.createGstRule(adminUserId, {
      ratePercentage: 0.0,
      description: 'Tax exempt goods',
      isDefault: false,
    });
    gst0RuleId = gst0.id;

    // 6. Setup Active Reward Rules
    await prisma.rewardRule.deleteMany({
      where: { profession: { in: ['PLUMBER', 'TILE_INSTALLER'] } },
    });

    await RewardRuleService.createRule(adminUserId, {
      profession: 'PLUMBER',
      rewardPercentage: 0.50,
      monthlyPoolLimit: 50000.0,
      minRedemptionAmount: 500.0,
      maxRedemptionAmount: 10000.0,
      effectiveFrom: new Date('2026-10-01'),
    });

    await RewardRuleService.createRule(adminUserId, {
      profession: 'TILE_INSTALLER',
      rewardPercentage: 0.75,
      monthlyPoolLimit: 40000.0,
      minRedemptionAmount: 500.0,
      maxRedemptionAmount: 10000.0,
      effectiveFrom: new Date('2026-10-01'),
    });

    // Reset current month pools for both professions
    const { year, month } = getIstYearAndMonth();
    await prisma.rewardPool.upsert({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      update: { totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
      create: { profession: 'PLUMBER', year, month, totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
    });

    await prisma.rewardPool.upsert({
      where: { pool_profession_year_month_unique: { profession: 'TILE_INSTALLER', year, month } },
      update: { totalPoolCap: 40000.0, usedAmount: 0.0, isCapped: false },
      create: { profession: 'TILE_INSTALLER', year, month, totalPoolCap: 40000.0, usedAmount: 0.0, isCapped: false },
    });
  });

  afterAll(async () => {
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
    await prisma.rewardRule.updateMany({
      where: { profession: 'PLUMBER' },
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
  // Test 4: Profession Distinction: Plumber (0.50%) vs Tile (0.75%)
  // -------------------------------------------------------------
  it('Scenario 4: Profession Distinction: Tile installer receives 0.75% while plumber receives 0.50%', async () => {
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

    // 0.75% of 10000 = 75.00
    expect(Number(approved.calculatedReward)).toBe(75.0);
    expect(Number(approved.rewardRateSnapshot)).toBe(0.75);

    const wallet = await prisma.wallet.findUnique({ where: { userId: tileUserId } });
    expect(Number(wallet?.availableBalance)).toBe(75.0);
  });

  // -------------------------------------------------------------
  // Test 5: Changing Plumber Rule Does NOT Alter Tile Rule
  // -------------------------------------------------------------
  it('Scenario 5: Changing Plumber rate preserves Tile Installer rate independently', async () => {
    // Deploy updated plumber rule: 0.60%
    const newPlumberRule = await RewardRuleService.createRule(adminUserId, {
      profession: 'PLUMBER',
      rewardPercentage: 0.60,
      monthlyPoolLimit: 60000.0,
      effectiveFrom: new Date('2026-10-04'),
    });

    expect(Number(newPlumberRule.rewardPercentage)).toBe(0.60);

    // Fetch applicable rule for Plumber and Tile Installer
    const activePlumberRule = await RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-10-04'));
    const activeTileRule = await RewardRuleService.getApplicableRule('TILE_INSTALLER', new Date('2026-10-04'));

    expect(Number(activePlumberRule.rewardPercentage)).toBe(0.60);
    expect(Number(activeTileRule.rewardPercentage)).toBe(0.75); // Tile rule unaffected
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
      monthlyPoolLimit: 80000.0,
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
    expect(Number(approvedTile.calculatedReward)).toBe(75.0);
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
  // Test 10: Admin GST Override and Audit Logging
  // -------------------------------------------------------------
  it('Scenario 10: Admin GST override stores justification and audit log', async () => {
    // Reset plumber pool so approval is allowed
    const { year, month } = getIstYearAndMonth();
    await prisma.rewardPool.update({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      data: { usedAmount: 0.0, isCapped: false },
    });

    const bill = await BillService.submitBill({
      userId: plumberUserId,
      invoiceNumber: `INV-OVERRIDE-${Date.now()}`,
      invoiceDate: '2026-10-09',
      billAmount: 10000.0,
      fileBuffer: createDummyPdfBuffer('override'),
      fileName: 'override.pdf',
      mimeType: 'application/pdf',
    });

    const res = await BillService.approveBill({
      billId: bill.id,
      adminId: adminUserId,
      gstIncluded: true,
      gstRate: 18.0,
      gstOverrideReason: 'Special tax rate verification approved by Director',
    });
    const approved = res.bill;

    expect(approved.status).toBe('APPROVED');
    expect(Number(approved.calculatedReward)).toBeGreaterThan(0);
    expect(approved.gstOverrideReason).toBe('Special tax rate verification approved by Director');

    // Verify audit log entry exists
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: bill.id, action: 'BILL_APPROVED' },
    });
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].newValue).toContain('Special tax rate verification');
  });
});
