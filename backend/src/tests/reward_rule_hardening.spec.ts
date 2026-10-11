import request from 'supertest';
import { app } from '../server';
import { RewardRuleService } from '../services/reward-rule.service';
import { BillService } from '../services/bill.service';
import { prisma } from '../db';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import crypto from 'crypto';

describe('Task 1 Hardening — Reward Rule Permissions, Atomicity, and Effective Dating', () => {
  let opsAdmin: any;
  let billAdmin: any;
  let testPlumber: any;
  let opsAdminToken: string;
  let billAdminToken: string;

  const createDummyPdf = () => Buffer.concat([
    Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
    Buffer.from(`Hardening Test Invoice - ${crypto.randomBytes(16).toString('hex')}\n%%EOF`),
  ]);

  beforeAll(async () => {
    // Clean up test users
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } },
    });

    // Create Operations Admin
    opsAdmin = await prisma.user.create({
      data: {
        mobile: '9899900001',
        fullName: 'Operations Admin Hardening',
        passwordHash: 'dummy_hash_ops',
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    opsAdminToken = jwt.sign(
      { userId: opsAdmin.id, role: 'OPERATIONS_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Create Bill Admin
    billAdmin = await prisma.user.create({
      data: {
        mobile: '9899900002',
        fullName: 'Bill Admin Hardening',
        passwordHash: 'dummy_hash_bill',
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    billAdminToken = jwt.sign(
      { userId: billAdmin.id, role: 'BILL_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Create Test Plumber
    testPlumber = await prisma.user.create({
      data: {
        mobile: '9899900003',
        fullName: 'Gopal Plumber',
        passwordHash: 'dummy_hash_plumber',
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: { create: { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 } },
      },
    });

    // Ensure deterministic baseline rules exist for both professions
    for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
      const count = await prisma.rewardRule.count({
        where: { profession: prof, isActive: true, effectiveFrom: { lte: new Date('2026-10-10') } },
      });
      if (count === 0) {
        await prisma.rewardRule.create({
          data: {
            profession: prof,
            rewardPercentage: 0.50,
            effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
            isActive: true,
            version: 1,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9899900001', '9899900002', '9899900003'] } },
    });

    // Reset baseline rules for other suites
    await prisma.rewardRule.deleteMany({
      where: { profession: { in: ['PLUMBER', 'TILE_INSTALLER'] } },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2020-01-01'),
        isActive: true,
        version: 1,
      },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2020-01-01'),
        isActive: true,
        version: 1,
      },
    });
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------
  // 1. Role Authorization Boundaries (Operations Admin vs Bill Admin)
  // -------------------------------------------------------------
  describe('1. Role Authorization Enforcement', () => {
    test('OPERATIONS_ADMIN can read and create reward rules', async () => {
      // Read rules
      const getRes = await request(app)
        .get('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(Array.isArray(getRes.body.rules)).toBe(true);

      // Create new rule
      const postRes = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.65,
          effectiveFrom: '2026-10-15',
        });

      expect(postRes.status).toBe(201);
      expect(postRes.body.success).toBe(true);
      expect(postRes.body.rule.rewardPercentage).toBe(0.65);
      expect(postRes.body.rule.profession).toBe('PLUMBER');
    });

    test('BILL_ADMIN receives 403 Forbidden for all reward-rule settings endpoints', async () => {
      // 1. GET /api/admin/settings/reward-rules
      const getRes = await request(app)
        .get('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(getRes.status).toBe(403);
      expect(getRes.body.success).toBe(false);

      // 2. POST /api/admin/settings/reward-rules
      const postRes = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.70,
        });

      expect(postRes.status).toBe(403);
      expect(postRes.body.success).toBe(false);

      // 3. PUT /api/admin/settings/reward-rules
      const putRes = await request(app)
        .put('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          profession: 'PLUMBER',
          percentage: 0.70,
        });

      expect(putRes.status).toBe(403);
      expect(putRes.body.success).toBe(false);
    });

    test('BILL_ADMIN can read applicable rule review-config for bill verification', async () => {
      const bill = await prisma.bill.create({
        data: {
          userId: testPlumber.id,
          invoiceNumber: `INV-REV-CONFIG-${Date.now()}`,
          invoiceDate: new Date('2026-10-10'),
          billAmount: 10000,
          grossBillAmount: 10000,
          calculatedReward: 50,
          status: 'PENDING',
          fileUrl: 'https://storage/rev.pdf',
          fileKey: 'bills/rev.pdf',
          fileHash: `hash_rev_${Date.now()}`,
        },
      });

      const res = await request(app)
        .get(`/api/admin/bills/${bill.id}/review-config`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rewardRule).toBeDefined();
      expect(typeof res.body.rewardRule.rewardPercentage).toBe('number');
      expect(Array.isArray(res.body.gstRules)).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // 2. Strict Input Validation & Range Enforcement (0.01% - 10.00%)
  // -------------------------------------------------------------
  describe('2. Input Validation & Range Enforcement', () => {
    test('rejects non-finite, out-of-range, and invalid percentages with HTTP 400', async () => {
      // Percentage = 0 (below min 0.01)
      const resZero = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: 0 });
      expect(resZero.status).toBe(400);

      // Percentage = 15.0 (above max 10.00)
      const resHigh = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: 15.0 });
      expect(resHigh.status).toBe(400);
      expect(resHigh.body.message).toContain('0.01% and 10.00%');

      // Percentage = -0.5 (negative)
      const resNeg = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: -0.5 });
      expect(resNeg.status).toBe(400);

      // Percentage = "not_a_number"
      const resNaN = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: 'invalid_pct' });
      expect(resNaN.status).toBe(400);

      // Unsupported category
      const resInvalidProf = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'CARPENTER', rewardPercentage: 0.50 });
      expect(resInvalidProf.status).toBe(400);
    });

    test('rejects temporary bounded rules that leave unbacked future gaps', async () => {
      const resBounded = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.75,
          effectiveFrom: '2026-11-01',
          effectiveUntil: '2026-11-15',
        });

      expect(resBounded.status).toBe(400);
      expect(resBounded.body.message).toContain('Temporary bounded reward rules with open future gaps are not supported');
    });
  });

  // -------------------------------------------------------------
  // 3. Effective-Date Boundary Resolution & Immutability
  // -------------------------------------------------------------
  describe('3. Effective-Date Boundary & Historical Financial Immutability', () => {
    test('applies exact rule percentage based on bill invoiceDate boundary', async () => {
      // Establish clean baseline
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      });

      // Deploy new rate: 0.85% effective from 2026-11-01
      const newRule = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.85,
        effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
      });
      expect(Number(newRule.rewardPercentage)).toBe(0.85);

      // 1. Invoice on 2026-10-31 (1 day before effective date) MUST resolve to 0.50%
      const ruleBefore = await RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-10-31T00:00:00.000Z'));
      expect(Number(ruleBefore.rewardPercentage)).toBe(0.50);

      // 2. Invoice on 2026-11-01 (exact boundary date) MUST resolve to 0.85%
      const ruleOnBoundary = await RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-11-01T00:00:00.000Z'));
      expect(Number(ruleOnBoundary.rewardPercentage)).toBe(0.85);

      // 3. Invoice on 2026-11-05 (after boundary date) MUST resolve to 0.85%
      const ruleAfter = await RewardRuleService.getApplicableRule('PLUMBER', new Date('2026-11-05T00:00:00.000Z'));
      expect(Number(ruleAfter.rewardPercentage)).toBe(0.85);
    });

    test('historical approved bills remain financially immutable when rules change', async () => {
      // 1. Submit and approve bill under 0.85% rule
      const bill = await BillService.submitBill({
        userId: testPlumber.id,
        invoiceNumber: `INV-HIST-IMMUTABLE-${Date.now()}`,
        invoiceDate: '2026-11-02',
        billAmount: 10000.0,
        fileBuffer: createDummyPdf(),
        fileName: 'hist.pdf',
        mimeType: 'application/pdf',
      });

      const approvedRes = await BillService.approveBill(bill.id, billAdmin.id);
      expect(approvedRes.bill.status).toBe('APPROVED');
      expect(Number(approvedRes.bill.calculatedReward)).toBe(85.0); // 10000 * 0.85% = 85.0
      expect(Number(approvedRes.bill.rewardRateSnapshot)).toBe(0.85);

      // 2. Deploy a drastic rule change: 1.50% from 2026-11-03
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 1.50,
        effectiveFrom: new Date('2026-11-03T00:00:00.000Z'),
      });

      // 3. Re-verify the historical bill row from database
      const reloadedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
      expect(Number(reloadedBill?.calculatedReward)).toBe(85.0); // NEVER MUTATED
      expect(Number(reloadedBill?.rewardRateSnapshot)).toBe(0.85); // NEVER MUTATED

      // 4. Verify wallet transaction for this bill remains unchanged
      const tx = await prisma.walletTransaction.findFirst({
        where: { referenceId: bill.id, type: 'REWARD_CREDIT' },
      });
      expect(Number(tx?.amount)).toBe(85.0);
    });
  });

  // -------------------------------------------------------------
  // 4. Atomicity, Concurrency & Rollback Integrity
  // -------------------------------------------------------------
  describe('4. Atomicity and Concurrency Safety', () => {
    test('audit log failure rolls back rule creation completely', async () => {
      const countBefore = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });

      await expect(
        prisma.$transaction(async (trx) => {
          // Force failure at audit log step
          jest.spyOn(trx.auditLog, 'create').mockRejectedValueOnce(
            new Error('Simulated Audit Log DB constraint failure')
          );
          await RewardRuleService.createRule(opsAdmin.id, {
            profession: 'TILE_INSTALLER',
            rewardPercentage: 0.95,
            effectiveFrom: new Date('2026-12-01'),
          }, trx);
        })
      ).rejects.toThrow('Simulated Audit Log DB constraint failure');

      const countAfter = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countAfter).toBe(countBefore); // ROLLED BACK COMPLETELY!
    });

    test('concurrent rule updates serialize safely without overlapping active intervals', async () => {
      // Clean up tile installer rules before test
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.50,
        effectiveFrom: new Date('2026-01-01'),
      });

      // Launch 3 simultaneous createRule calls
      const promises = [
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.60,
          effectiveFrom: new Date('2026-12-02'),
        }),
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.70,
          effectiveFrom: new Date('2026-12-03'),
        }),
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.80,
          effectiveFrom: new Date('2026-12-04'),
        }),
      ];

      const results = await Promise.all(promises);
      expect(results.length).toBe(3);

      // Verify all versions are unique
      const versions = results.map((r) => r.version);
      const uniqueVersions = new Set(versions);
      expect(uniqueVersions.size).toBe(3);

      // Query active rule at 2026-12-05: must resolve deterministically to the latest rule (0.80%)
      const resolved = await RewardRuleService.getApplicableRule('TILE_INSTALLER', new Date('2026-12-05'));
      expect(resolved).toBeDefined();
      expect(Number(resolved.rewardPercentage)).toBe(0.80);
    });

    test('concurrent first-time rule creation with no pre-existing row serializes via PostgreSQL advisory lock', async () => {
      // Clean up PLUMBER rules completely so 0 rows exist initially
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
      const initialCount = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(initialCount).toBe(0);

      // Launch 2 concurrent first-time rule creation operations for PLUMBER
      const [res1, res2] = await Promise.all([
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'PLUMBER',
          rewardPercentage: 0.50,
          effectiveFrom: '2026-01-01',
        }),
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'PLUMBER',
          rewardPercentage: 0.75,
          effectiveFrom: '2026-07-01',
        }),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();

      // Check versions: exactly 1 and 2
      const allRules = await prisma.rewardRule.findMany({
        where: { profession: 'PLUMBER' },
        orderBy: { version: 'asc' },
      });

      expect(allRules.length).toBe(2);
      expect(allRules[0].version).toBe(1);
      expect(allRules[1].version).toBe(2);

      // Historical immutability: underlying rows are NOT mutated in place
      const ruleEarlier = allRules.find((r) => Number(r.rewardPercentage) === 0.50);
      const ruleLater = allRules.find((r) => Number(r.rewardPercentage) === 0.75);
      expect(ruleEarlier?.effectiveUntil).toBeNull();
      expect(ruleLater?.effectiveUntil).toBeNull();

      // Derived interval coverage via listRules timeline:
      const listed = await RewardRuleService.listRules('PLUMBER');
      const listedEarlier = listed.find((r: any) => Number(r.rewardPercentage) === 0.50);
      expect(listedEarlier?.effectiveUntil?.toISOString()).toBe(ruleLater?.effectiveFrom.toISOString());
    });

    test('lock or query failure causes complete rollback instead of fail-open behavior', async () => {
      const countBefore = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });

      await expect(
        prisma.$transaction(async (trx) => {
          // Force failure at lock acquisition step
          jest.spyOn(trx, '$executeRaw').mockRejectedValueOnce(
            new Error('PostgreSQL deadlock / lock acquisition failed')
          );
          await RewardRuleService.createRule(opsAdmin.id, {
            profession: 'PLUMBER',
            rewardPercentage: 0.90,
            effectiveFrom: '2026-09-01',
          }, trx);
        })
      ).rejects.toThrow('PostgreSQL deadlock / lock acquisition failed');

      const countAfter = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(countAfter).toBe(countBefore); // Fail closed: zero partial updates!
    });

    test('Asia/Kolkata calendar normalization aligns bill verification and rule configuration across day boundaries', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });

      // Baseline: 0.50% from 2026-01-01
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        effectiveFrom: '2026-01-01',
      });

      // New rule: 0.80% starting 2026-10-15
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.80,
        effectiveFrom: '2026-10-15',
      });

      // 1. Day before: 2026-10-14 -> MUST resolve to 0.50%
      const ruleDayBefore = await RewardRuleService.getApplicableRule('PLUMBER', '2026-10-14');
      expect(Number(ruleDayBefore.rewardPercentage)).toBe(0.50);

      // 2. Day of effective date: 2026-10-15 -> MUST resolve to 0.80%
      const ruleDayOf = await RewardRuleService.getApplicableRule('PLUMBER', '2026-10-15');
      expect(Number(ruleDayOf.rewardPercentage)).toBe(0.80);

      // 3. Day after: 2026-10-16 -> MUST resolve to 0.80%
      const ruleDayAfter = await RewardRuleService.getApplicableRule('PLUMBER', '2026-10-16');
      expect(Number(ruleDayAfter.rewardPercentage)).toBe(0.80);

      // 4. Submit and approve bill dated 2026-10-15 -> MUST earn 0.80% reward
      const bill = await BillService.submitBill({
        userId: testPlumber.id,
        invoiceNumber: `INV-IST-CALENDAR-${Date.now()}`,
        invoiceDate: '2026-10-15',
        billAmount: 10000,
        fileBuffer: createDummyPdf(),
        fileName: 'calendar.pdf',
        mimeType: 'application/pdf',
      });

      const approved = await BillService.approveBill(bill.id, billAdmin.id);
      expect(Number(approved.bill.calculatedReward)).toBe(80.0); // 10000 * 0.80%
      expect(Number(approved.bill.rewardRateSnapshot)).toBe(0.80);
    });
  });

  // -------------------------------------------------------------
  // 5. Append-Only Rule Timeline & Historical Immutability (Task 1)
  // -------------------------------------------------------------
  describe('5. Append-Only Rule Timeline & Historical Row Immutability', () => {
    test('creating subsequent rule versions does NOT mutate any prior row attributes in database', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });

      // Create v1
      const v1 = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.50,
        effectiveFrom: '2026-01-01',
      });

      const initialV1Row = await prisma.rewardRule.findUnique({ where: { id: v1.id } });
      expect(initialV1Row).toBeDefined();
      expect(initialV1Row?.effectiveUntil).toBeNull();
      expect(initialV1Row?.isActive).toBe(true);
      expect(initialV1Row?.updatedByAdminId).toBe(opsAdmin.id);
      const initialUpdatedAt = initialV1Row?.updatedAt.getTime();

      // Create v2 (chronologically after v1)
      const v2 = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.75,
        effectiveFrom: '2026-08-01',
      });

      // Re-fetch v1 row directly from database
      const reloadedV1Row = await prisma.rewardRule.findUnique({ where: { id: v1.id } });
      expect(reloadedV1Row?.effectiveUntil).toBeNull(); // NEVER MUTATED IN PLACE
      expect(reloadedV1Row?.isActive).toBe(true); // NEVER DEACTIVATED
      expect(reloadedV1Row?.updatedByAdminId).toBe(opsAdmin.id); // NEVER OVERWRITTEN
      expect(reloadedV1Row?.updatedAt.getTime()).toBe(initialUpdatedAt); // TIMESTAMP UNTOUCHED
      expect(Number(reloadedV1Row?.rewardPercentage)).toBe(0.50);

      // Verify timeline intervals are derived cleanly via listRules
      const listed = await RewardRuleService.listRules('TILE_INSTALLER');
      const listedV1 = listed.find((r: any) => r.version === 1);
      const listedV2 = listed.find((r: any) => r.version === 2);
      expect(listedV1?.effectiveUntil?.toISOString()).toBe(v2.effectiveFrom.toISOString());
      expect(listedV2?.effectiveUntil).toBeNull();
    });

    test('out-of-order scheduled rule insertions resolve correct rates without mutating older/newer records', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });

      // 1. Insert Rule A: effective 2026-01-01 (0.50%)
      const ruleA = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        effectiveFrom: '2026-01-01',
      });

      // 2. Insert Rule C: effective 2026-11-01 (0.90%)
      const ruleC = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.90,
        effectiveFrom: '2026-11-01',
      });

      // 3. Out-of-order: Insert Rule B in-between: effective 2026-06-01 (0.70%)
      const ruleB = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'PLUMBER',
        rewardPercentage: 0.70,
        effectiveFrom: '2026-06-01',
      });

      // Verify DB records for Rule A and Rule C were never mutated
      const rowA = await prisma.rewardRule.findUnique({ where: { id: ruleA.id } });
      const rowC = await prisma.rewardRule.findUnique({ where: { id: ruleC.id } });
      expect(rowA?.effectiveUntil).toBeNull();
      expect(rowC?.effectiveUntil).toBeNull();

      // Test rate resolution across intervals:
      // Interval 1: before Rule B -> 0.50%
      const resEarly = await RewardRuleService.getApplicableRule('PLUMBER', '2026-03-15');
      expect(Number(resEarly.rewardPercentage)).toBe(0.50);

      // Interval 2: during Rule B -> 0.70%
      const resMid = await RewardRuleService.getApplicableRule('PLUMBER', '2026-08-15');
      expect(Number(resMid.rewardPercentage)).toBe(0.70);

      // Interval 3: during Rule C -> 0.90%
      const resLate = await RewardRuleService.getApplicableRule('PLUMBER', '2026-12-01');
      expect(Number(resLate.rewardPercentage)).toBe(0.90);
    });

    test('rejects ambiguous configurations when attempting to create duplicate active rules on exact same date', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });

      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.60,
        effectiveFrom: '2026-05-01',
      });

      // Attempting to create another active rule on exact same date 2026-05-01 must reject
      await expect(
        RewardRuleService.createRule(opsAdmin.id, {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.80,
          effectiveFrom: '2026-05-01',
        })
      ).rejects.toThrow('Ambiguous duplicate configurations are rejected');
    });
  });

  // -------------------------------------------------------------
  // 6. Strict India Business Calendar Date Validation (Task 2)
  // -------------------------------------------------------------
  describe('6. Strict India Business Calendar Date Validation', () => {
    test('POST /api/admin/settings/reward-rules strictly validates calendar dates and rejects impossible dates', async () => {
      // 1. Impossible date: February 31
      const resFeb31 = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2026-02-31',
        });
      expect(resFeb31.status).toBe(400);
      expect(resFeb31.body.message).toContain('Invalid calendar date: "2026-02-31"');

      // 2. Impossible leap-year date: February 29 in non-leap year (2025)
      const resFeb29NonLeap = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2025-02-29',
        });
      expect(resFeb29NonLeap.status).toBe(400);
      expect(resFeb29NonLeap.body.message).toContain('Month 2 in year 2025 has only 28 days');

      // 3. Valid leap-year date: February 29 in leap year (2024)
      const resFeb29Leap = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2024-02-29',
        });
      expect(resFeb29Leap.status).toBe(201);
      expect(resFeb29Leap.body.success).toBe(true);

      // 4. Impossible date: April 31
      const resApr31 = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2026-04-31',
        });
      expect(resApr31.status).toBe(400);
      expect(resApr31.body.message).toContain('Month 4 in year 2026 has only 30 days');

      // 5. Invalid month: Month 13
      const resMonth13 = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2026-13-01',
        });
      expect(resMonth13.status).toBe(400);
      expect(resMonth13.body.message).toContain('Expected exact YYYY-MM-DD');

      // 6. Trailing garbage in date string
      const resGarbage = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '2026-10-15-extra',
        });
      expect(resGarbage.status).toBe(400);

      // 7. Empty date string
      const resEmpty = await request(app)
        .post('/api/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          profession: 'PLUMBER',
          rewardPercentage: 0.60,
          effectiveFrom: '',
        });
      expect([201, 400]).toContain(resEmpty.status);
    });

    test('invoice date submission rejects impossible calendar dates', async () => {
      const workerToken = jwt.sign(
        { userId: testPlumber.id, mobile: testPlumber.mobile, role: 'USER' },
        config.jwt.accessSecret,
        { expiresIn: '1h' }
      );
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${workerToken}`)
        .field('invoiceNumber', `INV-INVALID-DATE-${Date.now()}`)
        .field('invoiceDate', '2026-02-31')
        .field('billAmount', '5000')
        .attach('invoiceFile', createDummyPdf(), 'inv.pdf');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid calendar date: "2026-02-31"');
    });
  });

  // -------------------------------------------------------------
  // 7. Future-Rule Fallback Removal from Invoice Resolution (Task 3)
  // -------------------------------------------------------------
  describe('7. Future-Rule Fallback Removal from Invoice Resolution', () => {
    test('past invoice fails closed and NEVER receives future-scheduled rule rate', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });

      // Table has ONLY a future-scheduled rule: 0.95% effective in 2099
      await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.95,
        effectiveFrom: '2099-01-01',
      });

      // Attempting to resolve rate for an invoice dated 2026-10-11 MUST fail closed
      await expect(
        RewardRuleService.getApplicableRule('TILE_INSTALLER', '2026-10-11')
      ).rejects.toThrow('[REWARD-RULE] No active reward rule found for profession TILE_INSTALLER');
    });

    test('test fixture baseline bootstrap ONLY triggers when zero total rules exist in database', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });
      const initialCount = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(initialCount).toBe(0);

      // In development/test with zero rows, baseline bootstrap creates 0.50% starting 2020-01-01
      const bootstrapped = await RewardRuleService.getApplicableRule('TILE_INSTALLER', '2026-10-11');
      expect(bootstrapped).toBeDefined();
      expect(Number(bootstrapped.rewardPercentage)).toBe(0.50);
      expect(bootstrapped.effectiveFrom.toISOString()).toBe(new Date('2020-01-01T00:00:00+05:30').toISOString());
    });
  });

  // -------------------------------------------------------------
  // 8. IST Redemption-Window Date and Time Formatting Helpers (Task 4)
  // -------------------------------------------------------------
  describe('8. IST Redemption-Window Date & Time Formatting Helpers', () => {
    test('round-trips date and time accurately in Asia/Kolkata regardless of execution timezone', () => {
      const { formatIndiaTimeOnly, parseIndiaIsoDateTime, parseIndiaBusinessDate, formatIstDate } = require('../utils/timezone.utils');

      // Test IST time formatting: 10:00 IST is 04:30 UTC
      const utcIso = '2026-10-15T04:30:00.000Z';
      const timeStr = formatIndiaTimeOnly(utcIso);
      expect(timeStr).toBe('10:00');

      // Test IST evening formatting: 23:59 IST is 18:29 UTC
      const nightUtcIso = '2026-10-15T18:29:00.000Z';
      const nightTimeStr = formatIndiaTimeOnly(nightUtcIso);
      expect(nightTimeStr).toBe('23:59');

      // Test parsing back to ISO with explicit +05:30 offset
      const parsedIso = parseIndiaIsoDateTime('2026-10-15', '10:00');
      expect(new Date(parsedIso).toISOString()).toBe('2026-10-15T04:30:00.000Z');

      // Verify business date formatting
      const bDate = parseIndiaBusinessDate('2026-10-15');
      expect(formatIstDate(bDate, 'yyyy-MM-dd')).toBe('2026-10-15');
    });
  });

  afterAll(async () => {
    // Restore clean baseline rules for both professions
    for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
      await prisma.rewardRule.deleteMany({ where: { profession: prof } });
      await prisma.rewardRule.create({
        data: {
          profession: prof,
          rewardPercentage: 0.50,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
          isActive: true,
          version: 1,
        },
      });
    }
  });
});
