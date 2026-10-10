import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';

const router = Router();

/**
 * RazorpayX Official Webhook Handler
 * Verifies webhook signature against raw byte payload, deduplicates via WebhookEvent table,
 * and executes safe idempotent state transitions.
 */
router.post('/razorpayx', async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!signature && config.nodeEnv !== 'test') {
      res.status(400).json({ error: 'Missing x-razorpay-signature header' });
      return;
    }

    // Use raw request body buffer verified at Express middleware level
    const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

    if (config.razorpayx.webhookSecret && signature) {
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
    } else if (config.isProduction && !config.razorpayx.webhookSecret) {
      res.status(500).json({ error: 'Webhook secret not configured on server' });
      return;
    }

  const event = req.body;
  const eventType = event.event;
  const payoutEntity = event.payload?.payout?.entity;
  const eventId =
    (req.headers['x-razorpay-event-id'] as string) ||
    event.id ||
    event.event_id ||
    (payoutEntity ? `${eventType}_${payoutEntity.id}` : null);

  console.log(`📥 [WEBHOOK] Received RazorpayX Event: ${eventType} (Event ID: ${eventId}, Payout ID: ${payoutEntity?.id})`);

  // Deduplication check using durable WebhookEvent ledger with atomic insert
  if (eventId) {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: 'RAZORPAYX',
          eventId,
          eventType: eventType || 'unknown',
          payload: event,
          isProcessed: false,
        },
      });
    } catch (err: any) {
      // If event record already exists, check if already processed
      const existingEvent = await prisma.webhookEvent.findUnique({
        where: {
          provider_event_unique: {
            provider: 'RAZORPAYX',
            eventId,
          },
        },
      });

      if (existingEvent && existingEvent.isProcessed) {
        console.log(`[WEBHOOK] Duplicate event ${eventId} already processed. Returning 200 OK.`);
        res.status(200).json({ status: 'duplicate_ignored' });
        return;
      }
    }
  }

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
    console.warn(`[WEBHOOK] No local payout matched Razorpay payout ${razorpayPayoutId} or ref ${payoutEntity.reference_id}`);
    if (eventId) {
      await prisma.webhookEvent.update({
        where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
        data: { isProcessed: true, processedAt: new Date() },
      });
    }
    res.status(200).json({ status: 'unmatched' });
    return;
  }

  if (eventType === 'payout.processed') {
    await PayoutService.finalizeSuccess(payoutRecord.id, razorpayPayoutId);
    console.log(`[WEBHOOK] Payout ${payoutRecord.id} successfully finalized via webhook.`);
  } else if (eventType === 'payout.reversed') {
    const reason = payoutEntity.failure_reason || 'Disbursement reversed by banking partner';
    await PayoutService.handleReversedPayout(payoutRecord.id, reason);
    console.log(`[WEBHOOK] Payout ${payoutRecord.id} handled post-success reversal via webhook: ${reason}`);
  } else if (eventType === 'payout.failed' || eventType === 'payout.rejected') {
    const reason = payoutEntity.failure_reason || 'Disbursement rejected by banking partner';
    await PayoutService.reversePayout(payoutRecord.id, reason);
    console.log(`[WEBHOOK] Payout ${payoutRecord.id} reversed via webhook: ${reason}`);
  }

  // Mark event as processed
  if (eventId) {
    await prisma.webhookEvent.update({
      where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
      data: { isProcessed: true, processedAt: new Date() },
    });
  }

  res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('[WEBHOOK-ERROR]', err);
    res.status(500).json({ error: err.message || 'Webhook processing failed' });
  }
});

export default router;
