import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../db';
import { RewardService } from '../services/reward.service';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
    });

    const userBills = await prisma.bill.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    const approvedBills = userBills.filter((b) => b.status === 'APPROVED');
    const pendingBills = userBills.filter((b) => b.status === 'PENDING' || b.status === 'UNDER_REVIEW');

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
        billsApprovedCount: approvedBills.length,
        billsPendingCount: pendingBills.length,
        totalBillsCount: userBills.length,
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
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pool', async (req, res) => {
  res.json({
    success: true,
    message: 'Monthly reward pool limit is retired. Approved rewards are credited in full to user wallets without pool capping.',
  });
});

export default router;
