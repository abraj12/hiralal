import request from 'supertest';
import { app } from '../server';
import { BillService } from '../services/bill.service';
import { RewardService } from '../services/reward.service';
import { PayoutService } from '../services/payout.service';
import { prisma } from '../db';
import { areNamesMatching } from '../utils/name.utils';
import jwt from 'jsonwebtoken';
import { config } from '../config';

describe('Part B & C — Pool-Free Reward Integrity, Volume Scaling, Self-Approval Prevention, and Beneficiary Matching', () => {
  let testPlumber: any;
  let testTileInstaller: any;
  let testBillAdmin: any;
  let testSuspendedUser: any;

  beforeAll(async () => {
    // Clean up test data
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } },
    });

    // Create Test Plumber
    testPlumber = await prisma.user.create({
      data: {
        mobile: '9811100001',
        fullName: 'Ramesh Kumar Plumber',
        passwordHash: 'hash_test_plumber',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: { create: { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 } },
      },
    });

    // Create Test Tile Installer
    testTileInstaller = await prisma.user.create({
      data: {
        mobile: '9811100002',
        fullName: 'Suresh Verma TileWorker',
        passwordHash: 'hash_test_tile',
        profession: 'TILE_INSTALLER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: { create: { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 } },
      },
    });

    // Find or create Test Bill Admin
    const existingBill = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (existingBill) {
      testBillAdmin = existingBill;
    } else {
      testBillAdmin = await prisma.user.create({
        data: {
          mobile: '9811100003',
          fullName: 'Bill Admin SelfApproval Test',
          passwordHash: 'hash_test_admin',
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    // Create Suspended User
    testSuspendedUser = await prisma.user.create({
      data: {
        mobile: '9811100004',
        fullName: 'Suspended Worker',
        passwordHash: 'hash_test_suspended',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'SUSPENDED',
        isVerified: true,
      },
    });

    // Clean up and establish deterministic baseline 0.50% reward rules
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

    // Enable redemption window
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
      },
      create: {
        id: 'default',
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
      },
    });
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9811100001', '9811100002', '9811100004'] } },
    });
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
  });

  describe('1. Pool-Free Reward Integrity & High-Volume Scaling', () => {
    it('approves valid bill and credits full reward without any reward pool checks', async () => {
      const bill = await prisma.bill.create({
        data: {
          userId: testPlumber.id,
          invoiceNumber: `INV-NOPOOL-1-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 20000,
          grossBillAmount: 20000,
          calculatedReward: 100,
          status: 'PENDING',
          fileUrl: 'https://storage/nopool-1.pdf',
          fileKey: 'bills/nopool-1.pdf',
          fileHash: `hash_nopool_1_${Date.now()}`,
        },
      });

      const initialWallet = await prisma.wallet.findUnique({ where: { userId: testPlumber.id } });
      const initialBal = Number(initialWallet?.availableBalance || 0);

      const approvalRes = await BillService.approveBill(bill.id, testBillAdmin.id);
      expect(approvalRes.bill.status).toBe('APPROVED');
      expect(Number(approvalRes.bill.calculatedReward)).toBe(100.0);

      const finalWallet = await prisma.wallet.findUnique({ where: { userId: testPlumber.id } });
      expect(Number(finalWallet?.availableBalance)).toBe(initialBal + 100.0);

      const tx = await prisma.walletTransaction.findFirst({
        where: { referenceId: bill.id, type: 'REWARD_CREDIT' },
      });
      expect(tx).toBeDefined();
      expect(Number(tx?.amount)).toBe(100.0);
    });

    it('approves large volume rewards exceeding ₹50,000 threshold without any pool constraint', async () => {
      const highValBill = await prisma.bill.create({
        data: {
          userId: testTileInstaller.id,
          invoiceNumber: `INV-HIGHVOL-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 12000000,
          grossBillAmount: 12000000,
          calculatedReward: 60000,
          status: 'PENDING',
          fileUrl: 'https://storage/highvol.pdf',
          fileKey: 'bills/highvol.pdf',
          fileHash: `hash_highvol_${Date.now()}`,
        },
      });

      const initialWallet = await prisma.wallet.findUnique({ where: { userId: testTileInstaller.id } });
      const initialBal = Number(initialWallet?.availableBalance || 0);

      const approvalRes = await BillService.approveBill(highValBill.id, testBillAdmin.id);
      expect(approvalRes.bill.status).toBe('APPROVED');
      const rewardCredited = Number(approvalRes.bill.calculatedReward);
      expect(rewardCredited).toBeGreaterThan(50000.0);

      const updatedWallet = await prisma.wallet.findUnique({ where: { userId: testTileInstaller.id } });
      expect(Number(updatedWallet?.availableBalance)).toBe(initialBal + rewardCredited);
    });

    it('allows concurrent bill approvals to succeed simultaneously with zero pool contention', async () => {
      const billA = await prisma.bill.create({
        data: {
          userId: testPlumber.id,
          invoiceNumber: `INV-CONCUR-A-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 10000,
          grossBillAmount: 10000,
          calculatedReward: 50,
          status: 'PENDING',
          fileUrl: 'https://storage/concurrent-a.pdf',
          fileKey: 'bills/concurrent-a.pdf',
          fileHash: `hash_concur_a_${Date.now()}`,
        },
      });

      const billB = await prisma.bill.create({
        data: {
          userId: testPlumber.id,
          invoiceNumber: `INV-CONCUR-B-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 10000,
          grossBillAmount: 10000,
          calculatedReward: 50,
          status: 'PENDING',
          fileUrl: 'https://storage/concurrent-b.pdf',
          fileKey: 'bills/concurrent-b.pdf',
          fileHash: `hash_concur_b_${Date.now()}`,
        },
      });

      const results = await Promise.allSettled([
        BillService.approveBill(billA.id, testBillAdmin.id),
        BillService.approveBill(billB.id, testBillAdmin.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(0);

      const updatedA = await prisma.bill.findUnique({ where: { id: billA.id } });
      const updatedB = await prisma.bill.findUnique({ where: { id: billB.id } });
      expect(updatedA?.status).toBe('APPROVED');
      expect(updatedB?.status).toBe('APPROVED');
    });

    it('strictly rejects any verify request attempting customRewardAmount override with HTTP 400', async () => {
      const billToVerify = await prisma.bill.create({
        data: {
          userId: testPlumber.id,
          invoiceNumber: `INV-CUSTOM-OVERRIDE-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 10000,
          grossBillAmount: 10000,
          calculatedReward: 50,
          status: 'PENDING',
          fileUrl: 'https://storage/custom-test.pdf',
          fileKey: 'bills/custom-test.pdf',
          fileHash: `hash_custom_${Date.now()}`,
        },
      });

      const adminToken = jwt.sign(
        { userId: testBillAdmin.id, role: 'BILL_ADMIN' },
        config.admin.accessSecret
      );

      const response = await request(app)
        .post(`/api/admin/bills/${billToVerify.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'APPROVE',
          customRewardAmount: 500.0,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/custom reward overrides/i);

      const checkBill = await prisma.bill.findUnique({ where: { id: billToVerify.id } });
      expect(checkBill?.status).toBe('PENDING');
    });
  });

  describe('2. Bill Submission & Self-Approval Prevention', () => {
    it('rejects bill submission by non-USER role (admin account)', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4 test invoice file buffer content');
      await expect(
        BillService.submitBill({
          userId: testBillAdmin.id,
          invoiceNumber: 'INV-ADMIN-001',
          invoiceDate: '2026-10-10',
          billAmount: 10000,
          fileBuffer: dummyBuffer,
          fileName: 'invoice.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow('Only registered users can submit bills for rewards.');
    });

    it('rejects bill submission by suspended user', async () => {
      const dummyBuffer = Buffer.from('%PDF-1.4 suspended invoice file buffer content');
      await expect(
        BillService.submitBill({
          userId: testSuspendedUser.id,
          invoiceNumber: 'INV-SUSPEND-001',
          invoiceDate: '2026-10-10',
          billAmount: 5000,
          fileBuffer: dummyBuffer,
          fileName: 'invoice.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow('User account is suspended or inactive.');
    });

    it('rejects self-approval when admin attempts to approve bill submitted under their own account', async () => {
      // Clean up previous test bill if any
      await prisma.bill.deleteMany({ where: { invoiceNumber: 'INV-SELF-APPROVE-TEST' } });
      // Create a bill directly for testing
      const bill = await prisma.bill.create({
        data: {
          userId: testBillAdmin.id,
          invoiceNumber: 'INV-SELF-APPROVE-TEST',
          invoiceDate: new Date(),
          billAmount: 10000,
          grossBillAmount: 10000,
          calculatedReward: 50,
          status: 'PENDING',
          fileUrl: 'https://storage/self.pdf',
          fileKey: 'bills/self.pdf',
          fileHash: 'sha256_mock_hash_self_approve',
        },
      });

      await expect(
        BillService.approveBill(bill.id, testBillAdmin.id)
      ).rejects.toThrow('Administrators cannot approve bills submitted under their own account.');
    });
  });

  describe('3. Payment Account Beneficiary Matching (Part C)', () => {
    it('verifies areNamesMatching strictly enforces exact normalized PAN to bank matching and rejects fuzzy/reordered names', () => {
      expect(areNamesMatching('Ramesh Kumar', 'Ramesh Kumar')).toBe(true);
      expect(areNamesMatching('Ramesh Kumar', 'RAMESH KUMAR')).toBe(true);
      expect(areNamesMatching('Shri Ramesh Kumar', 'Ramesh Kumar')).toBe(true);
      expect(areNamesMatching('Kumar Ramesh', 'Ramesh Kumar')).toBe(false);
      expect(areNamesMatching('R K Sharma', 'Rajesh Kumar Sharma')).toBe(false);
      expect(areNamesMatching('Rahul Singh', 'Rahul Kumar Singh')).toBe(false);
      expect(areNamesMatching('Amit Kumar', 'Amit Kumar Verma')).toBe(false);
      expect(areNamesMatching('Ramesh Kumar', 'Vijay Mallya')).toBe(false);
    });

    it('rejects payout eligibility when registered payment account beneficiary does not match verified PAN name', async () => {
      // Setup verified KYC for plumber
      await prisma.kycRecord.create({
        data: {
          userId: testPlumber.id,
          panNumber: 'ABCDE1234F',
          panName: 'RAMESH KUMAR',
          verifiedName: 'RAMESH KUMAR',
          panStatus: 'VERIFIED',
          maskedPan: 'ABCDE••••F',
          nameMatched: true,
          consent: true,
        },
      });

      // Credit wallet
      await prisma.wallet.update({
        where: { userId: testPlumber.id },
        data: { availableBalance: 2000.0 },
      });

      // Add payment account with mismatched beneficiary name
      const mismatchedAccount = await prisma.paymentAccount.create({
        data: {
          userId: testPlumber.id,
          accountType: 'UPI',
          upiId: 'differentperson@okhdfcbank',
          accountHolderName: 'VIJAY MALLYA',
          providerRegisteredName: 'VIJAY MALLYA',
          providerNameVerified: true,
          maskedInfo: 'dif****@okhdfcbank',
          isVerified: true,
          isDefault: true,
        },
      });

      const eligibility = await PayoutService.checkUserEligibility(testPlumber.id);
      expect(eligibility.canRedeem).toBe(false);
      expect(eligibility.reason).toBe('Registered payment account beneficiary name does not match verified PAN name.');

      // Also verify requestRedemption rejects
      await expect(
        PayoutService.requestRedemption(testPlumber.id, 'idempotency_mismatch_test_key_12345')
      ).rejects.toThrow('Registered payment account beneficiary name does not match verified PAN name.');

      // Clean up mismatched account
      await prisma.paymentAccount.delete({ where: { id: mismatchedAccount.id } });
    });

    it('rejects payout eligibility when payment account providerNameVerified is false', async () => {
      const unverifiedProviderAccount = await prisma.paymentAccount.create({
        data: {
          userId: testPlumber.id,
          accountType: 'UPI',
          upiId: 'rameshkumar@okhdfcbank',
          accountHolderName: 'Ramesh Kumar',
          providerRegisteredName: 'RAMESH KUMAR',
          providerNameVerified: false,
          maskedInfo: 'ram****@okhdfcbank',
          isVerified: true,
          isDefault: true,
        },
      });

      const eligibility = await PayoutService.checkUserEligibility(testPlumber.id);
      expect(eligibility.canRedeem).toBe(false);
      expect(eligibility.reason).toContain('The payment account beneficiary name has not been verified by the payment provider');

      await expect(
        PayoutService.requestRedemption(testPlumber.id, 'idempotency_unverified_prov_123')
      ).rejects.toThrow(/The payment account beneficiary name has not been verified by the payment provider/);

      await prisma.paymentAccount.delete({ where: { id: unverifiedProviderAccount.id } });
    });

    it('allows payout eligibility and redemption when beneficiary name matches verified PAN name', async () => {
      // Add matching payment account
      await prisma.paymentAccount.create({
        data: {
          userId: testPlumber.id,
          accountType: 'UPI',
          upiId: 'rameshkumar@okhdfcbank',
          accountHolderName: 'Ramesh Kumar',
          providerRegisteredName: 'RAMESH KUMAR',
          providerNameVerified: true,
          maskedInfo: 'ram****@okhdfcbank',
          isVerified: true,
          isDefault: true,
        },
      });

      const eligibility = await PayoutService.checkUserEligibility(testPlumber.id);
      expect(eligibility.canRedeem).toBe(true);

      const redemptionResult = await PayoutService.requestRedemption(
        testPlumber.id,
        'idempotency_matching_test_key_12345678'
      );
      expect(redemptionResult.payout).toBeDefined();
      expect(redemptionResult.amountDebited).toBe(2000.0);
    });
  });
});
