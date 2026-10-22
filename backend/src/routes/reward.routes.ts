import { Router, Response } from 'express';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../db';

const router = Router();

router.get('/', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
    });

    const [billsApprovedCount, billsPendingCount, totalBillsCount] = await Promise.all([
      prisma.bill.count({ where: { userId: user.id, status: 'APPROVED' } }),
      prisma.bill.count({ where: { userId: user.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
      prisma.bill.count({ where: { userId: user.id } }),
    ]);

    const approvedBills = await prisma.bill.findMany({
      where: { userId: user.id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const totalRewardCredits = await prisma.walletTransaction.aggregate({
      where: {
        userId: user.id,
        type: 'REWARD_CREDIT',
      },
      _sum: {
        amount: true,
      },
    });
    const totalApprovedRewards = approvedBills.reduce((acc, b) => acc + Number(b.calculatedReward || 0), 0);
    const lifetimeCashback = Number(totalRewardCredits._sum.amount || totalApprovedRewards || 0);
    const processingAmount = wallet ? Number(wallet.processingAmount) : 0;

    const ledgerTx = await prisma.walletTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({
      success: true,
      summary: {
        lifetimeCashback: Math.round(lifetimeCashback * 100) / 100,
        totalRewards: Math.round(lifetimeCashback * 100) / 100,
        processingAmount: Math.round(processingAmount * 100) / 100,
        pendingRedemptionAmount: Math.round(processingAmount * 100) / 100,
        availableBalance: wallet ? Number(wallet.availableBalance) : 0,
        totalRedeemed: wallet ? Number(wallet.totalRedeemed) : 0,
        billsApprovedCount,
        billsPendingCount,
        totalBillsCount,
      },
      recentRewards: approvedBills.slice(0, 10).map((b) => ({
        id: b.id,
        invoiceNumber: b.invoiceNumber,
        invoiceDate: b.invoiceDate,
        billAmount: Number(b.billAmount),
        rewardAmount: Number(b.calculatedReward),
        status: b.status,
        createdAt: b.createdAt,
      })),
      ledger: ledgerTx.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        type: t.type,
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        createdAt: t.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve reward history. Please retry.' });
  }
});

export default router;
