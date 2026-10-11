import { BillService } from '../services/bill.service';
import { RewardService } from '../services/reward.service';
import { PayoutService } from '../services/payout.service';
import { prisma } from '../db';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { areNamesMatching } from '../utils/name.utils';

describe('Part B & C — Global Reward Pool (₹50,000 Combined Hard Cap), Self-Approval Prevention, and Beneficiary Matching', () => {
  const { year, month } = getIstYearAndMonth();

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

    // Reset GlobalRewardPool for the current month
    await prisma.globalRewardPool.upsert({
      where: { global_pool_year_month_unique: { year, month } },
      update: { usedAmount: 0.0, totalPoolCap: 50000.0, isCapped: false },
      create: { year, month, totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
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

    // Create Test Bill Admin
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

    // Clean up test rules if left over
    await prisma.rewardRule.deleteMany({
      where: { id: { in: ['rule_plumber_test', 'rule_tile_test', 'test_rule_plumber', 'test_rule_tile'] } },
    });

    // Enable redemption window
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: { isEnabled: true, minimumAmount: 500, maximumAmount: 10000, startAt: null, endAt: null },
      create: { id: 'default', isEnabled: true, minimumAmount: 500, maximumAmount: 10000 },
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
      where: { mobile: { in: ['9811100001', '9811100002', '9811100003', '9811100004'] } },
    });
    await prisma.rewardRule.deleteMany({
      where: { id: { in: ['rule_plumber_test', 'rule_tile_test', 'test_rule_plumber', 'test_rule_tile'] } },
    });
    await prisma.globalRewardPool.upsert({
      where: { global_pool_year_month_unique: { year, month } },
      update: { usedAmount: 0.0, totalPoolCap: 50000.0, isCapped: false },
      create: { year, month, totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
    });
  });

  describe('1. Global Reward Pool Combined Hard Cap (₹50,000)', () => {
    it('initializes GlobalRewardPool with ₹50,000 cap and 0 usedAmount', async () => {
      const globalPool = await RewardService.getCurrentMonthGlobalPool();
      expect(Number(globalPool.totalPoolCap)).toBe(50000.0);
      expect(Number(globalPool.usedAmount)).toBe(0.0);
      expect(globalPool.isCapped).toBe(false);
    });

    it('draws down shared budget when claiming global monthly pool amount', async () => {
      await prisma.$transaction(async (tx) => {
        await RewardService.claimGlobalMonthlyPoolAmount(tx, 15000.0);
      });

      const analytics = await RewardService.getGlobalPoolAnalytics();
      expect(analytics.usedAmount).toBe(15000.0);
      expect(analytics.remainingAmount).toBe(35000.0);
      expect(analytics.percentageUsed).toBe(30.0);
      expect(analytics.isCapped).toBe(false);
    });

    it('allows secondary profession claim drawing from the same global pool', async () => {
      await prisma.$transaction(async (tx) => {
        await RewardService.claimGlobalMonthlyPoolAmount(tx, 20000.0);
      });

      const analytics = await RewardService.getGlobalPoolAnalytics();
      expect(analytics.usedAmount).toBe(35000.0);
      expect(analytics.remainingAmount).toBe(15000.0);
      expect(analytics.percentageUsed).toBe(70.0);
    });

    it('rejects claim when combined rewards exceed ₹50,000 hard ceiling', async () => {
      // Current used is 35,000. Claiming 20,000 would reach 55,000 > 50,000
      await expect(
        prisma.$transaction(async (tx) => {
          await RewardService.claimGlobalMonthlyPoolAmount(tx, 20000.0);
        })
      ).rejects.toThrow(/Monthly combined rewards pool ceiling of ₹50,000 reached/);

      // Verify rollback occurred: usedAmount is still 35,000
      const analytics = await RewardService.getGlobalPoolAnalytics();
      expect(analytics.usedAmount).toBe(35000.0);
    });

    it('allows claim exactly up to the remaining headroom (₹15,000)', async () => {
      await prisma.$transaction(async (tx) => {
        await RewardService.claimGlobalMonthlyPoolAmount(tx, 15000.0);
      });

      const analytics = await RewardService.getGlobalPoolAnalytics();
      expect(analytics.usedAmount).toBe(50000.0);
      expect(analytics.remainingAmount).toBe(0.0);
      expect(analytics.percentageUsed).toBe(100.0);
      expect(analytics.isCapped).toBe(true);

      // Subsequent claims must be rejected
      await expect(
        prisma.$transaction(async (tx) => {
          await RewardService.claimGlobalMonthlyPoolAmount(tx, 1.0);
        })
      ).rejects.toThrow(/Monthly combined rewards pool ceiling of ₹50,000 reached/);
    });

    it('enforces atomic concurrency boundary when headroom is ₹50: exactly 1 succeeds, 1 rejected, no orphaned credits', async () => {
      // 1. Reset GlobalRewardPool so usedAmount = 49950.0 (exactly ₹50 headroom left)
      await prisma.globalRewardPool.upsert({
        where: { global_pool_year_month_unique: { year, month } },
        update: { usedAmount: 49950.0, totalPoolCap: 50000.0, isCapped: false },
        create: { year, month, totalPoolCap: 50000.0, usedAmount: 49950.0, isCapped: false },
      });

      // Also ensure profession pool has sufficient headroom
      await prisma.rewardPool.upsert({
        where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
        update: { usedAmount: 0.0, totalPoolCap: 50000.0, isCapped: false },
        create: { profession: 'PLUMBER', year, month, totalPoolCap: 50000.0, usedAmount: 0.0, isCapped: false },
      });

      // 2. Create 2 pending bills each for ₹50 reward (0.5% of ₹10,000 = ₹50)
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

      // 3. Concurrently approve both bills
      const results = await Promise.allSettled([
        BillService.approveBill(billA.id, testBillAdmin.id),
        BillService.approveBill(billB.id, testBillAdmin.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectionReason.message).toMatch(/Monthly combined rewards pool ceiling of ₹50,000 reached/);

      // Verify global pool state: usedAmount exactly hits ₹50,000 and isCapped is true
      const analytics = await RewardService.getGlobalPoolAnalytics();
      expect(analytics.usedAmount).toBe(50000.0);
      expect(analytics.remainingAmount).toBe(0.0);
      expect(analytics.isCapped).toBe(true);

      // Verify no orphaned wallet transactions
      const txs = await prisma.walletTransaction.findMany({
        where: {
          referenceId: { in: [billA.id, billB.id] },
        },
      });
      expect(txs.length).toBe(1);
      expect(Number(txs[0].amount)).toBe(50.0);

      // Verify bill statuses: exactly 1 APPROVED and 1 PENDING
      const updatedA = await prisma.bill.findUnique({ where: { id: billA.id } });
      const updatedB = await prisma.bill.findUnique({ where: { id: billB.id } });

      const statuses = [updatedA?.status, updatedB?.status].sort();
      expect(statuses).toEqual(['APPROVED', 'PENDING']);
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
    it('verifies areNamesMatching accurately handles identical and token-reordered Indian names', () => {
      expect(areNamesMatching('Ramesh Kumar', 'Ramesh Kumar')).toBe(true);
      expect(areNamesMatching('Ramesh Kumar', 'RAMESH KUMAR')).toBe(true);
      expect(areNamesMatching('Kumar Ramesh', 'Ramesh Kumar')).toBe(true);
      expect(areNamesMatching('Shri Ramesh Kumar', 'Ramesh Kumar')).toBe(true);
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
