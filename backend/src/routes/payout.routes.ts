import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { PayoutService } from '../services/payout.service';
import { payoutRedeemLimiter } from '../middleware/rateLimit.middleware';
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
 * Enforces 100% full-balance redemption computed from database available balance.
 * Awaiting admin approval before dispatch.
 */
router.post('/redeem', authenticate, payoutRedeemLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const idempotencyRaw: unknown = req.body?.idempotencyKey;

    const idempotencyKey =
      typeof idempotencyRaw === 'string'
        ? idempotencyRaw.trim()
        : '';

    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'A valid payout request reference is required.',
      });
    }

    // 100% full available balance redemption (server-controlled)
    const result = await PayoutService.requestRedemption(user.id, idempotencyKey);

    res.status(201).json({
      success: true,
      message: result.message || 'Redemption request submitted successfully. Awaiting admin approval before disbursement.',
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
