import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';
import { toPaise } from '../utils/money.utils';
import { webhookLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

/**
 * RazorpayX Official Webhook Handler
 * Verifies webhook signature against raw byte payload, deduplicates via WebhookEvent table,
 * and executes safe idempotent state transitions.
 */
export async function handleRazorpayXWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;

    // Fail-closed: require webhook secret in all non-test environments (F-02).
    // Without this, a missing RAZORPAYX_WEBHOOK_SECRET silently bypasses HMAC verification.
    if (!config.razorpayx.webhookSecret && config.nodeEnv !== 'test') {
      console.error('[WEBHOOK-SECURITY] RAZORPAYX_WEBHOOK_SECRET is not configured. Rejecting all webhook requests.');
      res.status(403).json({ error: 'Webhook authentication not configured on server.' });
      return;
    }

    if (!signature && config.nodeEnv !== 'test') {
      res.status(400).json({ error: 'Missing x-razorpay-signature header' });
      return;
    }

    const isSensitive = config.isSensitiveEnv || config.isProduction;

    if (isSensitive && !config.razorpayx.webhookSecret) {
      res.status(500).json({ error: 'Webhook secret not configured on server' });
      return;
    }

    if (isSensitive && !(req as any).rawBody) {
      res.status(400).json({ error: 'Raw request body buffer missing for cryptographic verification' });
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
    }

    const event = req.body;
    const eventType = event.event;
    const payoutEntity = event.payload?.payout?.entity;
    const eventId =
      event.id ||
      event.event_id ||
      (req.headers['x-razorpay-event-id'] as string) ||
      (payoutEntity ? `${eventType}_${payoutEntity.id}` : null);

    console.log(`📥 [WEBHOOK] Received RazorpayX Event: ${eventType} (Event ID: ${eventId}, Payout ID: ${payoutEntity?.id})`);

    if (!eventId) {
      res.status(400).json({ error: 'Missing webhook event identifier' });
      return;
    }

    // FIN-05: Do not enforce arbitrary 5-minute rejection on immutable event created_at timestamp.
    // RazorpayX retries delayed up to 24 hours keep original created_at. Cryptographic HMAC and
    // durable WebhookEvent idempotency leases below safely prevent replays without dropping retries.

    // 1. Ensure event record exists in durable WebhookEvent ledger
    await prisma.webhookEvent.upsert({
      where: {
        provider_event_unique: {
          provider: 'RAZORPAYX',
          eventId,
        },
      },
      update: {},
      create: {
        provider: 'RAZORPAYX',
        eventId,
        eventType: eventType || 'unknown',
        payload: event,
        isProcessed: false,
      },
    });

    // 2. Atomically claim exclusive processing lease (60-second bounded lease)
    const leaseThreshold = new Date(Date.now() - 60 * 1000);
    const claim = await prisma.webhookEvent.updateMany({
      where: {
        provider: 'RAZORPAYX',
        eventId,
        isProcessed: false,
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: leaseThreshold } },
        ],
      },
      data: {
        processingStartedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claim.count === 0) {
      // Event is either already processed or actively leased by another concurrent worker
      const current = await prisma.webhookEvent.findUnique({
        where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
      });
      if (current?.isProcessed) {
        console.log(`[WEBHOOK] Duplicate event ${eventId} already processed. Returning 200 OK.`);
        res.status(200).json({ status: 'duplicate_ignored' });
        return;
      }
      console.log(`[WEBHOOK] Event ${eventId} currently leased by concurrent worker. Returning 200 OK.`);
      res.status(200).json({ status: 'processing_in_progress' });
      return;
    }

    // 3. Process the event under exclusive lease
    try {
      if (!payoutEntity) {
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: { isProcessed: true, processedAt: new Date(), processingStartedAt: null },
        });
        res.status(200).json({ status: 'ignored' });
        return;
      }

      const razorpayPayoutId = typeof payoutEntity.id === 'string' ? payoutEntity.id.trim() : '';
      const referenceId = typeof payoutEntity.reference_id === 'string' ? payoutEntity.reference_id.trim() : '';
      if (!razorpayPayoutId) {
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: {
            isProcessed: true,
            processedAt: new Date(),
            processingStartedAt: null,
            lastError: 'Malformed payout webhook: provider payout ID is missing.',
          },
        });
        res.status(200).json({ status: 'ignored', reason: 'missing_provider_payout_id' });
        return;
      }

      const payoutByProviderId = await prisma.payout.findUnique({ where: { razorpayPayoutId } });
      const payoutByReference = referenceId
        ? await prisma.payout.findUnique({ where: { id: referenceId } })
        : null;

      // Never let an OR query pick an arbitrary payout when the provider ID and our
      // reference ID point to different local financial records.
      if (payoutByProviderId && payoutByReference && payoutByProviderId.id !== payoutByReference.id) {
        const affectedPayoutIds = [payoutByProviderId.id, payoutByReference.id];
        const reason = `FATAL_PROVIDER_REFERENCE_MISMATCH: provider payout ${razorpayPayoutId} maps to ${payoutByProviderId.id}, while reference_id maps to ${payoutByReference.id}`;
        await prisma.$transaction(async (tx) => {
          await tx.payout.updateMany({
            where: { id: { in: affectedPayoutIds } },
            data: { requiresManualReview: true, manualReviewReason: reason },
          });
          await tx.auditLog.create({
            data: {
              action: 'PAYOUT_PROVIDER_REFERENCE_MISMATCH',
              entityType: 'Payout',
              entityId: payoutByReference.id,
              newValue: JSON.stringify({
                eventId,
                providerPayoutId: razorpayPayoutId,
                providerIdMatchedPayoutId: payoutByProviderId.id,
                referenceMatchedPayoutId: payoutByReference.id,
                actionTaken: 'BOTH_PAYOUTS_HELD_FOR_MANUAL_REVIEW',
              }),
            },
          });
          await tx.webhookEvent.update({
            where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
            data: {
              isProcessed: true,
              processedAt: new Date(),
              processingStartedAt: null,
              lastError: reason,
            },
          });
        });
        res.status(200).json({ status: 'manual_review_required', reason: 'provider_reference_mismatch' });
        return;
      }

      const payoutRecord = payoutByProviderId || payoutByReference;

      if (!payoutRecord) {
        console.warn(`[WEBHOOK] No local payout matched Razorpay payout ${razorpayPayoutId} or ref ${payoutEntity.reference_id}`);
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: {
            isProcessed: false,
            lastError: `Unmatched payout entity: ${razorpayPayoutId}`,
            processingStartedAt: null,
          },
        });
        res.status(200).json({ status: 'unmatched_held_for_retry' });
        return;
      }

      if (payoutRecord.razorpayPayoutId && payoutRecord.razorpayPayoutId !== razorpayPayoutId) {
        const reason = `FATAL_PROVIDER_PAYOUT_ID_MISMATCH: stored ${payoutRecord.razorpayPayoutId}, received ${razorpayPayoutId}`;
        await prisma.$transaction(async (tx) => {
          await tx.payout.update({
            where: { id: payoutRecord.id },
            data: { requiresManualReview: true, manualReviewReason: reason },
          });
          await tx.auditLog.create({
            data: {
              action: 'PAYOUT_PROVIDER_ID_MISMATCH',
              entityType: 'Payout',
              entityId: payoutRecord.id,
              newValue: JSON.stringify({
                payoutId: payoutRecord.id,
                eventId,
                storedProviderPayoutId: payoutRecord.razorpayPayoutId,
                receivedProviderPayoutId: razorpayPayoutId,
                actionTaken: 'HELD_FOR_MANUAL_REVIEW',
              }),
            },
          });
          await tx.webhookEvent.update({
            where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
            data: {
              isProcessed: true,
              processedAt: new Date(),
              processingStartedAt: null,
              lastError: reason,
            },
          });
        });
        res.status(200).json({ status: 'manual_review_required', reason: 'provider_payout_id_mismatch' });
        return;
      }

      if (!payoutEntity.currency || typeof payoutEntity.currency !== 'string' || payoutEntity.currency !== 'INR') {
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: {
            isProcessed: true,
            lastError: `FATAL_CURRENCY_MISMATCH: ${payoutEntity.currency}`,
            processingStartedAt: null,
          },
        });
        await prisma.payout.update({
          where: { id: payoutRecord.id },
          data: {
            requiresManualReview: true,
            manualReviewReason: `FATAL_CURRENCY_MISMATCH: ${payoutEntity.currency}`,
          },
        });
        res.status(200).json({ status: 'rejected_unrecoverable', reason: 'currency_mismatch' });
        return;
      }

      if (payoutEntity.amount === undefined || payoutEntity.amount === null || isNaN(Number(payoutEntity.amount))) {
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: {
            isProcessed: true,
            lastError: 'FATAL_INVALID_AMOUNT',
            processingStartedAt: null,
          },
        });
        await prisma.payout.update({
          where: { id: payoutRecord.id },
          data: {
            requiresManualReview: true,
            manualReviewReason: 'FATAL_INVALID_AMOUNT',
          },
        });
        res.status(200).json({ status: 'rejected_unrecoverable', reason: 'invalid_amount' });
        return;
      }

      const expectedPaise = Number(toPaise(payoutRecord.amount));
      if (Number(payoutEntity.amount) !== expectedPaise) {
        await prisma.webhookEvent.update({
          where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
          data: {
            isProcessed: true,
            lastError: `FATAL_AMOUNT_MISMATCH: expected ${expectedPaise}, received ${payoutEntity.amount}`,
            processingStartedAt: null,
          },
        });
        await prisma.payout.update({
          where: { id: payoutRecord.id },
          data: {
            requiresManualReview: true,
            manualReviewReason: `FATAL_AMOUNT_MISMATCH: expected ${expectedPaise}, received ${payoutEntity.amount}`,
          },
        });
        res.status(200).json({ status: 'rejected_unrecoverable', reason: 'amount_mismatch' });
        return;
      }

      try {
        if (eventType === 'payout.processed') {
          if (payoutRecord.status === 'FAILED' || payoutRecord.status === 'REVERSED') {
            console.error(`🚨 [WEBHOOK-CRITICAL] Financial drift detected! Payout ${payoutRecord.id} was ${payoutRecord.status} but gateway reported payout.processed!`);
            await PayoutService.handleFinancialDriftClawback(
              payoutRecord.id,
              razorpayPayoutId,
              `Webhook event ${eventId}`
            );
            await prisma.auditLog.create({
              data: {
                action: 'CRITICAL_FINANCIAL_DRIFT',
                entityType: 'Payout',
                entityId: payoutRecord.id,
                newValue: JSON.stringify({
                  payoutId: payoutRecord.id,
                  eventId,
                  razorpayPayoutId,
                  localStatus: payoutRecord.status,
                  payoutAmount: Number(payoutRecord.amount),
                  actionTaken: 'USER_SUSPENDED_WALLET_FROZEN_DEFICIT_LIABILITY_RECORDED',
                  warning: 'Wallet balance was refunded and gateway disbursed funds concurrently. Account suspended and wallet deficit liability recorded pending operator audit.',
                }),
              },
            });
          } else {
            await PayoutService.finalizeSuccess(payoutRecord.id, razorpayPayoutId);
            console.log(`[WEBHOOK] Payout ${payoutRecord.id} successfully finalized via webhook.`);
          }
        } else if (eventType === 'payout.reversed') {
          const reason = payoutEntity.failure_reason || 'Disbursement reversed by banking partner';
          await PayoutService.handleReversedPayout(payoutRecord.id, reason);
          console.log(`[WEBHOOK] Payout ${payoutRecord.id} handled post-success reversal via webhook: ${reason}`);
        } else if (eventType === 'payout.failed' || eventType === 'payout.rejected') {
          const reason = payoutEntity.failure_reason || 'Disbursement rejected by banking partner';
          await PayoutService.reversePayout(payoutRecord.id, reason);
          console.log(`[WEBHOOK] Payout ${payoutRecord.id} reversed via webhook: ${reason}`);
        }
      } catch (transitionErr: any) {
        // Handle out-of-order webhook delivery: if payout has already reached terminal state,
        // safely acknowledge to prevent infinite provider retry storms.
        if (
          transitionErr.message &&
          (transitionErr.message.includes('already in terminal state') ||
           transitionErr.message.includes('already successfully completed') ||
           transitionErr.message.includes('already been reversed') ||
           transitionErr.message.includes('already failed'))
        ) {
          console.warn(`[WEBHOOK] Out-of-order delivery: event ${eventType} acknowledged for payout ${payoutRecord.id}: ${transitionErr.message}`);
          if (eventType === 'payout.processed' || eventType === 'payout.failed' || eventType === 'payout.rejected') {
            await prisma.payout.update({
              where: { id: payoutRecord.id },
              data: {
                requiresManualReview: true,
                manualReviewReason: `CRITICAL FINANCIAL DRIFT: Gateway event ${eventType} arrived for terminal payout (${transitionErr.message}). Operator audit required.`,
              },
            });
            await prisma.auditLog.create({
              data: {
                action: 'CRITICAL_FINANCIAL_DRIFT',
                entityType: 'Payout',
                entityId: payoutRecord.id,
                newValue: JSON.stringify({
                  payoutId: payoutRecord.id,
                  eventId,
                  eventType,
                  razorpayPayoutId,
                  error: transitionErr.message,
                }),
              },
            });
          }
        } else {
          throw transitionErr;
        }
      }

      // 4. Mark event as processed only after financial transition succeeds
      await prisma.webhookEvent.update({
        where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
        data: {
          isProcessed: true,
          processedAt: new Date(),
          processingStartedAt: null,
          lastError: null,
        },
      });

      res.status(200).json({ status: 'ok' });
    } catch (processErr: any) {
      // Release lease and record error for retry
      await prisma.webhookEvent.update({
        where: { provider_event_unique: { provider: 'RAZORPAYX', eventId } },
        data: {
          processingStartedAt: null,
          lastError: processErr.message || 'Processing failure',
        },
      });
      throw processErr;
    }
  } catch (err: any) {
    console.error('[WEBHOOK-ERROR]', err);
    res.status(500).json({ error: err.message || 'Webhook processing failed' });
  }
}

router.post('/razorpayx', webhookLimiter, handleRazorpayXWebhook);
// NOTE: The duplicate /webhook alias on payout.routes.ts has been removed (F-02).

export default router;
