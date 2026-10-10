import { prisma } from '../db';

describe('Phase 7 — Restore Financial Reconciliation & Payout Ledger Correlation', () => {
  let testUser: any;
  let testWallet: any;
  let testPayoutId: string;
  let testIdempotencyKey: string;

  beforeAll(async () => {
    // Clean up test data
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: '9555511111' } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.user.deleteMany({
      where: { mobile: '9555511111' },
    });

    testUser = await prisma.user.create({
      data: {
        mobile: '9555511111',
        fullName: 'Reconciliation Tester',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
      },
    });

    testWallet = await prisma.wallet.create({
      data: {
        userId: testUser.id,
        availableBalance: 1500.0,
        processingAmount: 0.0,
        totalRedeemed: 500.0,
      },
    });

    const account = await prisma.paymentAccount.create({
      data: {
        userId: testUser.id,
        accountType: 'UPI',
        upiId: 'recon@upi',
        maskedInfo: 'rec***@upi',
        isVerified: true,
      },
    });

    testIdempotencyKey = 'idemp_pout_recon_test_1';
    const payout = await prisma.payout.create({
      data: {
        userId: testUser.id,
        walletId: testWallet.id,
        paymentAccountId: account.id,
        amount: 500.0,
        paymentType: 'UPI',
        idempotencyKey: testIdempotencyKey,
        status: 'SUCCESS',
      },
    });
    testPayoutId = payout.id;

    // Credit transaction (Reward) +2000
    await prisma.walletTransaction.create({
      data: {
        walletId: testWallet.id,
        userId: testUser.id,
        amount: 2000.0,
        type: 'REWARD_CREDIT',
        balanceAfter: 2000.0,
        referenceType: 'BILL',
        referenceId: 'bill_recon_1',
        description: 'Approved bill reward',
      },
    });

    // Debit transaction with like-for-like internal payout.id reference (-500)
    await prisma.walletTransaction.create({
      data: {
        walletId: testWallet.id,
        userId: testUser.id,
        amount: 500.0,
        type: 'PAYOUT_DEBIT',
        balanceAfter: 1500.0,
        referenceType: 'PAYOUT',
        referenceId: testPayoutId, // Using internal payout.id as written by payout.service.ts
        description: 'Redemption debit for payout',
      },
    });
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: '9555511111' } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: '9555511111' } },
    });
    await prisma.user.deleteMany({
      where: { mobile: '9555511111' },
    });
  });

  it('validates that payout debit ledger correlates with payout.id (internal ID)', async () => {
    // SQL query matching the corrected restore-db.sh verification logic
    const matchingDebits: any[] = await prisma.$queryRaw`
      SELECT p.id, p.status, p.amount, count(t.id)::int as debit_count
      FROM "Payout" p
      JOIN "WalletTransaction" t
        ON t."walletId" = p."walletId"
       AND t.type = 'PAYOUT_DEBIT'
       AND (t."referenceId" = p.id OR t."referenceId" = p."idempotencyKey")
      WHERE p.id = ${testPayoutId}
      GROUP BY p.id, p.status, p.amount;
    `;

    expect(matchingDebits.length).toBe(1);
    expect(matchingDebits[0].debit_count).toBe(1);
    expect(Number(matchingDebits[0].amount)).toBe(500.0);
  });

  it('validates wallet financial reconciliation: availableBalance == sum of ledger transactions', async () => {
    const reconResults: any[] = await prisma.$queryRaw`
      SELECT w.id, w."availableBalance",
        COALESCE(SUM(CASE
          WHEN t.type = 'REWARD_CREDIT' THEN t.amount
          WHEN t.type = 'PAYOUT_REVERSAL' THEN t.amount
          WHEN t.type = 'REFUND' THEN t.amount
          WHEN t.type = 'MANUAL_ADJUSTMENT' THEN t.amount
          WHEN t.type = 'PAYOUT_DEBIT' THEN -t.amount
          ELSE 0 END), 0) AS calculated_balance
      FROM "Wallet" w
      LEFT JOIN "WalletTransaction" t ON w.id = t."walletId"
      WHERE w.id = ${testWallet.id}
      GROUP BY w.id, w."availableBalance";
    `;

    expect(reconResults.length).toBe(1);
    expect(Number(reconResults[0].availableBalance)).toBe(1500.0);
    expect(Number(reconResults[0].calculated_balance)).toBe(1500.0);
  });
});
