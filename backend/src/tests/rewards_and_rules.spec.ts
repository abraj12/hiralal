import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage.service';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { prisma } from '../db';
import crypto from 'crypto';

import { generateBlindIndex } from '../utils/crypto.utils';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('Hiralal & Sons Production Business Logic & Integrity Tests', () => {
  let testUserId: string;
  let testAdminId: string;

  beforeAll(async () => {
    // Clean up test records
    await prisma.payout.deleteMany({ where: { user: { mobile: '9888888888' } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: '9888888888' } } });
    await prisma.kycRecord.deleteMany({
      where: {
        OR: [
          { user: { mobile: '9888888888' } },
          { panNumber: 'ABCDE1234F' },
          { panBlindIndex: generateBlindIndex('ABCDE1234F') },
        ],
      },
    });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9888888888' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9888888888' } } });
    await prisma.user.deleteMany({ where: { mobile: '9888888888' } });
    await prisma.rewardRule.deleteMany({
      where: {
        OR: [
          { id: { in: ['test_rule_plumber', 'test_rule_tile', 'rule_plumber_test', 'rule_tile_test'] } },
          { profession: 'PLUMBER', version: { gt: 1 } },
        ],
      },
    });


    // Provision admin user for audit log foreign keys
    const admin = await getOrCreateOpsAdmin(prisma);
    testAdminId = admin.id;

    // Create a real test plumber
    const user = await prisma.user.create({
      data: {
        mobile: '9888888888',
        fullName: 'Test Plumber',
        passwordHash: 'testhash',
        profession: 'PLUMBER',
        role: 'USER',
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
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.payout.deleteMany({ where: { userId: testUserId } });
      await prisma.walletTransaction.deleteMany({ where: { userId: testUserId } });
      await prisma.bill.deleteMany({ where: { userId: testUserId } });
      await prisma.kycRecord.deleteMany({ where: { userId: testUserId } });
      await prisma.paymentAccount.deleteMany({ where: { userId: testUserId } });
      await prisma.wallet.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
    await prisma.$disconnect();
  });

  describe('1. Server-side Reward Calculation Engine', () => {
    test('Calculates exact 0.5% reward for ₹100,000 bill = ₹500', () => {
      const reward = RewardService.calculateReward(100000, 0.5);
      expect(reward).toBe(500.0);
    });

    test('Calculates exact 0.5% reward for ₹25,000 bill = ₹125', () => {
      const reward = RewardService.calculateReward(25000, 0.5);
      expect(reward).toBe(125.0);
    });

    test('Calculates exact 0.5% reward for ₹12,500 bill = ₹62.5', () => {
      const reward = RewardService.calculateReward(12500, 0.5);
      expect(reward).toBe(62.5);
    });
  });

  describe('2. Dynamic Profession Reward Rules & Versioning', () => {
    test('Retrieves active versioned rules for professions', async () => {
      const plumberRule = await RewardService.getRewardRule('PLUMBER');
      expect(plumberRule.profession).toBe('PLUMBER');
      expect(plumberRule.rewardPercentage).toBeGreaterThan(0);

      const tileRule = await RewardService.getRewardRule('TILE_INSTALLER');
      expect(tileRule.profession).toBe('TILE_INSTALLER');
      expect(tileRule.rewardPercentage).toBeGreaterThan(0);
    });

    test('Updates reward rules for profession without pool limit constraints', async () => {
      const updated = await RewardService.updateRewardRules(testAdminId, {
        percentage: 0.55,
        profession: 'PLUMBER',
      });
      expect(Number(updated.rewardPercentage)).toBe(0.55);
    });
  });

  describe('3. Bill Upload & Duplicate Detection', () => {
    test('Computes SHA-256 hash for uploaded file', () => {
      const buf = Buffer.from('TEST INVOICE DATA FOR HIRALAL');
      const hash = StorageService.calculateFileHash(buf);
      expect(hash).toHaveLength(64);
    });

    test('Rejects duplicate invoice number for the same user', async () => {
      const invoiceNumber = `INV-TEST-${Date.now()}`;
      const buf1 = Buffer.from(`%PDF-1.4 Doc content 1 - ${Date.now()}`);

      await BillService.submitBill({
        userId: testUserId,
        invoiceNumber,
        invoiceDate: '2026-10-01',
        billAmount: 10000,
        fileBuffer: buf1,
        fileName: 'inv1.pdf',
        mimeType: 'application/pdf',
      });

      const buf2 = Buffer.from(`%PDF-1.4 Doc content 2 - ${Date.now()}`);
      await expect(
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber,
          invoiceDate: '2026-10-02',
          billAmount: 10000,
          fileBuffer: buf2,
          fileName: 'inv2.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/undergoing review|already been/);
    });

    test('Rejects duplicate file upload by SHA-256 hash', async () => {
      const sameBuffer = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from(`Identical document bytes ${Date.now()}`),
      ]);

      await BillService.submitBill({
        userId: testUserId,
        invoiceNumber: `INV-UNIQUE-1-${Date.now()}`,
        invoiceDate: '2026-10-01',
        billAmount: 15000,
        fileBuffer: sameBuffer,
        fileName: 'doc1.jpg',
        mimeType: 'image/jpeg',
      });

      await expect(
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber: `INV-UNIQUE-2-${Date.now()}`,
          invoiceDate: '2026-10-01',
          billAmount: 15000,
          fileBuffer: sameBuffer,
          fileName: 'doc2.jpg',
          mimeType: 'image/jpeg',
        })
      ).rejects.toThrow(/already been uploaded to the system/);
    });

    test('Bill rejection requires mandatory rejection reason', async () => {
      const buf = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from(`Doc for rejection - ${Date.now()}`),
      ]);
      const bill = await BillService.submitBill({
        userId: testUserId,
        invoiceNumber: `INV-REJECT-${Date.now()}`,
        invoiceDate: '2026-10-01',
        billAmount: 5000,
        fileBuffer: buf,
        fileName: 'doc.jpg',
        mimeType: 'image/jpeg',
      });

      await expect(BillService.rejectBill(bill.id, testAdminId, '')).rejects.toThrow(/rejection reason/);

      const rejected = await BillService.rejectBill(bill.id, testAdminId, 'Blurry unreadable bill photo');
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Blurry unreadable bill photo');
    });
  });

  describe('4. Admin Configurable Redemption Window Enforcement', () => {
    test('Enforces window: rejects when isEnabled is false', async () => {
      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: { isEnabled: false },
        create: { id: 'default', isEnabled: false },
      });

      const { isWindowOpen } = await PayoutService.getRedemptionSettings();
      expect(isWindowOpen).toBe(false);

      const eligibility = await PayoutService.checkUserEligibility(testUserId);
      expect(eligibility.canRedeem).toBe(false);
    });

    test('Allows redemption when window is open and user is verified', async () => {
      // Open window
      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: {
          isEnabled: true,
          startAt: new Date(Date.now() - 3600 * 1000),
          endAt: new Date(Date.now() + 3600 * 1000),
        },
        create: {
          id: 'default',
          isEnabled: true,
        },
      });

      // Add verified KYC and Payment Account for test user
      await KycService.submitPan(testUserId, 'ABCDE1234F', 'Test Plumber');
      await PaymentService.addUpiAccount(testUserId, 'testplumber@okhdfcbank');

      const eligibility = await PayoutService.checkUserEligibility(testUserId);
      expect(eligibility.canRedeem).toBe(true);
      expect(eligibility.availableBalance).toBeGreaterThanOrEqual(500);
    });
  });

  describe('5. Payout Idempotency & Balance Reversal', () => {
    test('Payout reversal restores wallet availableBalance and creates PAYOUT_REVERSAL ledger entry', async () => {
      const walletBefore = await prisma.wallet.findUnique({
        where: { userId: testUserId },
      });
      const initialAvailable = Number(walletBefore?.availableBalance || 0);

      const idempotencyKey = `idem-test-${Date.now()}`;
      const result = await PayoutService.requestRedemption(testUserId, idempotencyKey);

      // Trigger reversal
      await PayoutService.reversePayout(result.payout.id, 'Test reversal bank rejection');

      const updatedWallet = await prisma.wallet.findUnique({
        where: { userId: testUserId },
      });

      expect(Number(updatedWallet?.availableBalance)).toBe(initialAvailable);

      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: result.payout.id, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).not.toBeNull();
      expect(Number(reversalTx?.amount)).toBe(initialAvailable);
    });
  });

  describe('6. TEST-003: High-Concurrency Invoice and Hash Race Condition Safeguards', () => {
    test('Parallel submissions of identical invoice number: exactly one succeeds and concurrent duplicate is rejected', async () => {
      const invoiceNumber = `INV-RACE-${Date.now()}`;
      const dummyPdfHeader = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
      const buf1 = Buffer.concat([dummyPdfHeader, Buffer.from(`unique-seed-1-${Date.now()}`)]);
      const buf2 = Buffer.concat([dummyPdfHeader, Buffer.from(`unique-seed-2-${Date.now()}`)]);

      const [res1, res2] = await Promise.allSettled([
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber,
          invoiceDate: '2026-10-23',
          billAmount: 1500.0,
          fileBuffer: buf1,
          fileName: 'invoice1.pdf',
          mimeType: 'application/pdf',
        }),
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber,
          invoiceDate: '2026-10-23',
          billAmount: 1500.0,
          fileBuffer: buf2,
          fileName: 'invoice2.pdf',
          mimeType: 'application/pdf',
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
        /undergoing review|already been approved|duplicate/i
      );
    });

    test('Parallel submissions with identical document file hash: concurrent duplicate document is rejected', async () => {
      const dummyPdfHeader = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
      const identicalBuf = Buffer.concat([dummyPdfHeader, Buffer.from(`identical-hash-${Date.now()}`)]);

      const [res1, res2] = await Promise.allSettled([
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber: `INV-HASH1-${Date.now()}`,
          invoiceDate: '2026-10-23',
          billAmount: 2000.0,
          fileBuffer: identicalBuf,
          fileName: 'same1.pdf',
          mimeType: 'application/pdf',
        }),
        BillService.submitBill({
          userId: testUserId,
          invoiceNumber: `INV-HASH2-${Date.now()}`,
          invoiceDate: '2026-10-23',
          billAmount: 2000.0,
          fileBuffer: identicalBuf,
          fileName: 'same2.pdf',
          mimeType: 'application/pdf',
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
        'Duplicate documents are rejected'
      );
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
