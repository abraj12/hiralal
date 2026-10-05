import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { dbStore } from '../db/store';
import { RewardService } from '../services/reward.service';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);
    const userBills = Array.from(dbStore.bills.values()).filter(b => b.userId === user.id);

    const approvedBills = userBills.filter(b => b.status === 'APPROVED');
    const pendingBills = userBills.filter(b => b.status === 'PENDING' || b.status === 'UNDER_REVIEW');

    const totalApprovedRewards = approvedBills.reduce((acc, b) => acc + b.calculatedReward, 0);
    const processingAmount = pendingBills.reduce((acc, b) => acc + b.calculatedReward, 0);

    // Ledger transactions
    const ledgerTx = Array.from(dbStore.walletTransactions.values())
      .filter(t => t.userId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json({
      success: true,
      summary: {
        totalRewards: Math.round(totalApprovedRewards * 100) / 100,
        processingAmount: Math.round(processingAmount * 100) / 100,
        availableBalance: wallet ? wallet.availableBalance : 0,
        totalRedeemed: wallet ? wallet.totalRedeemed : 0,
        billsApprovedCount: approvedBills.length,
        billsPendingCount: pendingBills.length,
        totalBillsCount: userBills.length,
      },
      recentRewards: approvedBills.slice(0, 10).map(b => ({
        id: b.id,
        invoiceNumber: b.invoiceNumber,
        invoiceDate: b.invoiceDate,
        billAmount: b.billAmount,
        rewardAmount: b.calculatedReward,
        status: b.status,
        createdAt: b.createdAt,
      })),
      ledger: ledgerTx,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pool', async (req, res) => {
  try {
    const analytics = RewardService.getPoolAnalytics();
    res.json({ success: true, pool: analytics });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
