import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { getOrCreateBillAdmin } from './test_helpers';
import bcrypt from 'bcryptjs';

describe('Finding 15 Regression Suite: Ledger Deficit Offset Double-Entry Continuity', () => {
  const testMobile = '9800000501';
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    const billAdmin = await getOrCreateBillAdmin(prisma);
    adminId = billAdmin.id;

    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    const passwordHash = await bcrypt.hash('TestPassword@123', 10);
    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        passwordHash,
        fullName: 'Deficit Offset User',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
      },
    });
    userId = user.id;

    // Seed wallet with 0 availableBalance and 40 deficitLiability
    await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 0.0,
        deficitLiability: 40.0,
        processingAmount: 0.0,
        totalRedeemed: 0.0,
      },
    });

    // Ensure reward rule for PLUMBER at exactly 5%
    await prisma.rewardRule.updateMany({
      where: { profession: 'PLUMBER', isActive: true },
      data: { rewardPercentage: 5.0 },
    });
    const count = await prisma.rewardRule.count({
      where: { profession: 'PLUMBER', isActive: true },
    });
    if (count === 0) {
      await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 5.0,
          effectiveFrom: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      });
    }
  });

  afterAll(async () => {
    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it('records distinct REWARD_CREDIT and DEFICIT_OFFSET ledger entries preserving balance continuity', async () => {
    // Submit bill of ₹2,000 -> 5% reward = ₹100
    const bill = await BillService.submitBill({
      userId,
      invoiceNumber: 'INV-DEFICIT-001',
      invoiceDate: '2026-10-01',
      billAmount: 2000,
      fileBuffer: Buffer.from('%PDF-1.4 dummy bill deficit test content'),
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
    });

    // Approve bill
    const approved = await BillService.approveBill(bill.id, adminId, {
      gstIncluded: false,
    });

    expect(Number(approved.creditedReward)).toBe(100.0);
    // Net credited to balance: 100 - 40 deficit offset = 60
    expect(Number(approved.walletBalance)).toBe(60.0);

    const updatedWallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(updatedWallet?.availableBalance)).toBe(60.0);
    expect(Number(updatedWallet?.deficitLiability)).toBe(0.0);

    // Verify double-entry ledger transactions
    const txs = await prisma.walletTransaction.findMany({
      where: { userId, referenceId: bill.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(txs).toHaveLength(2);

    const creditTx = txs[0];
    expect(creditTx.type).toBe('REWARD_CREDIT');
    expect(Number(creditTx.amount)).toBe(100.0);
    expect(Number(creditTx.balanceAfter)).toBe(100.0); // 0 + 100 = 100

    const offsetTx = txs[1];
    expect(offsetTx.type).toBe('DEFICIT_OFFSET');
    expect(Number(offsetTx.amount)).toBe(40.0);
    expect(Number(offsetTx.balanceAfter)).toBe(60.0); // 100 - 40 = 60

    // Mathematical continuity check:
    // previousBalance (0) + creditTx.amount (100) = creditTx.balanceAfter (100)
    // creditTx.balanceAfter (100) - offsetTx.amount (40) = offsetTx.balanceAfter (60)
    expect(0 + Number(creditTx.amount)).toBe(Number(creditTx.balanceAfter));
    expect(Number(creditTx.balanceAfter) - Number(offsetTx.amount)).toBe(Number(offsetTx.balanceAfter));
  });
});
