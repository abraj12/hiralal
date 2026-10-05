import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';

const router = Router();

/**
 * RazorpayX Official Webhook Handler
 * Verifies webhook signature against raw byte payload.
 */
router.post('/razorpayx', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    res.status(400).json({ error: 'Missing x-razorpay-signature header' });
    return;
  }

  // Use raw request body buffer
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  if (config.razorpayx.webhookSecret) {
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpayx.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const isValid =
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

    if (!isValid) {
      console.warn('❌ [WEBHOOK] Invalid RazorpayX signature detected. Rejecting payload.');
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }
  } else if (config.nodeEnv === 'production') {
    res.status(500).json({ error: 'Webhook secret not configured on server' });
    return;
  }

  const event = req.body;
  const eventType = event.event;
  const payoutEntity = event.payload?.payout?.entity;

  console.log(`📥 [WEBHOOK] Received RazorpayX Event: ${eventType} (Payout ID: ${payoutEntity?.id})`);

  if (!payoutEntity) {
    res.status(200).json({ status: 'ignored' });
    return;
  }

  const razorpayPayoutId = payoutEntity.id;
  const payoutRecord = await prisma.payout.findFirst({
    where: {
      OR: [
        { razorpayPayoutId },
        { id: payoutEntity.reference_id },
      ],
    },
  });

  if (!payoutRecord) {
    console.warn(`[WEBHOOK] No local payout matched Razorpay payout ${razorpayPayoutId}`);
    res.status(200).json({ status: 'unmatched' });
    return;
  }

  if (eventType === 'payout.processed') {
    await prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutRecord.id } });
      if (!payout || payout.status === 'SUCCESS') return;

      const payoutAmount = Number(payout.amount);

      await tx.wallet.update({
        where: { id: payout.walletId },
        data: {
          processingAmount: { decrement: payoutAmount },
          totalRedeemed: { increment: payoutAmount },
          version: { increment: 1 },
        },
      });

      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Reward Disbursement Successful!',
          message: `₹${payoutAmount.toFixed(2)} has been credited to your verified payment account via bank transfer.`,
          type: 'PAYOUT_SUCCESS',
        },
      });
    });
  } else if (eventType === 'payout.failed' || eventType === 'payout.reversed') {
    const reason = payoutEntity.failure_reason || 'Disbursement rejected by banking partner';
    await PayoutService.reversePayout(payoutRecord.id, reason);
  }

  res.status(200).json({ status: 'ok' });
});

export default router;
