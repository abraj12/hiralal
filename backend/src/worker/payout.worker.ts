import { prisma } from '../db';
import { config } from '../config';
import { toPaise } from '../utils/money.utils';
import { decryptSensitive, encryptSensitive } from '../utils/crypto.utils';
import { PayoutService } from '../services/payout.service';
import { getRedisClient, isRedisReady } from '../redis';

export interface PayoutWorkerHeartbeat {
  worker: 'payout';
  status: 'idle' | 'polling' | 'error' | 'stopped';
  lastHeartbeat: string;
  lastPolledAt?: string;
  lastPollCompletedAt?: string;
  pollIntervalMs?: number;
  lastBatchProcessedCount: number;
  totalProcessedCount: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
  pid: number;
}

export interface PayoutWorkerCheckpoint {
  worker: 'payout';
  lastProcessedEventId: string | null;
  lastEventCreatedAt: string | null;
  lastPolledAt: string;
  processedCount: number;
  cursorTimestamp: number;
  updatedAt: string;
}

export function resolveBankAccountNumber(account: {
  accountType: string;
  accountNumber?: string | null;
  accountNumberEncrypted?: string | null;
}): string {
  if (account.accountType !== 'BANK_ACCOUNT') {
    throw new Error('Bank account details requested for a non-bank account.');
  }

  if (!account.accountNumberEncrypted) {
    throw new Error('Encrypted bank account details are unavailable.');
  }

  const plaintext = decryptSensitive(account.accountNumberEncrypted);

  if (!/^\d{9,18}$/.test(plaintext)) {
    throw new Error('Stored bank account details are invalid.');
  }

  return plaintext;
}

export function resolveUpiAddress(account: {
  accountType: string;
  upiId?: string | null;
  upiIdEncrypted?: string | null;
}): string {
  if (account.accountType !== 'UPI') {
    throw new Error('UPI details requested for a non-UPI account.');
  }

  // Primary: Decrypt from AES-256-GCM ciphertext
  let raw: string | null = null;
  if (account.upiIdEncrypted) {
    try {
      raw = decryptSensitive(account.upiIdEncrypted);
    } catch (_) {
      raw = null;
    }
  }

  // Safe migration fallback: For unmigrated legacy rows lacking upiIdEncrypted,
  // allow fallback to legacy upiId so in-flight payouts do not fail
  if (!raw && account.upiId) {
    raw = account.upiId;
  }

  if (!raw || !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(raw.trim())) {
    throw new Error('Stored UPI handle details are invalid.');
  }

  return raw.trim();
}

export class PayoutWorker {
  private static isOutboxPolling = false;
  private static pollTimer: NodeJS.Timeout | null = null;

  // Redis Keys and State (DEF-EXT-02: Worker polling cursor state & health monitoring)
  private static readonly HEARTBEAT_KEY = 'worker:payout:heartbeat';
  private static readonly CHECKPOINT_KEY = 'worker:payout:checkpoint';
  private static readonly HEARTBEAT_TTL_SECONDS = 300; // 5-minute health check window

  private static totalProcessedCount = 0;
  private static lastHeartbeatState: PayoutWorkerHeartbeat | null = null;
  private static lastCheckpointState: PayoutWorkerCheckpoint | null = null;

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
   * Updates worker heartbeat in Redis and local memory state.
   */
  static async updateHeartbeat(
    status: 'idle' | 'polling' | 'error' | 'stopped',
    extra: Partial<PayoutWorkerHeartbeat> = {}
  ): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      const heartbeat: PayoutWorkerHeartbeat = {
        worker: 'payout',
        status,
        lastHeartbeat: nowIso,
        lastPolledAt: extra.lastPolledAt || this.lastHeartbeatState?.lastPolledAt || nowIso,
        lastPollCompletedAt: extra.lastPollCompletedAt || this.lastHeartbeatState?.lastPollCompletedAt,
        pollIntervalMs: extra.pollIntervalMs || this.lastHeartbeatState?.pollIntervalMs || 5000,
        lastBatchProcessedCount: extra.lastBatchProcessedCount ?? (this.lastHeartbeatState?.lastBatchProcessedCount || 0),
        totalProcessedCount: this.totalProcessedCount,
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
   * Updates persistent cursor checkpoint in Redis upon successfully processing an event.
   * Enables graceful resumption and progress monitoring across worker restarts (DEF-EXT-02).
   */
  static async updateCheckpoint(eventId: string, eventCreatedAt: Date, countDelta: number = 1): Promise<void> {
    try {
      this.totalProcessedCount += countDelta;
      const nowIso = new Date().toISOString();
      const checkpoint: PayoutWorkerCheckpoint = {
        worker: 'payout',
        lastProcessedEventId: eventId,
        lastEventCreatedAt: eventCreatedAt.toISOString(),
        lastPolledAt: nowIso,
        processedCount: this.totalProcessedCount,
        cursorTimestamp: eventCreatedAt.getTime(),
        updatedAt: nowIso,
      };

      this.lastCheckpointState = checkpoint;
      await this.safeRedisSet(this.CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch {
      // Safe fallback
    }
  }

  /**
   * Reads the current heartbeat from Redis, falling back to local memory if offline.
   */
  static async getHeartbeat(): Promise<PayoutWorkerHeartbeat | null> {
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
   * Reads the persistent cursor checkpoint from Redis, falling back to local memory if offline.
   */
  static async getCheckpoint(): Promise<PayoutWorkerCheckpoint | null> {
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
    this.totalProcessedCount = 0;
    this.lastCheckpointState = null;
    this.lastHeartbeatState = null;
  }

  /**
   * Dispatches a single payout to RazorpayX with strict timeout safety.
   */
  static async processPayout(payoutId: string): Promise<void> {
    let payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        user: true,
        paymentAccount: true,
        wallet: true,
      },
    });

    if (!payout) {
      await new Promise((r) => setTimeout(r, 50));
      payout = await prisma.payout.findUnique({
        where: { id: payoutId },
        include: {
          user: true,
          paymentAccount: true,
          wallet: true,
        },
      });
    }

    if (!payout) {
      console.warn(`[PAYOUT-WORKER] Payout ${payoutId} not found.`);
      return;
    }

    // Only process payouts that can be claimed from APPROVED status atomically
    const claim = await prisma.payout.updateMany({
      where: {
        id: payoutId,
        status: 'APPROVED',
      },
      data: {
        status: 'PAYOUT_INITIATED',
        initiatedAt: new Date(),
      },
    });

    if (claim.count !== 1) {
      console.log(`[PAYOUT-WORKER] Payout ${payoutId} is not in APPROVED state or already claimed. Skipping dispatch.`);
      return;
    }

    // Reload payout with relations after atomic claim
    const freshPayout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        user: true,
        paymentAccount: true,
        wallet: true,
      },
    });

    if (!freshPayout) {
      console.warn(`[PAYOUT-WORKER] Payout ${payoutId} not found after claiming.`);
      return;
    }
    payout = freshPayout;

    // Strict Authoritative Beneficiary Verification Gate before dispatch
    const kycRecord = await prisma.kycRecord.findFirst({
      where: { userId: payout.userId, panStatus: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
    });

    const beneficiaryCheck = PayoutService.validateBeneficiaryMatch(kycRecord, payout.paymentAccount);
    if (!beneficiaryCheck.isValid) {
      const reason = beneficiaryCheck.reason || 'Authoritative beneficiary identity verification failed prior to dispatch.';
      console.error(`[PAYOUT-WORKER] Payout ${payout.id} dispatch aborted: ${reason}`);
      await PayoutService.failBeforeDispatch(payout.id, reason);
      return;
    }

    if (payout.user.status !== 'ACTIVE') {
      const reason = `User account status is ${payout.user.status.toLowerCase()}. Disbursement aborted.`;
      console.error(`[PAYOUT-WORKER] Payout ${payout.id} dispatch aborted: ${reason}`);
      await PayoutService.failBeforeDispatch(payout.id, reason);
      return;
    }

    // Pre-validate and resolve bank account / UPI details prior to provider dispatch
    let upiAddress: string | undefined;
    let bankAccountNumber: string | undefined;
    try {
      if (payout.paymentAccount.accountType === 'UPI') {
        upiAddress = resolveUpiAddress(payout.paymentAccount);
        // Opportunistically migrate legacy unencrypted UPI row to AES-256-GCM
        if (payout.paymentAccount.upiId && !payout.paymentAccount.upiIdEncrypted) {
          try {
            await prisma.paymentAccount.update({
              where: { id: payout.paymentAccount.id },
              data: {
                upiIdEncrypted: encryptSensitive(upiAddress),
                upiId: null,
              },
            });
          } catch (_) {}
        }
      } else {
        bankAccountNumber = resolveBankAccountNumber(payout.paymentAccount);
      }
    } catch (err: any) {
      const reason = err.message || 'Payment account details invalid prior to dispatch.';
      console.error(`[PAYOUT-WORKER] Payout ${payout.id} pre-dispatch account validation failed: ${reason}`);
      await PayoutService.failBeforeDispatch(payout.id, reason);
      return;
    }

    const verifiedBeneficiaryName = (beneficiaryCheck.beneficiaryName || payout.paymentAccount.providerRegisteredName || '').trim();

    const isRazorpayConfigured = Boolean(
      config.razorpayx.keyId &&
      config.razorpayx.keySecret &&
      config.razorpayx.accountNumber
    );

    // Fail-closed check in production
    if (config.isProduction && !isRazorpayConfigured) {
      throw new Error('[FATAL] RazorpayX credentials not configured in production environment.');
    }

    // In test or dev without credentials, simulate processing
    if (!isRazorpayConfigured) {
      console.log(`[PAYOUT-WORKER] [DEV/TEST MODE] Simulating payout dispatch for ${payout.id}`);
      const mockPayoutId = `pout_mock_${Date.now()}`;
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'PROCESSING',
          razorpayPayoutId: mockPayoutId,
        },
      });
      return;
    }

    // Real RazorpayX Dispatch Flow
    const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
    const paymentAccount = payout.paymentAccount;

    // Pre-dispatch setup: Contact and Fund Account creation
    let fundAccountId: string;
    try {
      // 1. Resolve Contact on RazorpayX using authoritative beneficiary name
      const contactController = new AbortController();
      const contactTimer = setTimeout(() => contactController.abort(), 10000);
      let contactRes: globalThis.Response;
      try {
        contactRes = await fetch('https://api.razorpay.com/v1/contacts', {
          method: 'POST',
          signal: contactController.signal,
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: verifiedBeneficiaryName,
            contact: payout.user.mobile,
            type: 'vendor',
            reference_id: payout.user.id,
          }),
        });
      } finally {
        clearTimeout(contactTimer);
      }

      const contactData: any = await contactRes.json();
      const contactId = contactData.id;

      if (!contactRes.ok || !contactId || typeof contactId !== 'string') {
        throw new Error(contactData.error?.description || `Failed to create recipient contact on RazorpayX (HTTP ${contactRes.status})`);
      }

      // 2. Resolve Fund Account on RazorpayX using authoritative beneficiary name
      let fundAccountBody: any;
      if (paymentAccount.accountType === 'UPI') {
        fundAccountBody = {
          contact_id: contactId,
          account_type: 'vpa',
          vpa: { address: upiAddress },
        };
      } else {
        fundAccountBody = {
          contact_id: contactId,
          account_type: 'bank_account',
          bank_account: {
            name: verifiedBeneficiaryName,
            ifsc: paymentAccount.ifscCode,
            account_number: bankAccountNumber,
          },
        };
      }

      const fundAccController = new AbortController();
      const fundAccTimer = setTimeout(() => fundAccController.abort(), 10000);
      let fundAccRes: globalThis.Response;
      try {
        fundAccRes = await fetch('https://api.razorpay.com/v1/fund_accounts', {
          method: 'POST',
          signal: fundAccController.signal,
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fundAccountBody),
        });
      } finally {
        clearTimeout(fundAccTimer);
      }

      const fundAccData: any = await fundAccRes.json();
      fundAccountId = fundAccData.id;

      if (!fundAccRes.ok || !fundAccountId || typeof fundAccountId !== 'string') {
        throw new Error(fundAccData.error?.description || `Failed to create fund account on RazorpayX (HTTP ${fundAccRes.status})`);
      }

      // Save fund account ID
      await prisma.payout.update({
        where: { id: payout.id },
        data: { razorpayFundAccountId: fundAccountId },
      });
    } catch (setupErr: any) {
      console.error(`[PAYOUT-WORKER] Pre-dispatch setup failed for payout ${payout.id}: ${setupErr.message}. Refunding user balance.`);
      await PayoutService.failBeforeDispatch(payout.id, `Gateway account setup failed: ${setupErr.message}`);
      return;
    }

    // 3. Dispatch Payout with AbortController for network timeout handling
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s network timeout

      const amountInPaise = Number(toPaise(payout.amount));
      const mode = paymentAccount.accountType === 'UPI' ? 'UPI' : 'IMPS';

      let payoutRes: globalThis.Response;
      try {
        payoutRes = await fetch('https://api.razorpay.com/v1/payouts', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
            'X-Payout-Idempotency': payout.id, // Globally unique internal payout ID
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account_id: fundAccountId,
            amount: amountInPaise,
            currency: 'INR',
            mode,
            purpose: 'payout',
            queue_if_low_balance: true,
            reference_id: payout.id,
            narration: 'Hiralal Rewards',
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const payoutData: any = await payoutRes.json();

      if (payoutRes.ok) {
        const razorpayStatus = payoutData.status; // 'queued', 'pending', 'processing', 'processed'
        const razorpayPayoutId = payoutData.id;

        if (razorpayStatus === 'processed') {
          // Instant success
          await PayoutService.finalizeSuccess(payout.id, razorpayPayoutId);
        } else {
          // Queued or Processing: Wait for webhook or reconciliation
          // VULN-CRIT-02: Protect terminal states with CAS updates (do not overwrite SUCCESS/FAILED/REVERSED/REJECTED)
          const updated = await prisma.payout.updateMany({
            where: { id: payout.id, status: 'PAYOUT_INITIATED' },
            data: {
              status: 'PROCESSING',
              razorpayPayoutId,
            },
          });
          if (updated.count === 0 && razorpayPayoutId) {
            // Payout already reached terminal or non-INITIATED state; attach gateway ID safely without regressing status
            await prisma.payout.updateMany({
              where: { id: payout.id, razorpayPayoutId: null },
              data: { razorpayPayoutId },
            });
          }
        }
      } else {
        const isTransientClientError = [408, 409, 423, 429].includes(payoutRes.status);
        if (isTransientClientError) {
          // Transient 4xx Client Error: Rate limit (429), timeout (408), or conflict/in-flight (409)
          // TIMEOUT/TRANSIENT SAFETY: DO NOT REVERSE WALLET! Move to PROCESSING for reconciliation.
          console.warn(`[PAYOUT-WORKER] Gateway returned transient status ${payoutRes.status} for payout ${payout.id}. Moving to PROCESSING.`);
          await prisma.payout.updateMany({
            where: { id: payout.id, status: 'PAYOUT_INITIATED' },
            data: {
              status: 'PROCESSING',
              failureReason: `Gateway transient status ${payoutRes.status}: ${payoutData.error?.description || 'Transient client error'} (Pending reconciliation)`,
            },
          });
        } else if (payoutRes.status >= 400 && payoutRes.status < 500) {
          // Definitive Terminal Client Error: Bad request / invalid account / permanent rejection
          const reason = payoutData.error?.description || 'Disbursement rejected by payment gateway';
          console.warn(`[PAYOUT-WORKER] Payout ${payout.id} rejected by Razorpay: ${reason}`);
          await PayoutService.reversePayout(payout.id, reason);
        } else {
          // 5xx Server Error: Gateway is in ambiguous state!
          // TIMEOUT SAFETY: DO NOT REVERSE WALLET! Move to PROCESSING for reconciliation.
          console.error(`[PAYOUT-WORKER] Gateway 5xx response for payout ${payout.id}. Moving to PROCESSING.`);
          await prisma.payout.updateMany({
            where: { id: payout.id, status: 'PAYOUT_INITIATED' },
            data: {
              status: 'PROCESSING',
              failureReason: `Gateway returned status ${payoutRes.status} (Pending reconciliation)`,
            },
          });
        }
      }
    } catch (err: any) {
      // TIMEOUT OR NETWORK ERROR SAFETY:
      // Distributed payout safety rule: Network timeouts or connection drops MUST NOT reverse funds!
      // The transaction might have been accepted by the gateway. Move to PROCESSING.
      console.error(`[PAYOUT-WORKER] Network error/timeout for payout ${payout.id}: ${err.message}. Holding in PROCESSING for reconciliation.`);
      await prisma.payout.updateMany({
        where: { id: payout.id, status: 'PAYOUT_INITIATED' },
        data: {
          status: 'PROCESSING',
          failureReason: `Network error/timeout: ${err.message} (Pending reconciliation)`,
        },
      });
    }
  }

  /**
   * Polls OutboxEvent table for unprocessed PAYOUT_DISPATCH events with exponential backoff.
   * Tracks heartbeat, cursor state, and batch count in Redis for monitoring and graceful resumption (DEF-EXT-02).
   */
  static async processOutboxEvents(): Promise<number> {
    const now = Date.now();
    const pollTimestampIso = new Date(now).toISOString();
    await this.updateHeartbeat('polling', { lastPolledAt: pollTimestampIso });

    const leaseTimeout = new Date(now - 5 * 60 * 1000);
    let batchProcessed = 0;

    try {
      const candidateEvents = await prisma.outboxEvent.findMany({
        where: {
          eventType: 'PAYOUT_DISPATCH',
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });

      // DOS-03: Apply exponential backoff delay based on attempts to prevent head-of-line blocking:
      // Delay = attempts * 30 seconds (30s, 60s, 90s...). Fresh events (attempts=0) execute immediately.
      const runnableEvents = candidateEvents.filter((event) => {
        if (event.status === 'PROCESSING') {
          return event.updatedAt < leaseTimeout;
        }
        if (event.attempts === 0) {
          return true;
        }
        const backoffMs = event.attempts * 30 * 1000;
        return now - new Date(event.updatedAt).getTime() >= backoffMs;
      }).slice(0, 20);

      for (const event of runnableEvents) {
        try {
          // Atomic compare-and-swap claim to guarantee single worker execution
          const claimResult = await prisma.outboxEvent.updateMany({
            where: {
              id: event.id,
              status: event.status,
              updatedAt: event.updatedAt,
            },
            data: {
              status: 'PROCESSING',
              attempts: { increment: 1 },
            },
          });

          if (claimResult.count === 0) {
            // Another worker instance claimed this event concurrently
            continue;
          }

          const payload = event.payload as any;
          if (payload && payload.payoutId) {
            await this.processPayout(payload.payoutId);
          }

          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            },
          });

          batchProcessed++;
          // Persist cursor / checkpoint state in Redis for graceful resumption and monitoring (DEF-EXT-02)
          await this.updateCheckpoint(event.id, event.createdAt, 1);
        } catch (err: any) {
          console.error(`[OUTBOX-ERROR] Failed to process OutboxEvent ${event.id}:`, err.message);
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: event.attempts >= 5 ? 'FAILED' : 'PENDING',
              lastError: err.message,
            },
          });
        }
      }

      await this.updateHeartbeat('idle', {
        lastPollCompletedAt: new Date().toISOString(),
        lastBatchProcessedCount: batchProcessed,
      });

      return batchProcessed;
    } catch (err: any) {
      console.error('[OUTBOX-ERROR] Failed polling cycle:', err.message);
      await this.updateHeartbeat('error', {
        lastError: err.message,
        lastErrorAt: new Date().toISOString(),
      });
      return batchProcessed;
    }
  }

  /**
   * Starts periodic polling of OutboxEvent.
   */
  static startOutboxPolling(intervalMs = 5000): void {
    if (this.isOutboxPolling) return;
    this.isOutboxPolling = true;
    this.updateHeartbeat('idle', { pollIntervalMs: intervalMs }).catch(() => {});

    const poll = async () => {
      try {
        await this.processOutboxEvents();
      } catch (err: any) {
        console.error('[OUTBOX-POLL-ERROR]', err.message);
      } finally {
        if (this.isOutboxPolling) {
          this.pollTimer = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();
  }

  static stopOutboxPolling(): void {
    this.isOutboxPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.updateHeartbeat('stopped').catch(() => {});
  }
}
