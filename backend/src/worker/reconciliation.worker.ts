import { prisma } from '../db';
import { config } from '../config';
import { PayoutService } from '../services/payout.service';

export class ReconciliationWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;

  /**
   * Reconciles all pending and processing payouts against RazorpayX gateway.
   */
  static async reconcileStuckPayouts(): Promise<{ reconciledCount: number; errors: string[] }> {
    const isRazorpayConfigured = Boolean(
      config.razorpayx.keyId &&
      config.razorpayx.keySecret &&
      config.razorpayx.accountNumber
    );

    // Look for payouts stuck in non-terminal states older than 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stuckPayouts = await prisma.payout.findMany({
      where: {
        status: { in: ['PAYOUT_INITIATED', 'PROCESSING'] },
        updatedAt: { lte: twoMinutesAgo },
      },
      include: { wallet: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    });

    let reconciledCount = 0;
    const errors: string[] = [];

    if (!isRazorpayConfigured) {
      return { reconciledCount: 0, errors: ['RazorpayX not configured; skipping automated gateway sync'] };
    }

    const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');

    for (const payout of stuckPayouts) {
      try {
        let razorpayPayout: any = null;

        // 1. Fetch by razorpayPayoutId if known
        if (payout.razorpayPayoutId) {
          const controller1 = new AbortController();
          const timer1 = setTimeout(() => controller1.abort(), 10000);
          try {
            const res = await fetch(`https://api.razorpay.com/v1/payouts/${payout.razorpayPayoutId}`, {
              headers: { Authorization: auth },
              signal: controller1.signal,
            });
            if (res.ok) {
              razorpayPayout = await res.json();
            }
          } catch (e) {
            // continue to fallback
          } finally {
            clearTimeout(timer1);
          }
        }

        // 2. Fallback: Search by our payout reference_id
        if (!razorpayPayout) {
          const controller2 = new AbortController();
          const timer2 = setTimeout(() => controller2.abort(), 10000);
          try {
            const res = await fetch(`https://api.razorpay.com/v1/payouts?reference_id=${payout.id}`, {
              headers: { Authorization: auth },
              signal: controller2.signal,
            });
            if (res.ok) {
              const listData: any = await res.json();
              if (listData.items && listData.items.length > 0) {
                razorpayPayout = listData.items[0];
              }
            }
          } catch (e) {
            // search failed
          } finally {
            clearTimeout(timer2);
          }
        }

        // 3. Evaluate Razorpay status
        if (razorpayPayout) {
          const gatewayStatus = razorpayPayout.status;

          if (gatewayStatus === 'processed') {
            await PayoutService.finalizeSuccess(payout.id, razorpayPayout.id);
            reconciledCount++;
            console.log(`[RECONCILIATION] Payout ${payout.id} finalized as SUCCESS via gateway status.`);
          } else if (gatewayStatus === 'reversed') {
            const reason = razorpayPayout.failure_reason || 'Disbursement reversed on banking network';
            await PayoutService.handleReversedPayout(payout.id, reason);
            reconciledCount++;
            console.log(`[RECONCILIATION] Payout ${payout.id} handled post-settlement reversal as REVERSED (${reason}) via gateway status.`);
          } else if (gatewayStatus === 'failed' || gatewayStatus === 'rejected') {
            const reason = razorpayPayout.failure_reason || 'Disbursement rejected on banking network';
            await PayoutService.reversePayout(payout.id, reason);
            reconciledCount++;
            console.log(`[RECONCILIATION] Payout ${payout.id} reversed as FAILED (${reason}) via gateway status.`);
          } else {
            // Still in 'queued' or 'processing'
            await prisma.payout.update({
              where: { id: payout.id },
              data: {
                razorpayPayoutId: payout.razorpayPayoutId || razorpayPayout.id,
                lastReconciledAt: new Date(),
                reconciliationAttempts: { increment: 1 },
              },
            });
          }
        } else {
          // Missing search result is NOT authoritative proof of gateway failure.
          // Keep funds safely reserved. Record reconciliation attempt and escalate to manual review after threshold.
          const nextAttempts = (payout.reconciliationAttempts || 0) + 1;
          const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
          const shouldEscalate = nextAttempts >= 5 || payout.createdAt <= twentyMinutesAgo;

          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              reconciliationAttempts: nextAttempts,
              lastReconciledAt: new Date(),
              requiresManualReview: shouldEscalate,
              manualReviewReason: shouldEscalate
                ? `Lookup inconclusive after ${nextAttempts} attempts or 20-minute window; funds held reserved for operator audit.`
                : null,
            },
          });

          if (shouldEscalate) {
            console.warn(`[RECONCILIATION] Payout ${payout.id} escalated to MANUAL REVIEW. Funds remain safely reserved.`);
          } else {
            console.log(`[RECONCILIATION] Payout ${payout.id} lookup attempt ${nextAttempts} inconclusive. Retrying on next cycle.`);
          }
        }
      } catch (err: any) {
        errors.push(`Payout ${payout.id}: ${err.message}`);
        console.error(`[RECONCILIATION-ERROR] Failed to reconcile payout ${payout.id}:`, err.message);
      }
    }

    return { reconciledCount, errors };
  }

  /**
   * Starts periodic reconciliation loop (runs every 3 minutes).
   */
  static startReconciliation(intervalMs = 180000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const run = async () => {
      try {
        await this.reconcileStuckPayouts();
      } catch (err: any) {
        console.error('[RECONCILIATION-LOOP-ERROR]', err.message);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(run, intervalMs);
        }
      }
    };

    run();
  }

  static stopReconciliation(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
