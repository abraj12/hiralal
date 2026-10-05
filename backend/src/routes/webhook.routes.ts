import { Router, Request, Response } from 'express';
import { PayoutService } from '../services/payout.service';

const router = Router();

router.post('/razorpayx', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-razorpay-signature'] as string) || '';
    const rawPayload = JSON.stringify(req.body);

    const result = PayoutService.handleWebhook(signature, rawPayload, req.body);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[WEBHOOK ERROR]', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
