import { prisma } from '../db';
import { config } from '../config';
import { PayoutService } from '../services/payout.service';
import { toPaise } from '../utils/money.utils';
import { getRedisClient, isRedisReady } from '../redis';

export interface ReconciliationWorkerHeartbeat {
  worker: 'reconciliation';
  status: 'idle' | 'running' | 'error' | 'stopped';
  lastHeartbeat: string;
  lastPolledAt?: string;
  lastPollCompletedAt?: string;
  pollIntervalMs?: number;
  lastReconciledCount: number;
  lastWebhooksRetriedCount: number;
  totalReconciledCount: number;
  totalWebhooksRetriedCount: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
  pid: number;
}

export interface ReconciliationWorkerCheckpoint {
  worker: 'reconciliation';
  lastReconciledPayoutId: string | null;
  lastPayoutUpdatedAt: string | null;
  lastRetriedWebhookId: string | null;
  lastWebhookCreatedAt: string | null;
  totalReconciledCount: number;
  totalWebhooksRetriedCount: number;
  lastCheckpointAt: string;
  updatedAt: string;
}

export class ReconciliationWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;

  // Redis Keys and State (DEF-EXT-02: Worker polling cursor state & health monitoring)
  private static readonly HEARTBEAT_KEY = 'worker:reconciliation:heartbeat';
  private static readonly CHECKPOINT_KEY = 'worker:reconciliation:checkpoint';
  private static readonly HEARTBEAT_TTL_SECONDS = 600; // 10-minute health check window

  private static totalReconciledCount = 0;
  private static totalWebhooksRetriedCount = 0;
  private static lastHeartbeatState: ReconciliationWorkerHeartbeat | null = null;
  private static lastCheckpointState: ReconciliationWorkerCheckpoint | null = null;

  /**
   * Safe Redis SET that never crashes the worker if Redis is offline or errors.
   */
  private static async safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!isRedisReady()) return false;
      const redis = getRedisClient();
      if (!redis || redis.status !== 'ready') return false;
      if (ttlSeconds) {
        await redis.set(key, value, 'EX', ttlSeconds);
      } else {
        await redis.set(key, value);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safe Redis GET that returns null without throwing if Redis is offline or errors.
   */
  private static async safeRedisGet(key: string): Promise<string | null> {
    try {
      if (!isRedisReady()) return null;
      const redis = getRedisClient();
      if (!redis || redis.status !== 'ready') return null;
      return await redis.get(key);
    } catch {
      return null;
    }
  }

  /**
   * Updates reconciliation worker heartbeat in Redis and local memory state.
   */
  static async updateHeartbeat(
    status: 'idle' | 'running' | 'error' | 'stopped',
    extra: Partial<ReconciliationWorkerHeartbeat> = {}
  ): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      const heartbeat: ReconciliationWorkerHeartbeat = {
        worker: 'reconciliation',
        status,
        lastHeartbeat: nowIso,
        lastPolledAt: extra.lastPolledAt || this.lastHeartbeatState?.lastPolledAt || nowIso,
        lastPollCompletedAt: extra.lastPollCompletedAt || this.lastHeartbeatState?.lastPollCompletedAt,
        pollIntervalMs: extra.pollIntervalMs || this.lastHeartbeatState?.pollIntervalMs || 180000,
        lastReconciledCount: extra.lastReconciledCount ?? (this.lastHeartbeatState?.lastReconciledCount || 0),
        lastWebhooksRetriedCount: extra.lastWebhooksRetriedCount ?? (this.lastHeartbeatState?.lastWebhooksRetriedCount || 0),
        totalReconciledCount: this.totalReconciledCount,
        totalWebhooksRetriedCount: this.totalWebhooksRetriedCount,
        lastError: extra.lastError !== undefined ? extra.lastError : (status === 'error' ? this.lastHeartbeatState?.lastError : null),
        lastErrorAt: extra.lastErrorAt || (status === 'error' ? nowIso : null),
        pid: process.pid,
      };

      this.lastHeartbeatState = heartbeat;
      await this.safeRedisSet(this.HEARTBEAT_KEY, JSON.stringify(heartbeat), this.HEARTBEAT_TTL_SECONDS);
    } catch {
      // Safe fallback: never throw or break worker execution
    }
  }

  /**
   * Updates reconciliation cursor checkpoint in Redis.
   * Tracks last reconciled payout ID, webhook ID, and counts for resumption and monitoring (DEF-EXT-02).
   */
  static async updateCheckpoint(data: {
    lastReconciledPayoutId?: string;
    lastPayoutUpdatedAt?: Date;
    lastRetriedWebhookId?: string;
    lastWebhookCreatedAt?: Date;
    reconciledIncrement?: number;
    webhookIncrement?: number;
  }): Promise<void> {
    try {
      if (data.reconciledIncrement) {
        this.totalReconciledCount += data.reconciledIncrement;
      }
      if (data.webhookIncrement) {
        this.totalWebhooksRetriedCount += data.webhookIncrement;
      }
      const nowIso = new Date().toISOString();
      const checkpoint: ReconciliationWorkerCheckpoint = {
        worker: 'reconciliation',
        lastReconciledPayoutId: data.lastReconciledPayoutId ?? (this.lastCheckpointState?.lastReconciledPayoutId || null),
        lastPayoutUpdatedAt: data.lastPayoutUpdatedAt ? data.lastPayoutUpdatedAt.toISOString() : (this.lastCheckpointState?.lastPayoutUpdatedAt || null),
        lastRetriedWebhookId: data.lastRetriedWebhookId ?? (this.lastCheckpointState?.lastRetriedWebhookId || null),
        lastWebhookCreatedAt: data.lastWebhookCreatedAt ? data.lastWebhookCreatedAt.toISOString() : (this.lastCheckpointState?.lastWebhookCreatedAt || null),
        totalReconciledCount: this.totalReconciledCount,
        totalWebhooksRetriedCount: this.totalWebhooksRetriedCount,
        lastCheckpointAt: nowIso,
        updatedAt: nowIso,
      };

      this.lastCheckpointState = checkpoint;
      await this.safeRedisSet(this.CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch {
      // Safe fallback
    }
  }

  /**
   * Reads current heartbeat from Redis, falling back to local memory if offline.
   */
  static async getHeartbeat(): Promise<ReconciliationWorkerHeartbeat | null> {
    try {
      const raw = await this.safeRedisGet(this.HEARTBEAT_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Fall back to local memory state
    }
    return this.lastHeartbeatState;
  }

  /**
   * Reads persistent cursor checkpoint from Redis, falling back to local memory if offline.
   */
  static async getCheckpoint(): Promise<ReconciliationWorkerCheckpoint | null> {
    try {
      const raw = await this.safeRedisGet(this.CHECKPOINT_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Fall back to local memory state
    }
    return this.lastCheckpointState;
  }

  /**
   * Resets in-memory tracking metrics (used in test suites).
   */
  static resetMetrics(): void {
    this.totalReconciledCount = 0;
    this.totalWebhooksRetriedCount = 0;
    this.lastCheckpointState = null;
    this.lastHeartbeatState = null;
  }

  /**
   * Reconciles all pending and processing payouts against RazorpayX gateway.
   * Tracks heartbeat, cursor state, and batch count in Redis for monitoring and graceful resumption (DEF-EXT-02).
   */
  static async reconcileStuckPayouts(): Promise<{ reconciledCount: number; errors: string[] }> {
    const isRazorpayConfigured = Boolean(
      config.razorpayx.keyId &&
      config.razorpayx.keySecret &&
      config.razorpayx.accountNumber
    );

    await this.updateHeartbeat('running', { lastPolledAt: new Date().toISOString() });

    // Look for payouts stuck in non-terminal states older than 2 minutes.
    // Exclude payouts already flagged for manual review -- operators handle those (F-13).
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stuckPayouts = await prisma.payout.findMany({
      where: {
        status: { in: ['PAYOUT_INITIATED', 'PROCESSING'] },
        updatedAt: { lte: twoMinutesAgo },
        requiresManualReview: false,
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
        // Atomic compare-and-swap lease claim to prevent concurrent worker instances
        // from simultaneously querying the payment gateway for the same stuck payout
        const claimTime = new Date();
        const claimResult = await prisma.payout.updateMany({
          where: {
            id: payout.id,
            status: payout.status,
            updatedAt: payout.updatedAt,
          },
          data: {
            lastReconciledAt: claimTime,
            reconciliationAttempts: { increment: 1 },
          },
        });

        if (claimResult.count === 0) {
          // Another worker instance claimed or modified this payout concurrently
          continue;
        }

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

        // 2. Fallback: Search by our payout reference_id with mandatory account_number (VULN-HIGH-03)
        if (!razorpayPayout) {
          const controller2 = new AbortController();
          const timer2 = setTimeout(() => controller2.abort(), 10000);
          try {
            const accountNumberParam = config.razorpayx.accountNumber ? `&account_number=${encodeURIComponent(config.razorpayx.accountNumber)}` : '';
            const res = await fetch(`https://api.razorpay.com/v1/payouts?reference_id=${payout.id}${accountNumberParam}`, {
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
            await this.updateCheckpoint({
              lastReconciledPayoutId: payout.id,
              lastPayoutUpdatedAt: payout.updatedAt,
              reconciledIncrement: 1,
            });
            console.log(`[RECONCILIATION] Payout ${payout.id} finalized as SUCCESS via gateway status.`);
          } else if (gatewayStatus === 'reversed') {
            const reason = razorpayPayout.failure_reason || 'Disbursement reversed on banking network';
            await PayoutService.handleReversedPayout(payout.id, reason);
            reconciledCount++;
            await this.updateCheckpoint({
              lastReconciledPayoutId: payout.id,
              lastPayoutUpdatedAt: payout.updatedAt,
              reconciledIncrement: 1,
            });
            console.log(`[RECONCILIATION] Payout ${payout.id} handled post-settlement reversal as REVERSED (${reason}) via gateway status.`);
          } else if (gatewayStatus === 'failed' || gatewayStatus === 'rejected') {
            const reason = razorpayPayout.failure_reason || 'Disbursement rejected on banking network';
            await PayoutService.reversePayout(payout.id, reason);
            reconciledCount++;
            await this.updateCheckpoint({
              lastReconciledPayoutId: payout.id,
              lastPayoutUpdatedAt: payout.updatedAt,
              reconciledIncrement: 1,
            });
            console.log(`[RECONCILIATION] Payout ${payout.id} reversed as FAILED (${reason}) via gateway status.`);
          } else {
            // Still in 'queued' or 'processing'
            if (!payout.razorpayPayoutId && razorpayPayout.id) {
              await prisma.payout.update({
                where: { id: payout.id },
                data: {
                  razorpayPayoutId: razorpayPayout.id,
                },
              });
            }
          }
        } else {
          // Missing search result is NOT authoritative proof of gateway failure.
          // Keep funds safely reserved. Record reconciliation attempt and escalate to manual review after threshold.
          const currentAttempts = (payout.reconciliationAttempts || 0) + 1;
          const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
          const shouldEscalate = currentAttempts >= 5 || payout.createdAt <= twentyMinutesAgo;

          if (shouldEscalate && !payout.requiresManualReview) {
            await prisma.payout.update({
              where: { id: payout.id },
              data: {
                requiresManualReview: true,
                manualReviewReason: `Lookup inconclusive after ${currentAttempts} attempts or 20-minute window; funds held reserved for operator audit.`,
              },
            });
            console.warn(`[RECONCILIATION] Payout ${payout.id} escalated to MANUAL REVIEW. Funds remain safely reserved.`);
          } else {
            console.log(`[RECONCILIATION] Payout ${payout.id} lookup attempt ${currentAttempts} inconclusive. Retrying on next cycle.`);
          }
        }
      } catch (err: any) {
        errors.push(`Payout ${payout.id}: ${err.message}`);
        console.error(`[RECONCILIATION-ERROR] Failed to reconcile payout ${payout.id}:`, err.message);
        await this.updateHeartbeat('error', { lastError: err.message, lastErrorAt: new Date().toISOString() });
      }
    }

    await this.updateCheckpoint({});

    return { reconciledCount, errors };
  }

  /**
   * On-demand gateway reconciliation for a specific payout record (including those under manual review).
   */
  static async reconcileSinglePayout(payoutId: string): Promise<{ success: boolean; status: string; message: string }> {
    const isRazorpayConfigured = Boolean(
      config.razorpayx.keyId &&
      config.razorpayx.keySecret &&
      config.razorpayx.accountNumber
    );
    if (!isRazorpayConfigured) {
      return { success: false, status: 'SKIPPED', message: 'RazorpayX gateway credentials are not configured on server.' };
    }

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: { wallet: true },
    });
    if (!payout) {
      return { success: false, status: 'NOT_FOUND', message: 'Payout not found.' };
    }

    const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
    let razorpayPayout: any = null;

    if (payout.razorpayPayoutId) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payouts/${payout.razorpayPayoutId}`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        if (res.ok) razorpayPayout = await res.json();
      } catch (e) {
        // Fallback
      } finally {
        clearTimeout(timer);
      }
    }

    if (!razorpayPayout) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const accountNumberParam = config.razorpayx.accountNumber ? `&account_number=${encodeURIComponent(config.razorpayx.accountNumber)}` : '';
        const res = await fetch(`https://api.razorpay.com/v1/payouts?reference_id=${payout.id}${accountNumberParam}`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        if (res.ok) {
          const listData: any = await res.json();
          if (listData.items && listData.items.length > 0) razorpayPayout = listData.items[0];
        }
      } catch (e) {
        // Search failed
      } finally {
        clearTimeout(timer);
      }
    }

    if (!razorpayPayout) {
      return { success: false, status: payout.status, message: 'Gateway lookup inconclusive. No matching record returned by payment provider.' };
    }

    const gatewayStatus = razorpayPayout.status;
    if (gatewayStatus === 'processed') {
      await PayoutService.finalizeSuccess(payout.id, razorpayPayout.id);
      return { success: true, status: 'SUCCESS', message: 'Payout finalized as SUCCESS via gateway status.' };
    } else if (gatewayStatus === 'reversed') {
      const reason = razorpayPayout.failure_reason || 'Disbursement reversed on banking network';
      await PayoutService.handleReversedPayout(payout.id, reason);
      return { success: true, status: 'REVERSED', message: `Payout marked as REVERSED (${reason}).` };
    } else if (gatewayStatus === 'failed' || gatewayStatus === 'rejected') {
      const reason = razorpayPayout.failure_reason || 'Disbursement rejected on banking network';
      await PayoutService.reversePayout(payout.id, reason);
      return { success: true, status: 'FAILED', message: `Payout reversed as FAILED (${reason}).` };
    }

    if (!payout.razorpayPayoutId && razorpayPayout.id) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { razorpayPayoutId: razorpayPayout.id, lastReconciledAt: new Date() },
      });
    }

    return { success: true, status: gatewayStatus, message: `Gateway status is "${gatewayStatus}". Funds remain in processing.` };
  }

  /**
   * Retries unprocessed or previously unmatched webhook events.
   */
  static async retryUnprocessedWebhooks(): Promise<number> {
    const leaseThreshold = new Date(Date.now() - 60 * 1000);
    const candidateEvents = await prisma.webhookEvent.findMany({
      where: {
        isProcessed: false,
        provider: 'RAZORPAYX',
        attempts: { lt: 5 },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: leaseThreshold } },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });

    let processedCount = 0;
    for (const event of candidateEvents) {
      // Atomic CAS lease claim
      const claim = await prisma.webhookEvent.updateMany({
        where: {
          id: event.id,
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
        continue;
      }

      try {
        const payload = event.payload as any;
        const payoutEntity = payload?.payload?.payout?.entity;
        if (!payoutEntity) {
          await prisma.webhookEvent.update({
            where: { id: event.id },
            data: { isProcessed: true, processedAt: new Date(), processingStartedAt: null },
          });
          continue;
        }

        const razorpayPayoutId = payoutEntity.id;
        const payoutRecord = await prisma.payout.findFirst({
          where: {
            OR: [
              { razorpayPayoutId },
              { id: payoutEntity.reference_id },
            ],
          },
          include: { wallet: true },
        });

        if (!payoutRecord) {
          const isDeadLetter = (event.attempts + 1) >= 5;
          await prisma.webhookEvent.update({
            where: { id: event.id },
            data: {
              processingStartedAt: null,
              ...(isDeadLetter ? { isProcessed: true, lastError: '[DEAD-LETTER] No local payout matched after 5 attempts' } : {}),
            },
          });
          continue;
        }

        // Validate payload invariants: currency and amount
        if (!payoutEntity.currency || typeof payoutEntity.currency !== 'string' || payoutEntity.currency !== 'INR') {
          throw new Error(`[RECONCILIATION] Invalid currency: expected INR, got ${payoutEntity.currency}`);
        }
        if (payoutEntity.amount === undefined || payoutEntity.amount === null || isNaN(Number(payoutEntity.amount))) {
          throw new Error('[RECONCILIATION] Missing or invalid amount in payload');
        }
        const expectedPaise = Number(toPaise(payoutRecord.amount));
        if (Number(payoutEntity.amount) !== expectedPaise) {
          throw new Error(`[RECONCILIATION] Amount mismatch: expected ${expectedPaise} paise, got ${payoutEntity.amount} paise`);
        }

        const eventType = event.eventType;
        if (eventType === 'payout.processed') {
          if (payoutRecord.status === 'FAILED' || payoutRecord.status === 'REVERSED') {
            await prisma.$transaction(async (tx) => {
              // 1. Lock wallet and freeze available balance to 0
              await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${payoutRecord.walletId} FOR UPDATE`;
              await tx.wallet.update({
                where: { id: payoutRecord.walletId },
                data: { availableBalance: 0, version: { increment: 1 } },
              });
              // 2. Suspend user account and invalidate active sessions
              await tx.user.update({
                where: { id: payoutRecord.userId },
                data: { status: 'SUSPENDED' },
              });
              await tx.authSession.deleteMany({
                where: { userId: payoutRecord.userId },
              });
              // 3. Mark payout for urgent manual review
              await tx.payout.update({
                where: { id: payoutRecord.id },
                data: {
                  requiresManualReview: true,
                  manualReviewReason: `CRITICAL FINANCIAL DRIFT: Gateway processed payout after local status was marked ${payoutRecord.status}. Account suspended and wallet frozen.`,
                },
              });
              // 4. Double-entry ledger adjustment entry
              await tx.walletTransaction.create({
                data: {
                  walletId: payoutRecord.walletId,
                  userId: payoutRecord.userId,
                  amount: 0,
                  type: 'MANUAL_ADJUSTMENT',
                  balanceAfter: 0,
                  referenceType: 'PAYOUT',
                  referenceId: payoutRecord.id,
                  description: `Wallet balance frozen to 0 due to CRITICAL FINANCIAL DRIFT: Gateway processed payout after local status was ${payoutRecord.status}.`,
                },
              });
              // 5. Audit log
              await tx.auditLog.create({
                data: {
                  action: 'CRITICAL_FINANCIAL_DRIFT',
                  entityType: 'Payout',
                  entityId: payoutRecord.id,
                  newValue: JSON.stringify({
                    payoutId: payoutRecord.id,
                    eventId: event.eventId,
                    razorpayPayoutId,
                    localStatus: payoutRecord.status,
                    actionTaken: 'USER_SUSPENDED_WALLET_FROZEN',
                  }),
                },
              });
            });
          } else {
            await PayoutService.finalizeSuccess(payoutRecord.id, razorpayPayoutId);
          }
        } else if (eventType === 'payout.reversed') {
          const reason = payoutEntity.failure_reason || 'Disbursement reversed by banking partner';
          await PayoutService.handleReversedPayout(payoutRecord.id, reason);
        } else if (eventType === 'payout.failed' || eventType === 'payout.rejected') {
          const reason = payoutEntity.failure_reason || 'Disbursement rejected by banking partner';
          await PayoutService.reversePayout(payoutRecord.id, reason);
        }

        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { isProcessed: true, processedAt: new Date(), processingStartedAt: null, lastError: null },
        });
        processedCount++;
        await this.updateCheckpoint({
          lastRetriedWebhookId: event.id,
          lastWebhookCreatedAt: event.createdAt,
          webhookIncrement: 1,
        });
      } catch (err: any) {
        const isDeadLetter = (event.attempts + 1) >= 5;
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            processingStartedAt: null,
            lastError: isDeadLetter ? `[DEAD-LETTER] Exceeded 5 attempts: ${err.message}` : err.message,
            ...(isDeadLetter ? { isProcessed: true } : {}),
          },
        });
      }
    }

    await this.updateCheckpoint({});
    return processedCount;
  }

  /**
   * Starts periodic reconciliation loop (runs every 3 minutes).
   */
  static startReconciliation(intervalMs = 180000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateHeartbeat('idle', { pollIntervalMs: intervalMs }).catch(() => {});

    const run = async () => {
      try {
        await this.updateHeartbeat('running', { lastPolledAt: new Date().toISOString() });
        const stuckReport = await this.reconcileStuckPayouts();
        const webhooksRetried = await this.retryUnprocessedWebhooks();
        await this.updateHeartbeat('idle', {
          lastPollCompletedAt: new Date().toISOString(),
          lastReconciledCount: stuckReport.reconciledCount,
          lastWebhooksRetriedCount: webhooksRetried,
        });
      } catch (err: any) {
        console.error('[RECONCILIATION-LOOP-ERROR]', err.message);
        await this.updateHeartbeat('error', {
          lastError: err.message,
          lastErrorAt: new Date().toISOString(),
        });
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
    this.updateHeartbeat('stopped').catch(() => {});
  }
}
