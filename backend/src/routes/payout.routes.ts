import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { PayoutService } from '../services/payout.service';

const router = Router();

router.post('/redeem', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { amount, paymentAccountId, idempotencyKey } = req.body;

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ success: false, message: 'Valid redemption amount is required.' });
    }

    const cleanKey = idempotencyKey || `idem-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const payout = await PayoutService.requestRedemption({
      userId: user.id,
      amount: parseFloat(amount),
      paymentAccountId,
      idempotencyKey: cleanKey,
    });

    res.status(201).json({
      success: true,
      message: 'Redemption initiated successfully.',
      payout,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const payouts = PayoutService.getUserPayouts(user.id);
    res.json({ success: true, payouts });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper endpoint for demo / testing payout completion
router.post('/:id/simulate-payout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { success = true, failureReason } = req.body;
    const payout = await PayoutService.completePayout(req.params.id, Boolean(success), failureReason);
    res.json({ success: true, payout, message: 'Payout simulated successfully' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
