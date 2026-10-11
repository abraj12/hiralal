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

      // Verify continuous interval stitching without gaps or overlaps regardless of which task acquired lock first
      const ruleEarlier = allRules.find((r) => Number(r.rewardPercentage) === 0.50);
      const ruleLater = allRules.find((r) => Number(r.rewardPercentage) === 0.75);
      expect(ruleEarlier?.effectiveUntil?.toISOString()).toBe(ruleLater?.effectiveFrom.toISOString());
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
});
