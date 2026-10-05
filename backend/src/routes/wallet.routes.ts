import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { dbStore } from '../db/store';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    let wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);

    if (!wallet) {
      wallet = {
        id: `wallet-${user.id}`,
        userId: user.id,
        availableBalance: 0,
        processingAmount: 0,
        totalRedeemed: 0,
        version: 1,
        updatedAt: new Date(),
      };
      dbStore.wallets.set(wallet.id, wallet);
    }

    const transactions = Array.from(dbStore.walletTransactions.values())
      .filter(t => t.userId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json({
      success: true,
      wallet: {
        availableBalance: wallet.availableBalance,
        processingAmount: wallet.processingAmount,
        totalRedeemed: wallet.totalRedeemed,
        updatedAt: wallet.updatedAt,
      },
      transactions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
