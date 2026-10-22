import { PayoutWorker } from './payout.worker';
import { ReconciliationWorker } from './reconciliation.worker';
import { AccountDeletionWorker } from './account-deletion.worker';
import { checkDatabaseConnection } from '../db';
import { checkRedisConnection } from '../redis';

export { PayoutWorker, ReconciliationWorker, AccountDeletionWorker };

/**
 * Worker Daemon entrypoint for background processing container.
 */
export async function startWorkerDaemon(): Promise<void> {
  console.log('====================================================');
  console.log('⚙️ Starting Hiralal & Sons Background Worker Daemon...');
  console.log('====================================================');

  await checkDatabaseConnection();
  const redisHealthy = await checkRedisConnection();
  console.log(`Redis Healthcheck: ${redisHealthy ? 'CONNECTED' : 'DISCONNECTED / OFFLINE'}`);

  // Start durable outbox poller (default: 5 seconds)
  const rawPayout = parseInt(process.env.WORKER_PAYOUT_POLL_INTERVAL_MS || '5000', 10);
  const payoutIntervalMs = Number.isFinite(rawPayout) && rawPayout > 0 ? rawPayout : 5000;
  PayoutWorker.startOutboxPolling(payoutIntervalMs);
  console.log(`✅ Payout outbox dispatcher started (${payoutIntervalMs / 1000}s interval)`);

  // Start reconciliation worker (default: 3 minutes)
  const rawRecon = parseInt(process.env.WORKER_RECONCILIATION_INTERVAL_MS || '180000', 10);
  const reconIntervalMs = Number.isFinite(rawRecon) && rawRecon > 0 ? rawRecon : 180000;
  ReconciliationWorker.startReconciliation(reconIntervalMs);
  console.log(`✅ Gateway reconciliation worker started (${reconIntervalMs / 1000}s interval)`);

  // Start account deletion worker (default: 60 seconds)
  const rawDel = parseInt(process.env.WORKER_DELETION_INTERVAL_MS || '60000', 10);
  const deletionIntervalMs = Number.isFinite(rawDel) && rawDel > 0 ? rawDel : 60000;
  AccountDeletionWorker.startAccountDeletionWorker(deletionIntervalMs);
  console.log(`✅ Account deletion lifecycle worker started (${deletionIntervalMs / 1000}s interval)`);

  let isShuttingDown = false;
  const shutdown = async (signal: string = 'SIGTERM') => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`🛑 Received ${signal}. Shutting down background workers gracefully...`);
    try {
      PayoutWorker.stopOutboxPolling();
      ReconciliationWorker.stopReconciliation();
      AccountDeletionWorker.stopAccountDeletionWorker();

      // AUDIT-DB-03: Await active in-flight task completion before killing process
      await Promise.allSettled([
        PayoutWorker.drainInFlightTasks(15000),
        ReconciliationWorker.drainInFlightTasks(15000),
        AccountDeletionWorker.drainInFlightTasks(15000),
      ]);
    } catch (err: any) {
      console.error('[WORKER-SHUTDOWN-DRAIN-ERROR]', err?.message);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  startWorkerDaemon().catch((err) => {
    console.error('Fatal error in background worker daemon:', err);
    process.exit(1);
  });
}
