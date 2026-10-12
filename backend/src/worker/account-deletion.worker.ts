import { prisma } from '../db';
import { getRedisClient, isRedisReady } from '../redis';
import { AccountDeletionService } from '../services/account-deletion.service';

export class AccountDeletionWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;
  private static readonly LOCK_KEY = 'lock:account-deletion-worker';
  private static readonly LOCK_TTL_SECONDS = 55;

  /**
   * Attempts to acquire a distributed lock in Redis to ensure single-instance execution
   * across multiple worker replicas.
   */
  private static async acquireLock(workerInstanceId: string): Promise<boolean> {
    if (!isRedisReady()) {
      return true; // Fallback to local execution if Redis is not connected (e.g. non-clustered dev)
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
      return true;
    }
  }

  private static async releaseLock(workerInstanceId: string): Promise<void> {
    if (!isRedisReady()) return;

    try {
      const redis = getRedisClient();
      const currentHolder = await redis.get(this.LOCK_KEY);
      if (currentHolder === workerInstanceId) {
        await redis.del(this.LOCK_KEY);
      }
    } catch {
      // Ignore release error, will expire via TTL
    }
  }

  /**
   * Executes one run of scheduled account deletion processing.
   */
  static async processTick(): Promise<{ processedCount: number; errorsCount: number }> {
    const workerInstanceId = `del-worker-${process.pid}-${Date.now()}`;
    const hasLock = await this.acquireLock(workerInstanceId);
    if (!hasLock) {
      return { processedCount: 0, errorsCount: 0 };
    }

    try {
      const result = await AccountDeletionService.processScheduledDeletions(prisma);
      if (result.processedCount > 0) {
        console.log(`🗑️ [ACCOUNT-DELETION-WORKER] Processed ${result.processedCount} scheduled account deletion(s).`);
      }
      if (result.errors.length > 0) {
        console.error(`⚠️ [ACCOUNT-DELETION-WORKER] Encountered ${result.errors.length} deletion error(s):`, result.errors);
      }
      return {
        processedCount: result.processedCount,
        errorsCount: result.errors.length,
      };
    } finally {
      await this.releaseLock(workerInstanceId);
    }
  }

  /**
   * Starts periodic execution of the account deletion lifecycle worker.
   */
  static startAccountDeletionWorker(intervalMs = 60000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const tick = async () => {
      try {
        await this.processTick();
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
