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

  // Start durable outbox poller (checks every 5 seconds)
  PayoutWorker.startOutboxPolling(5000);
  console.log('✅ Payout outbox dispatcher started (5s interval)');

  // Start reconciliation worker (checks every 3 minutes)
  ReconciliationWorker.startReconciliation(180000);
  console.log('✅ Gateway reconciliation worker started (180s interval)');

  // Start account deletion worker (checks every 60 seconds)
  AccountDeletionWorker.startAccountDeletionWorker(60000);
  console.log('✅ Account deletion lifecycle worker started (60s interval)');

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
