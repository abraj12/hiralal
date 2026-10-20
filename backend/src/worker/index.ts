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
  const payoutIntervalMs = parseInt(process.env.WORKER_PAYOUT_POLL_INTERVAL_MS || '5000', 10);
  PayoutWorker.startOutboxPolling(payoutIntervalMs);
  console.log(`✅ Payout outbox dispatcher started (${payoutIntervalMs / 1000}s interval)`);

  // Start reconciliation worker (default: 3 minutes)
  const reconIntervalMs = parseInt(process.env.WORKER_RECONCILIATION_INTERVAL_MS || '180000', 10);
  ReconciliationWorker.startReconciliation(reconIntervalMs);
  console.log(`✅ Gateway reconciliation worker started (${reconIntervalMs / 1000}s interval)`);

  // Start account deletion worker (default: 60 seconds)
  const deletionIntervalMs = parseInt(process.env.WORKER_DELETION_INTERVAL_MS || '60000', 10);
  AccountDeletionWorker.startAccountDeletionWorker(deletionIntervalMs);
  console.log(`✅ Account deletion lifecycle worker started (${deletionIntervalMs / 1000}s interval)`);

  const shutdown = () => {
    console.log('🛑 Shutting down background workers gracefully...');
    PayoutWorker.stopOutboxPolling();
    ReconciliationWorker.stopReconciliation();
    AccountDeletionWorker.stopAccountDeletionWorker();
    process.exit(0);
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
