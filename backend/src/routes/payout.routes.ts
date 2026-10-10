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
 * Backend determines verified recipient account, checks window, and enforces server-controlled payout amount.
 */
router.post('/redeem', authenticate, payoutRedeemLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const amountRaw: unknown = req.body?.amount;
    const idempotencyRaw: unknown = req.body?.idempotencyKey;

    const amountText =
      typeof amountRaw === 'number'
        ? String(amountRaw)
        : typeof amountRaw === 'string'
          ? amountRaw.trim()
          : '';

    if (!amountText || !/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      return res.status(400).json({
        success: false,
        message: 'A valid payout amount with no more than two decimal places is required.',
      });
    }

    const parsedAmount = Number(amountText);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payout amount must be greater than zero.',
      });
    }

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

    const result = await PayoutService.requestRedemption(user.id, idempotencyKey, parsedAmount);

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
