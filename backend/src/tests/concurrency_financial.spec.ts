import { BillService } from '../services/bill.service';
import { RewardService } from '../services/reward.service';
import { PayoutService } from '../services/payout.service';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';
import { prisma } from '../db';
import { getIstYearAndMonth } from '../utils/timezone.utils';

describe('Concurrency & Financial Integrity Tests', () => {
  let craftsmanUser: any;
  let adminUser: any;

  beforeAll(async () => {
    // Clean up
    await prisma.payout.deleteMany({ where: { user: { mobile: '9777777777' } } });
    await prisma.bill.deleteMany({ where: { user: { mobile: '9777777777' } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: '9777777777' } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9777777777' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9777777777' } } });
    await prisma.user.deleteMany({ where: { mobile: '9777777777' } });

    // Create Craftsman
    craftsmanUser = await prisma.user.create({
      data: {
        mobile: '9777777777',
        fullName: 'Concurrency Test Craftsman',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 1000.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    // Create Admin
    adminUser = await prisma.user.upsert({
      where: { mobile: '9999999999' },
      update: { role: 'ADMIN' },
      create: {
        mobile: '9999999999',
        fullName: 'Admin User',
        passwordHash: 'hash',
        role: 'ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    // Enable redemption window
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: { isEnabled: true, minimumAmount: 500, maximumAmount: 10000, startAt: null, endAt: null },
      create: {
        id: 'default',
        isEnabled: true,
        minimumAmount: 500,
        maximumAmount: 10000,
        startAt: null,
        endAt: null,
      },
    });

    // Verify KYC and Payment account
    await KycService.submitPan(craftsmanUser.id, 'ABCDE5678G', 'Concurrency Craftsman');
    await PaymentService.addUpiAccount(craftsmanUser.id, 'concurrency@upi');
  });

  afterAll(async () => {
    await prisma.payout.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.bill.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.kycRecord.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.paymentAccount.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.walletTransaction.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.wallet.deleteMany({ where: { userId: craftsmanUser.id } });
    await prisma.user.deleteMany({ where: { id: craftsmanUser.id } });
  });

  test('1. Monthly Pool Ceiling Race Condition: approvals never exceed ₹50,000 cap under parallel load', async () => {
    const { year, month } = getIstYearAndMonth();

    // Ensure active rule for PLUMBER is 0.50%
    await prisma.rewardRule.updateMany({
      where: { profession: 'PLUMBER', isActive: true },
      data: { isActive: false },
    });
    await prisma.rewardRule.create({
      data: {
        profession: 'PLUMBER',
        rewardPercentage: 0.50,
        monthlyPoolLimit: 50000.0,
        minRedemptionAmount: 500.0,
        maxRedemptionAmount: 10000.0,
        isActive: true,
      },
    });

    // Set pool to exactly ₹49,800 used out of ₹50,000 (headroom = ₹200)
    await prisma.rewardPool.upsert({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      update: {
        totalPoolCap: 50000.0,
        usedAmount: 49800.0,
        isCapped: false,
      },
      create: {
        profession: 'PLUMBER',
        year,
        month,
        totalPoolCap: 50000.0,
        usedAmount: 49800.0,
        isCapped: false,
      },
    });

    // Create 6 bills, each with calculatedReward = ₹100
    const bills = [];
    for (let i = 0; i < 6; i++) {
      const pdfBuffer = Buffer.from(`%PDF-1.4 test invoice parallel ${i} ${Date.now()}`);
      const bill = await BillService.submitBill({
        userId: craftsmanUser.id,
        invoiceNumber: `INV-POOL-RACE-${i}-${Date.now()}`,
        invoiceDate: '2026-10-01',
        billAmount: 20000, // 0.5% = ₹100
        fileBuffer: pdfBuffer,
        fileName: `race_${i}.pdf`,
        mimeType: 'application/pdf',
      });
      bills.push(bill);
    }

    // Fire all 6 approvals concurrently!
    const results = await Promise.allSettled(
      bills.map((b) => BillService.approveBill(b.id, adminUser.id))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Headroom was ₹200. Each bill was ₹100. Exactly 2 should succeed, 4 should fail!
    expect(succeeded.length).toBe(2);
    expect(failed.length).toBe(4);

    // Verify final pool state
    const pool = await prisma.rewardPool.findUnique({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
    });
    expect(Number(pool?.usedAmount)).toBe(50000.0);
    expect(pool?.isCapped).toBe(true);
  });

  test('2. Double Spend Prevention: Concurrent redemptions cannot over-debit wallet or cause negative balance', async () => {
    // Reset wallet to exactly ₹1,000
    await prisma.wallet.update({
      where: { userId: craftsmanUser.id },
      data: {
        availableBalance: 1000.0,
        processingAmount: 0.0,
      },
    });

    // Fire 5 parallel redemption requests of ₹1,000 each with distinct idempotency keys
    const requests = [1, 2, 3, 4, 5].map((i) =>
      PayoutService.requestRedemption(craftsmanUser.id, `idem-race-${i}-${Date.now()}`, 1000)
    );

    const results = await Promise.allSettled(requests);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 must succeed, exactly 4 must be rejected with insufficient balance!
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Wallet balance check
    const finalWallet = await prisma.wallet.findUnique({
      where: { userId: craftsmanUser.id },
    });
    expect(Number(finalWallet?.availableBalance)).toBe(0.0);
    expect(Number(finalWallet?.processingAmount)).toBe(1000.0);
  });

  test('3. Scoped Idempotency: Re-submitting same idempotencyKey returns existing payout without debiting again', async () => {
    // Top up wallet
    await prisma.wallet.update({
      where: { userId: craftsmanUser.id },
      data: {
        availableBalance: 1500.0,
        processingAmount: 0.0,
      },
    });

    const staticKey = `static-idem-${Date.now()}`;

    // Request 1
    const res1 = await PayoutService.requestRedemption(craftsmanUser.id, staticKey, 500);
    expect(res1.payout.id).toBeDefined();
    expect(res1.amountDebited).toBe(500);

    // Request 2 with exact same idempotencyKey
    const res2 = await PayoutService.requestRedemption(craftsmanUser.id, staticKey, 500);
    expect(res2.payout.id).toBe(res1.payout.id);
    expect(res2.message).toContain('existing redemption');

    // Wallet was only debited once (1500 - 500 = 1000)
    const wallet = await prisma.wallet.findUnique({
      where: { userId: craftsmanUser.id },
    });
    expect(Number(wallet?.availableBalance)).toBe(1000.0);
    expect(Number(wallet?.processingAmount)).toBe(500.0);
  });

  test('4. Duplicate Bill Approval Race: Firing 2 concurrent approvals on same bill produces exactly 1 approval and 1 credit', async () => {
    const { year, month } = getIstYearAndMonth();
    await prisma.rewardPool.update({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      data: { usedAmount: 0.0, isCapped: false },
    });

    const pdfBuffer = Buffer.from(`%PDF-1.4 test duplicate approval bill ${Date.now()}`);
    const bill = await BillService.submitBill({
      userId: craftsmanUser.id,
      invoiceNumber: `INV-DUP-APP-${Date.now()}`,
      invoiceDate: '2026-10-01',
      billAmount: 10000, // 0.5% = ₹50
      fileBuffer: pdfBuffer,
      fileName: 'dup_app.pdf',
      mimeType: 'application/pdf',
    });

    const initialWallet = await prisma.wallet.findUnique({ where: { userId: craftsmanUser.id } });
    const initialBal = Number(initialWallet?.availableBalance || 0);

    // Fire 2 approvals concurrently
    const [res1, res2] = await Promise.allSettled([
      BillService.approveBill(bill.id, adminUser.id),
      BillService.approveBill(bill.id, adminUser.id),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify exactly 1 wallet credit transaction
    const txs = await prisma.walletTransaction.findMany({
      where: { referenceId: bill.id, type: 'REWARD_CREDIT' },
    });
    expect(txs.length).toBe(1);

    // Verify wallet balance increased by exactly ₹50
    const finalWallet = await prisma.wallet.findUnique({ where: { userId: craftsmanUser.id } });
    expect(Number(finalWallet?.availableBalance)).toBe(initialBal + 50);
  });

  test('5. Bill Approval vs Rejection Race: Concurrently approving and rejecting same bill allows exactly one terminal transition', async () => {
    const { year, month } = getIstYearAndMonth();
    await prisma.rewardPool.update({
      where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year, month } },
      data: { usedAmount: 0.0, isCapped: false },
    });

    const pdfBuffer = Buffer.from(`%PDF-1.4 test race approve reject bill ${Date.now()}`);
    const bill = await BillService.submitBill({
      userId: craftsmanUser.id,
      invoiceNumber: `INV-RACE-AR-${Date.now()}`,
      invoiceDate: '2026-10-01',
      billAmount: 10000,
      fileBuffer: pdfBuffer,
      fileName: 'race_ar.pdf',
      mimeType: 'application/pdf',
    });

    const [resApprove, resReject] = await Promise.allSettled([
      BillService.approveBill(bill.id, adminUser.id),
      BillService.rejectBill(bill.id, adminUser.id, 'Duplicate invoice submitted'),
    ]);

    const successes = [resApprove, resReject].filter((r) => r.status === 'fulfilled');
    const failures = [resApprove, resReject].filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const finalBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(['APPROVED', 'REJECTED']).toContain(finalBill?.status);
  });

  test('6. Double-Refund Prevention: Concurrently reversing the same payout refunds wallet exactly once', async () => {
    // Top up wallet
    await prisma.wallet.update({
      where: { userId: craftsmanUser.id },
      data: { availableBalance: 1000.0, processingAmount: 0.0 },
    });

    const key = `idem-dbl-rev-${Date.now()}`;
    const redemption = await PayoutService.requestRedemption(craftsmanUser.id, key, 500);
    const payoutId = redemption.payout.id;

    // Concurrent reversePayout calls
    const [rev1, rev2] = await Promise.allSettled([
      PayoutService.reversePayout(payoutId, 'Gateway failure 1'),
      PayoutService.reversePayout(payoutId, 'Gateway failure 2'),
    ]);

    const successes = [rev1, rev2].filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBe(2);

    // Verify wallet: exactly 500 refunded (1000 - 500 + 500 = 1000)
    const wallet = await prisma.wallet.findUnique({ where: { userId: craftsmanUser.id } });
    expect(Number(wallet?.availableBalance)).toBe(1000.0);
    expect(Number(wallet?.processingAmount)).toBe(0.0);

    // Verify exactly 1 PAYOUT_REVERSAL transaction
    const reversalTxs = await prisma.walletTransaction.findMany({
      where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
    });
    expect(reversalTxs.length).toBe(1);
  });
});
