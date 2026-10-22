import { prisma } from '../db';
import { getRedisClient, isRedisReady } from '../redis';
import { AccountDeletionService } from '../services/account-deletion.service';
import { config } from '../config';

export class AccountDeletionWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;
  private static readonly LOCK_KEY = 'lock:account-deletion-worker';
  private static readonly LOCK_TTL_SECONDS = 55;

  private static readonly LUA_RELEASE_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  private static readonly LUA_RENEW_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("EXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  /**
   * Attempts to acquire a distributed lock in Redis to ensure single-instance execution
   * across multiple worker replicas.
   * Fails closed if Redis is offline in production or if an unexpected error occurs.
   */
  private static async acquireLock(workerInstanceId: string): Promise<boolean> {
    if (!isRedisReady()) {
      if (config.nodeEnv === 'production') {
        console.warn('[ACCOUNT-DELETION-WORKER] Redis is offline in production; failing closed to prevent concurrent execution.');
        return false;
      }
      return false; // Fail closed by default
    }

    try {
      const redis = getRedisClient();
      const acquired = await redis.set(
        this.LOCK_KEY,
        workerInstanceId,
        'EX',
        this.LOCK_TTL_SECONDS,
        'NX'
      );
      return acquired === 'OK';
    } catch (err: any) {
      console.warn('[ACCOUNT-DELETION-LOCK-WARN] Redis lock error:', err.message);
      return false; // Fail closed on error
    }
  }

  /**
   * Releases distributed lock atomically using Lua script.
   */
  private static async releaseLock(workerInstanceId: string): Promise<void> {
    if (!isRedisReady()) return;

    try {
      const redis = getRedisClient();
      await redis.eval(this.LUA_RELEASE_SCRIPT, 1, this.LOCK_KEY, workerInstanceId);
    } catch (err: any) {
      console.warn('[ACCOUNT-DELETION-LOCK-RELEASE-WARN] Lua release error:', err.message);
    }
  }

  /**
   * Renews the lock TTL periodically for long-running batches.
   */
  static async renewLock(workerInstanceId: string): Promise<boolean> {
    if (!isRedisReady()) return false;

    try {
      const redis = getRedisClient();
      const result = await redis.eval(
        this.LUA_RENEW_SCRIPT,
        1,
        this.LOCK_KEY,
        workerInstanceId,
        this.LOCK_TTL_SECONDS
      );
      return result === 1;
    } catch {
      return false;
    }
  }

  /**
   * Executes one run of scheduled account deletion processing.
   * Renews the Redis lock every HEARTBEAT_INTERVAL_MS during the batch to
   * prevent TTL expiry on long runs. An assertLease callback is passed into
   * processScheduledDeletions() so each per-user operation aborts immediately
   * if lock ownership was lost (e.g., Redis restart, network partition).
   */
  static async processTick(): Promise<{ processedCount: number; errorsCount: number }> {
    const workerInstanceId = `del-worker-${process.pid}-${Date.now()}`;
    const hasLock = await this.acquireLock(workerInstanceId);
    if (!hasLock) {
      return { processedCount: 0, errorsCount: 0 };
    }

    // Heartbeat: renew lock every 15 seconds while batch is in flight.
    // LOCK_TTL_SECONDS = 55, so we renew well before expiry.
    // Guard against overlapping concurrent renewals and dangling intervals on shutdown.
    const HEARTBEAT_INTERVAL_MS = 15_000;
    let leaseActive = true;
    let stopped = false;
    let renewalInProgress = false;

    const heartbeat = setInterval(async () => {
      if (stopped || !leaseActive || renewalInProgress) return;
      renewalInProgress = true;
      try {
        const renewed = await this.renewLock(workerInstanceId);
        if (!renewed) {
          leaseActive = false;
          console.warn('[ACCOUNT-DELETION-WORKER] Failed to renew lock — lease may have been lost. Stopping after current user.');
        }
      } catch {
        leaseActive = false;
      } finally {
        renewalInProgress = false;
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof heartbeat.unref === 'function') {
      heartbeat.unref();
    }

    // assertLease is called before each per-user DB mutation inside the service.
    const assertLease = () => {
      if (!leaseActive) {
        throw new Error('Account deletion worker lost its distributed lock. Aborting batch to prevent concurrent execution.');
      }
    };

    try {
      const result = await AccountDeletionService.processScheduledDeletions(prisma, assertLease, workerInstanceId);
      if (result.processedCount > 0) {
        console.log(`🗑️ [ACCOUNT-DELETION-WORKER] Processed ${result.processedCount} scheduled account deletion(s).`);
      }
      if (result.errors.length > 0) {
        console.error(`⚠️ [ACCOUNT-DELETION-WORKER] Encountered ${result.errors.length} deletion error(s):`, result.errors);
      }

      // VULN-HIGH-05: Purge expired statutory records (8-year retention expired and no legal hold)
      try {
        const purgedCount = await AccountDeletionService.purgeExpiredStatutoryRecords(prisma);
        if (purgedCount > 0) {
          console.log(`🧹 [ACCOUNT-DELETION-WORKER] Purged ${purgedCount} expired statutory retention record(s).`);
        }
      } catch (purgeErr: any) {
        console.error('⚠️ [ACCOUNT-DELETION-WORKER] Failed to purge expired statutory records:', purgeErr.message);
      }

      return {
        processedCount: result.processedCount,
        errorsCount: result.errors.length,
      };
    } finally {
      stopped = true;
      leaseActive = false;
      clearInterval(heartbeat);
      await this.releaseLock(workerInstanceId);
    }
  }

  private static activeTasks = new Set<Promise<any>>();

  static trackActiveTask<T>(promise: Promise<T>): Promise<T> {
    this.activeTasks.add(promise);
    promise.finally(() => this.activeTasks.delete(promise));
    return promise;
  }

  /**
   * AUDIT-DB-03: Drains in-flight account deletion tasks before process termination.
   */
  static async drainInFlightTasks(timeoutMs = 15000): Promise<void> {
    this.stopAccountDeletionWorker();
    if (this.activeTasks.size === 0) return;
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([Promise.allSettled(Array.from(this.activeTasks)), timeoutPromise]);
  }

  /**
   * Starts periodic execution of the account deletion lifecycle worker.
   */
  static startAccountDeletionWorker(intervalMs = 60000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const tick = async () => {
      try {
        const task = this.processTick();
        this.trackActiveTask(task);
        await task;
      } catch (err: any) {
        console.error('[ACCOUNT-DELETION-WORKER-TICK-ERROR]', err.message);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(tick, intervalMs);
        }
      }
    };

    tick();
  }

  static stopAccountDeletionWorker(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
