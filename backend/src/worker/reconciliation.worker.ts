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
          const res = await fetch(`https://api.razorpay.com/v1/payouts/${payout.razorpayPayoutId}`, {
            headers: { Authorization: auth },
          });
          if (res.ok) {
            razorpayPayout = await res.json();
          }
        }

        // 2. Fallback: Search by our payout reference_id
        if (!razorpayPayout) {
          const res = await fetch(`https://api.razorpay.com/v1/payouts?reference_id=${payout.id}`, {
            headers: { Authorization: auth },
          });
          if (res.ok) {
            const listData: any = await res.json();
            if (listData.items && listData.items.length > 0) {
              razorpayPayout = listData.items[0];
            }
          }
        }

        // 3. Evaluate Razorpay status
        if (razorpayPayout) {
          const gatewayStatus = razorpayPayout.status;

          if (gatewayStatus === 'processed') {
            await PayoutService.finalizeSuccess(payout.id, razorpayPayout.id);
            reconciledCount++;
            console.log(`[RECONCILIATION] Payout ${payout.id} finalized as SUCCESS via gateway status.`);
          } else if (gatewayStatus === 'failed' || gatewayStatus === 'reversed' || gatewayStatus === 'rejected') {
            const reason = razorpayPayout.failure_reason || 'Disbursement rejected/reversed on banking network';
            await PayoutService.reversePayout(payout.id, reason);
            reconciledCount++;
            console.log(`[RECONCILIATION] Payout ${payout.id} reversed as FAILED (${reason}) via gateway status.`);
          } else {
            // Still in 'queued' or 'processing'
            if (!payout.razorpayPayoutId && razorpayPayout.id) {
              await prisma.payout.update({
                where: { id: payout.id },
                data: { razorpayPayoutId: razorpayPayout.id },
              });
            }
          }
        } else {
          // If transaction is older than 20 minutes and not found at Razorpay, safe reversal
          const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
          if (payout.createdAt <= twentyMinutesAgo) {
            const reason = 'Transaction not found at gateway after 20-minute reconciliation grace window';
            await PayoutService.reversePayout(payout.id, reason);
            reconciledCount++;
            console.warn(`[RECONCILIATION] Payout ${payout.id} safely reversed. Gateway reported no record after 20 minutes.`);
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
