import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { PayoutService } from '../services/payout.service';
import { prisma } from '../db';

const router = Router();

/**
 * Check user redemption eligibility and active window status
 */
router.get('/eligibility', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const eligibility = await PayoutService.checkUserEligibility(user.id);
    res.json({ success: true, ...eligibility });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Request Reward Redemption
 * Backend determines verified recipient account, checks window, and enforces server-controlled payout amount.
 */
router.post('/redeem', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { idempotencyKey, amount } = req.body;

    const cleanKey = (idempotencyKey && String(idempotencyKey).trim()) || `idem-${Date.now()}-${user.id.substring(0, 8)}`;
    const parsedAmount = amount ? parseFloat(amount) : undefined;

    const result = await PayoutService.requestRedemption(user.id, cleanKey, parsedAmount);

    res.status(201).json({
      success: true,
      message: 'Redemption initiated successfully. Disbursement dispatched to your verified account.',
      payout: result.payout,
      amountDebited: result.amountDebited,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * Get user payout disbursement history
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const payouts = await prisma.payout.findMany({
      where: { userId: user.id },
      include: {
        paymentAccount: {
          select: { accountType: true, maskedInfo: true, bankName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      payouts: payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        paymentType: p.paymentType,
        maskedAccount: p.paymentAccount.maskedInfo,
        bankName: p.paymentAccount.bankName,
        razorpayPayoutId: p.razorpayPayoutId,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        failureReason: p.failureReason,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
