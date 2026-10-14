import request from 'supertest';
import { app } from '../server';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { GstService, parseStrictGstRate } from '../services/gst.service';
import { BillService } from '../services/bill.service';
import { RewardService } from '../services/reward.service';
import { getOrCreateOpsAdmin, getOrCreateBillAdmin } from './test_helpers';

describe('HIR-V4-04: GST Zero-Rate Consistency & Bill Approval Regression Suite', () => {
  let opsAdminId: string;
  let billAdminId: string;
  let opsAdminToken: string;
  let billAdminToken: string;
  let testUserId: string;
  let zeroGstRuleId: string;
  let standard18GstRuleId: string;
  let defaultRewardRuleId: string;
  let expectedRewardRate: number = 1.0;
  let didCreateRewardRule = false;
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    const opsAdmin = await getOrCreateOpsAdmin(prisma, '9876599010');
    opsAdminId = opsAdmin.id;
    const billAdmin = await getOrCreateBillAdmin(prisma, '9876599011');
    billAdminId = billAdmin.id;

    opsAdminToken = jwt.sign(
      { userId: opsAdminId, role: 'OPERATIONS_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );
    billAdminToken = jwt.sign(
      { userId: billAdminId, role: 'BILL_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

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
    const allRuleIdsToDelete = [zeroGstRuleId, standard18GstRuleId, ...createdRuleIds];
    await prisma.gstRule.deleteMany({ where: { id: { in: allRuleIdsToDelete } } });
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

  // 14. Unit test suite for parseStrictGstRate (HIR-V4.1-02)
  describe('14. Unit Suite: parseStrictGstRate strict input parsing', () => {
    test('accepts valid numeric values and clean strings within [0, 100]', () => {
      expect(parseStrictGstRate(0)).toBe(0);
      expect(parseStrictGstRate('0')).toBe(0);
      expect(parseStrictGstRate('0.00')).toBe(0);
      expect(parseStrictGstRate(18)).toBe(18);
      expect(parseStrictGstRate('18')).toBe(18);
      expect(parseStrictGstRate(18.5)).toBe(18.5);
      expect(parseStrictGstRate('18.50')).toBe(18.5);
      expect(parseStrictGstRate(100)).toBe(100);
      expect(parseStrictGstRate('100.00')).toBe(100);
      expect(parseStrictGstRate(' 18 ')).toBe(18);
    });

    test('rejects empty, whitespace, and alphanumeric strings', () => {
      expect(() => parseStrictGstRate('')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('   ')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('18foo')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('foo18')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('18%')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('abc')).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects scientific notation', () => {
      expect(() => parseStrictGstRate('1e2')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('1e-2')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('2.5e1')).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects negative numbers and values exceeding 100', () => {
      expect(() => parseStrictGstRate(-5)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('-5')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(-0.01)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(105)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('105')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(100.01)).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects NaN, Infinity, and non-numeric types', () => {
      expect(() => parseStrictGstRate(NaN)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(Infinity)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(-Infinity)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(null)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(undefined)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate({})).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate([])).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(true)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(false)).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects numbers with more than 2 decimal places', () => {
      expect(() => parseStrictGstRate(18.123)).toThrow(/cannot have more than 2 decimal places/i);
      expect(() => parseStrictGstRate('18.123')).toThrow(/cannot have more than 2 decimal places/i);
      expect(() => parseStrictGstRate(0.001)).toThrow(/cannot have more than 2 decimal places/i);
      expect(() => parseStrictGstRate('0.001')).toThrow(/cannot have more than 2 decimal places/i);
    });
  });

  // 15. Service-level validation and fail-closed atomicity (HIR-V4.1-02)
  describe('15. Service Suite: GstService.createGstRule boundary validation & atomicity', () => {
    test('rejects non-boolean isDefault before modifying database', async () => {
      await expect(
        GstService.createGstRule(opsAdminId, { ratePercentage: 18, isDefault: 'false' as any })
      ).rejects.toThrow(/isDefault must be a boolean/i);

      await expect(
        GstService.createGstRule(opsAdminId, { ratePercentage: 18, isDefault: 'true' as any })
      ).rejects.toThrow(/isDefault must be a boolean/i);

      await expect(
        GstService.createGstRule(opsAdminId, { ratePercentage: 18, isDefault: 1 as any })
      ).rejects.toThrow(/isDefault must be a boolean/i);
    });

    test('rejects non-string description before modifying database', async () => {
      await expect(
        GstService.createGstRule(opsAdminId, { ratePercentage: 18, description: 12345 as any })
      ).rejects.toThrow(/description must be a string/i);

      await expect(
        GstService.createGstRule(opsAdminId, { ratePercentage: 18, description: true as any })
      ).rejects.toThrow(/description must be a string/i);
    });

    test('fails closed atomically: invalid rate does NOT unset existing default rule', async () => {
      // Create a valid default GST rule
      const initialDefault = await GstService.createGstRule(opsAdminId, {
        ratePercentage: 12.0,
        isDefault: true,
        description: 'V4.1 Initial Default 12%',
      });
      createdRuleIds.push(initialDefault.id);

      expect(initialDefault.isDefault).toBe(true);

      // Attempt to create a new default rule with invalid rate
      await expect(
        GstService.createGstRule(opsAdminId, {
          ratePercentage: '18foo',
          isDefault: true,
          description: 'Invalid Attempt',
        })
      ).rejects.toThrow(/between 0.00% and 100.00%/i);

      // Verify initial default rule is STILL the default
      const checkRule = await prisma.gstRule.findUnique({ where: { id: initialDefault.id } });
      expect(checkRule?.isDefault).toBe(true);

      // Attempt to create a new default rule with invalid isDefault type
      await expect(
        GstService.createGstRule(opsAdminId, {
          ratePercentage: 18.0,
          isDefault: 'true' as any,
          description: 'Bad isDefault Type',
        })
      ).rejects.toThrow(/isDefault must be a boolean/i);

      // Verify initial default rule is STILL untouched
      const checkRule2 = await prisma.gstRule.findUnique({ where: { id: initialDefault.id } });
      expect(checkRule2?.isDefault).toBe(true);
    });
  });

  // 16. HTTP endpoint authorization and strict validation (HIR-V4.1-02)
  describe('16. HTTP Route Suite: POST /api/v1/admin/settings/gst-rules', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .send({ ratePercentage: 18, description: 'No Token' });
      expect(res.status).toBe(401);
    });

    test('rejects BILL_ADMIN requests with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ ratePercentage: 18, description: 'Bill Admin Token' });
      expect(res.status).toBe(403);
    });

    test('rejects invalid ratePercentage values with 400 Bad Request', async () => {
      // 18foo
      const res1 = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: '18foo', description: 'Malformed rate' });
      expect(res1.status).toBe(400);
      expect(res1.body.message).toMatch(/Invalid GST rate percentage/i);

      // 18.123 (>2 decimals)
      const res2 = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 18.123, description: 'Too many decimals' });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/Invalid GST rate percentage/i);

      // -5 (negative)
      const res3 = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: -5, description: 'Negative rate' });
      expect(res3.status).toBe(400);

      // 105 (>100)
      const res4 = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 105, description: 'Over 100%' });
      expect(res4.status).toBe(400);
    });

    test('rejects non-boolean isDefault with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 18, isDefault: 'false', description: 'String boolean' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/isDefault must be a boolean/i);
    });

    test('rejects non-string description with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 18, description: 12345 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/description must be a string/i);
    });

    test('accepts valid 0% and 18% GST rules and creates them with 201 Created', async () => {
      // 0% GST
      const zeroRes = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 0.0, description: 'V4.1 Test 0% Route Rule', isDefault: false });
      expect(zeroRes.status).toBe(201);
      expect(zeroRes.body.success).toBe(true);
      expect(Number(zeroRes.body.rule.ratePercentage)).toBe(0);
      createdRuleIds.push(zeroRes.body.rule.id);

      // 18.5% GST
      const standardRes = await request(app)
        .post('/api/v1/admin/settings/gst-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ ratePercentage: 18.5, description: 'V4.1 Test 18.5% Route Rule', isDefault: false });
      expect(standardRes.status).toBe(201);
      expect(standardRes.body.success).toBe(true);
      expect(Number(standardRes.body.rule.ratePercentage)).toBe(18.5);
      createdRuleIds.push(standardRes.body.rule.id);
    });
  });

  // 17. HTTP endpoint PATCH strict validation (HIR-V4.1-02)
  describe('17. HTTP Route Suite: PATCH /api/v1/admin/settings/gst-rules/:id', () => {
    test('rejects non-boolean isDefault or isActive, and non-string description', async () => {
      const resBadDefault = await request(app)
        .patch(`/api/v1/admin/settings/gst-rules/${zeroGstRuleId}`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ isDefault: 'false' });
      expect(resBadDefault.status).toBe(400);
      expect(resBadDefault.body.message).toMatch(/isDefault must be a boolean/i);

      const resBadActive = await request(app)
        .patch(`/api/v1/admin/settings/gst-rules/${zeroGstRuleId}`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ isActive: 'false' });
      expect(resBadActive.status).toBe(400);
      expect(resBadActive.body.message).toMatch(/isActive must be a boolean/i);

      const resBadDesc = await request(app)
        .patch(`/api/v1/admin/settings/gst-rules/${zeroGstRuleId}`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ description: 9999 });
      expect(resBadDesc.status).toBe(400);
      expect(resBadDesc.body.message).toMatch(/description must be a string/i);
    });
  });

  // 18. Canonical calculation result shape contract (HIRALAL-GST-02)
  describe('18. Canonical Result Contract: calculateGstAndEligibleAmount for gstIncluded = false', () => {
    test('returns identical canonical shape with gstRate: null when gstIncluded is false', () => {
      const fromReverse = GstService.calculateReverseGst(12000, false, null);
      const fromBothNull = GstService.calculateGstAndEligibleAmount(12000, false, null);
      const fromZeroRate = GstService.calculateGstAndEligibleAmount(12000, false, 0);
      const from18Rate = GstService.calculateGstAndEligibleAmount(12000, false, 18);

      expect(fromBothNull).toEqual({
        grossBillAmount: 12000,
        gstIncluded: false,
        gstRate: null,
        gstAmount: 0,
        eligibleRewardAmount: 12000,
      });

      expect(fromBothNull).toEqual(fromReverse);
      expect(fromZeroRate).toEqual(fromReverse);
      expect(from18Rate).toEqual(fromReverse);
    });
  });

  // 19. Strict Rate Validation Exhaustive Edge Cases
  describe('19. parseStrictGstRate: Comprehensive Unit Edge Cases', () => {
    test('accepts valid boundary numbers and formatted strings', () => {
      expect(parseStrictGstRate(0)).toBe(0);
      expect(parseStrictGstRate(0.0)).toBe(0);
      expect(parseStrictGstRate('0')).toBe(0);
      expect(parseStrictGstRate('0.0')).toBe(0);
      expect(parseStrictGstRate('0.00')).toBe(0);

      expect(parseStrictGstRate(100)).toBe(100);
      expect(parseStrictGstRate(100.0)).toBe(100);
      expect(parseStrictGstRate('100')).toBe(100);
      expect(parseStrictGstRate('100.0')).toBe(100);
      expect(parseStrictGstRate('100.00')).toBe(100);

      expect(parseStrictGstRate(18)).toBe(18);
      expect(parseStrictGstRate(18.5)).toBe(18.5);
      expect(parseStrictGstRate(18.75)).toBe(18.75);
      expect(parseStrictGstRate('18.75')).toBe(18.75);
    });

    test('neutralizes JavaScript negative zero', () => {
      const res = parseStrictGstRate(-0);
      expect(res).toBe(0);
      expect(Object.is(res, -0)).toBe(false);
      expect(Object.is(res, 0)).toBe(true);
    });

    test('rejects negative numbers and negative numeric strings', () => {
      expect(() => parseStrictGstRate(-1)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(-0.01)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('-1')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('-0.01')).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects overflow rates above 100%', () => {
      expect(() => parseStrictGstRate(100.01)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate(101)).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('100.01')).toThrow(/between 0.00% and 100.00%/i);
      expect(() => parseStrictGstRate('101')).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects excess fractional precision greater than 2 decimal places', () => {
      expect(() => parseStrictGstRate(18.123)).toThrow(/more than 2 decimal places/i);
      expect(() => parseStrictGstRate('18.123')).toThrow(/more than 2 decimal places/i);
      expect(() => parseStrictGstRate(0.001)).toThrow(/more than 2 decimal places/i);
      expect(() => parseStrictGstRate('0.001')).toThrow(/more than 2 decimal places/i);
    });

    test('rejects scientific notation and infinitesimal floats', () => {
      expect(() => parseStrictGstRate(1e-7)).toThrow(/more than 2 decimal places/i);
      expect(() => parseStrictGstRate('1e-7')).toThrow(/between 0.00% and 100.00%/i);
    });

    test('rejects non-numeric strings, empty inputs, null, undefined, NaN, Infinity', () => {
      expect(() => parseStrictGstRate('')).toThrow();
      expect(() => parseStrictGstRate('   ')).toThrow();
      expect(() => parseStrictGstRate('18%')).toThrow();
      expect(() => parseStrictGstRate('18.00foo')).toThrow();
      expect(() => parseStrictGstRate('abc')).toThrow();
      expect(() => parseStrictGstRate(null)).toThrow();
      expect(() => parseStrictGstRate(undefined)).toThrow();
      expect(() => parseStrictGstRate(NaN)).toThrow();
      expect(() => parseStrictGstRate(Infinity)).toThrow();
      expect(() => parseStrictGstRate(-Infinity)).toThrow();
    });
  });

  // 20. Concurrent Default Rule Mutation & Target Existence Atomicity
  describe('20. Concurrency & Atomicity: Advisory Lock Serialization for Default Rules', () => {
    test('serializes concurrent default rule designations with exactly one default rule prevailing', async () => {
      const promises = [
        GstService.createGstRule(opsAdminId, { ratePercentage: 5.0, description: 'Concurrent Default 5%', isDefault: true }),
        GstService.createGstRule(opsAdminId, { ratePercentage: 12.0, description: 'Concurrent Default 12%', isDefault: true }),
      ];

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(2);

      for (const f of fulfilled) {
        createdRuleIds.push((f as PromiseFulfilledResult<any>).value.id);
      }

      // Assert in database: exactly ONE active rule has isDefault === true among these
      const defaultRules = await prisma.gstRule.findMany({
        where: { id: { in: createdRuleIds }, isDefault: true },
      });
      expect(defaultRules.length).toBe(1);
    });

    test('updating a non-existent rule throws 404 without modifying any existing default rules', async () => {
      // Create an established default rule
      const initialDefault = await GstService.createGstRule(opsAdminId, {
        ratePercentage: 18.0,
        description: 'Established Default Rule',
        isDefault: true,
      });
      createdRuleIds.push(initialDefault.id);

      // Attempt to update non-existent rule to be default
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      await expect(
        GstService.updateGstRule(opsAdminId, nonExistentId, { isDefault: true })
      ).rejects.toThrow(/not found/i);

      // Verify established default rule is still default!
      const currentDefault = await prisma.gstRule.findUnique({
        where: { id: initialDefault.id },
      });
      expect(currentDefault!.isDefault).toBe(true);
    });
  });
});
