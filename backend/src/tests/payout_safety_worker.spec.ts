import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';
import { PayoutWorker } from '../worker/payout.worker';
import { ReconciliationWorker } from '../worker/reconciliation.worker';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';
import { config } from '../config';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('Payout Worker, Webhook Deduplication & Timeout Safety Tests', () => {
  let user: any;
  let adminUser: any;
  let paymentAccount: any;

  beforeAll(async () => {
    config.razorpayx.keyId = 'rzp_test_hiralal2026';
    config.razorpayx.keySecret = 'rzp_secret_hiralal2026';
    config.razorpayx.accountNumber = '2323230041123456';
    config.razorpayx.webhookSecret = 'webhook_secret_hiralal_rzpx_2026';

    // Clean up
    await prisma.webhookEvent.deleteMany({ where: { provider: 'RAZORPAYX' } });
    await prisma.payout.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.user.deleteMany({ where: { mobile: '9666666666' } });
    await prisma.user.deleteMany({ where: { mobile: '9888888889' } });

    user = await prisma.user.create({
      data: {
        mobile: '9666666666',
        fullName: 'Disbursement Craftsman',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 5000.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        },
      },
      include: { wallet: true },
    });

    adminUser = await getOrCreateOpsAdmin(prisma, '9888888889');

    await KycService.submitPan(user.id, 'ABCDE9876K', 'Disbursement Craftsman');
    paymentAccount = await PaymentService.addUpiAccount(user.id, 'disbursementsafety@upi');

    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
      },
      create: {
        id: 'default',
        isEnabled: true,
        startAt: new Date(Date.now() - 3600 * 1000),
        endAt: new Date(Date.now() + 86400 * 1000),
        minimumRedemptionAmount: 100.0,
      },
    });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { provider: 'RAZORPAYX' } });
    if (user) {
      await prisma.payout.deleteMany({ where: { userId: user.id } });
      await prisma.paymentAccount.deleteMany({ where: { userId: user.id } });
      await prisma.kycRecord.deleteMany({ where: { userId: user.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    if (adminUser && adminUser.mobile === '9888888889') {
      await prisma.notificationCampaign.deleteMany({ where: { createdByAdminId: adminUser.id } });
      await prisma.user.deleteMany({ where: { id: adminUser.id } });
    }
  });

  test('1. Timeout Safety: Simulated gateway network failure holds payout in PROCESSING without reversing funds', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const key = `idem-timeout-${Date.now()}`;
    const result = await PayoutService.requestRedemption(user.id, key);
    const payoutId = result.payout.id;

    // Admin approves redemption before worker dispatch
    await PayoutService.approveRedemption(payoutId, adminUser.id);

    // Simulate network error during dispatch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/contacts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'cont_test_123' }),
        });
      }
      if (url.includes('/fund_accounts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'fa_test_123' }),
        });
      }
      if (url.includes('/payouts')) {
        // Simulate network timeout error
        return Promise.reject(new Error('Gateway connection timed out: ETIMEDOUT'));
      }
      return originalFetch(url as any);
    });

    try {
      // Run payout worker dispatch
      await PayoutWorker.processPayout(payoutId);

      // Verify DB state
      const payoutAfter = await prisma.payout.findUnique({ where: { id: payoutId } });
      expect(payoutAfter?.status).toBe('PROCESSING');
      expect(payoutAfter?.failureReason).toMatch(/Network error\/timeout|ETIMEDOUT/i);

      // Critical check: Wallet funds MUST NOT be refunded yet!
      const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(walletAfter?.availableBalance)).toBe(0.0);
      expect(Number(walletAfter?.processingAmount)).toBe(5000.0);

      // Verify no reversal transaction was generated
      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: key, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.payout.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.update({
        where: { userId: user.id },
        data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
      });
    }
  });

  test('2. Definite 4xx Rejection: Safely marks FAILED, refunds available balance, creates PAYOUT_REVERSAL', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const key = `idem-rejected-${Date.now()}`;
    const result = await PayoutService.requestRedemption(user.id, key);
    const payoutId = result.payout.id;

    await PayoutService.approveRedemption(payoutId, adminUser.id);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/contacts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'cont_1' }) });
      }
      if (url.includes('/fund_accounts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'fa_1' }) });
      }
      if (url.includes('/payouts?')) {
        // HIR-H-03: provider lookup by reference_id confirms no payout exists
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
      }
      if (url.includes('/payouts')) {
        // 400 Bad Request
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { description: 'Beneficiary VPA handle invalid or closed' } }),
        });
      }
      return originalFetch(url as any);
    });

    try {
      await PayoutWorker.processPayout(payoutId);

      const payoutAfter = await prisma.payout.findUnique({ where: { id: payoutId } });
      expect(payoutAfter?.status).toBe('FAILED');
      expect(payoutAfter?.failureReason).toContain('Beneficiary VPA handle invalid');

      // Reversal ledger check
      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).not.toBeNull();
      expect(Number(reversalTx?.amount)).toBe(5000.0);

      const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(walletAfter?.availableBalance)).toBe(5000.0);
      expect(Number(walletAfter?.processingAmount)).toBe(0.0);
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.payout.deleteMany({ where: { userId: user.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.update({
        where: { userId: user.id },
        data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
      });
    }
  });

  test('HIR-H-03a: 4xx on dispatch does NOT refund when the provider already holds a payout for the reference', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const result = await PayoutService.requestRedemption(user.id, `idem-4xx-existing-${Date.now()}`);
    const payoutId = result.payout.id;
    await PayoutService.approveRedemption(payoutId, adminUser.id);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/contacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'cont_h03' }) });
      if (url.includes('/fund_accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'fa_h03' }) });
      if (url.includes('/payouts?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ id: 'pout_existing_h03', status: 'processing' }] }) });
      }
      if (url.includes('/payouts')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { description: 'Idempotency key used with a different request body' } }),
        });
      }
      return originalFetch(url as any);
    });

    try {
      await PayoutWorker.processPayout(payoutId);

      const payoutAfter = await prisma.payout.findUnique({ where: { id: payoutId } });
      expect(payoutAfter?.status).toBe('PROCESSING');
      expect(payoutAfter?.razorpayPayoutId).toBe('pout_existing_h03');

      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).toBeNull();
      const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(walletAfter?.processingAmount)).toBe(5000.0);
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.payout.deleteMany({ where: { userId: user.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.update({
        where: { userId: user.id },
        data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
      });
    }
  });

  test('HIR-H-03b: two concurrent dispatchers send exactly one provider payout request', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const result = await PayoutService.requestRedemption(user.id, `idem-concurrent-${Date.now()}`);
    const payoutId = result.payout.id;
    await PayoutService.approveRedemption(payoutId, adminUser.id);

    let payoutPosts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/contacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'cont_conc' }) });
      if (url.includes('/fund_accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'fa_conc' }) });
      if (url.includes('/payouts') && init?.method === 'POST') {
        payoutPosts++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'pout_conc', status: 'processing' }) });
      }
      return originalFetch(url as any);
    });

    try {
      await Promise.all([PayoutWorker.processPayout(payoutId), PayoutWorker.processPayout(payoutId)]);
      expect(payoutPosts).toBe(1);
      const payoutAfter = await prisma.payout.findUnique({ where: { id: payoutId } });
      expect(payoutAfter?.status).toBe('PROCESSING');
      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.payout.deleteMany({ where: { userId: user.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.update({
        where: { userId: user.id },
        data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
      });
    }
  });

  test('3. Webhook Deduplication: Prevents double-processing of identical eventId and holds unmatched event', async () => {
    // Create matching payout in PROCESSING status
    const payout = await prisma.payout.create({
      data: {
        userId: user.id,
        walletId: user.wallet.id,
        paymentAccountId: paymentAccount.id,
        paymentType: 'UPI',
        amount: 1000.0,
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_webhook_dedup_test',
        idempotencyKey: `idem-webhook-${Date.now()}`,
      },
    });

    await prisma.wallet.update({
      where: { id: user.wallet.id },
      data: { processingAmount: 1000.0 },
    });

    const eventId = `evt_dedup_${Date.now()}`;
    const payload = {
      id: eventId,
      event: 'payout.processed',
      payload: {
        payout: {
          entity: {
            id: 'pout_webhook_dedup_test',
            reference_id: payout.id,
            amount: 100000,
            currency: 'INR',
          },
        },
      },
    };

    // First delivery: matches payout and completes processing
    const res1 = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', eventId)
      .send(payload);

    expect(res1.status).toBe(200);

    // Duplicate delivery of processed event returns duplicate_ignored
    const res2 = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', eventId)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('duplicate_ignored');

    // Unmatched delivery is held for retry rather than marked permanently processed
    const unmatchedEventId = `evt_unmatched_${Date.now()}`;
    const unmatchedRes = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', unmatchedEventId)
      .send({
        id: unmatchedEventId,
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: 'pout_non_existent',
              reference_id: 'ref_dummy_non_existent',
            },
          },
        },
      });

    expect(unmatchedRes.status).toBe(200);
    expect(unmatchedRes.body.status).toBe('unmatched_held_for_retry');
  });

  test('3b. Webhook Alias Removed: POST /api/v1/payouts/webhook returns 404 (alias removed per F-02)', async () => {
    // F-02 audit fix: The duplicate webhook alias at /api/v1/payouts/webhook was removed.
    // Only /api/v1/webhook remains as the canonical endpoint.
    // This test verifies the alias no longer exists to prevent double-processing.
    const aliasRes = await request(app)
      .post('/api/v1/payouts/webhook')
      .set('x-razorpay-event-id', `evt_alias_${Date.now()}`)
      .send({ id: 'dummy', event: 'payout.processed' });

    expect(aliasRes.status).toBe(404);
  });

  test('4. Reconciliation Worker: Gracefully handles offline or mock gateway sync', async () => {
    const report = await ReconciliationWorker.reconcileStuckPayouts();
    expect(typeof report.reconciledCount).toBe('number');
    expect(Array.isArray(report.errors)).toBe(true);
  });

  test('5. Post-Success Reversal: handleReversedPayout safely reverses PROCESSED payout, decrements totalRedeemed, and refunds availableBalance', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    // 1. Setup a PROCESSED payout
    const key = `idem-post-rev-${Date.now()}`;
    const redemption = await PayoutService.requestRedemption(user.id, key);
    const payoutId = redemption.payout.id;

    await PayoutService.approveRedemption(payoutId, adminUser.id);

    // Finalize it as successful (simulating gateway settlement)
    await PayoutService.finalizeSuccess(payoutId, 'pout_gateway_success_123');

    const payoutBefore = await prisma.payout.findUnique({ where: { id: payoutId } });
    expect(payoutBefore?.status).toBe('SUCCESS');

    const walletBefore = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const initialRedeemed = Number(walletBefore?.totalRedeemed);
    const initialAvail = Number(walletBefore?.availableBalance);

    // 2. Gateway notifies payout was reversed post-settlement (e.g. beneficiary bank clawback)
    await PayoutService.handleReversedPayout(payoutId, 'Beneficiary bank rejected credit after clearing');

    // 3. Verify payout status is REVERSED
    const payoutAfter = await prisma.payout.findUnique({ where: { id: payoutId } });
    expect(payoutAfter?.status).toBe('REVERSED');
    expect(payoutAfter?.failureReason).toContain('Beneficiary bank rejected credit');

    // 4. Verify wallet compensation: totalRedeemed decremented by 5000, availableBalance incremented by 5000
    const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(Number(walletAfter?.totalRedeemed)).toBe(initialRedeemed - 5000);
    expect(Number(walletAfter?.availableBalance)).toBe(initialAvail + 5000);

    // 5. Verify compensation ledger entry was recorded
    const reversalTx = await prisma.walletTransaction.findFirst({
      where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
    });
    expect(reversalTx).not.toBeNull();
    expect(Number(reversalTx?.amount)).toBe(5000);

    // Clean up
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });
  });

  test('6. Payout Worker atomic claim: atomic status transition ensures worker idempotency', async () => {
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { availableBalance: 5000.0, processingAmount: 0.0, totalRedeemed: 0.0 },
    });

    const key = `idem-claim-${Date.now()}`;
    const redemption = await PayoutService.requestRedemption(user.id, key);
    const payoutId = redemption.payout.id;

    await PayoutService.approveRedemption(payoutId, adminUser.id);

    // Simulate 2 workers concurrently attempting to claim this payout
    const [claim1, claim2] = await Promise.all([
      prisma.payout.updateMany({
        where: { id: payoutId, status: 'APPROVED' },
        data: { status: 'PAYOUT_INITIATED', updatedAt: new Date() },
      }),
      prisma.payout.updateMany({
        where: { id: payoutId, status: 'APPROVED' },
        data: { status: 'PAYOUT_INITIATED', updatedAt: new Date() },
      }),
    ]);

    expect(claim1.count + claim2.count).toBe(1);
    expect([claim1.count, claim2.count].sort()).toEqual([0, 1]);
  });

  test('6b. Payout Worker never dispatches a payout held for manual review', async () => {
    const payout = await prisma.payout.create({
      data: {
        userId: user.id,
        walletId: user.wallet.id,
        paymentAccountId: paymentAccount.id,
        paymentType: paymentAccount.accountType,
        amount: 100.0,
        status: 'APPROVED',
        requiresManualReview: true,
        manualReviewReason: 'Test manual review hold',
        idempotencyKey: `manual-review-hold-${Date.now()}`,
      },
    });

    await PayoutWorker.processPayout(payout.id);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('APPROVED');
    expect(after.razorpayPayoutId).toBeNull();
    expect(after.requiresManualReview).toBe(true);

    await prisma.payout.delete({ where: { id: payout.id } });
  });

  test('7. PayoutService.queryGatewayByReference: gateway query handling', async () => {
    // Unconfigured credentials case
    const origKey = config.razorpayx.keyId;
    config.razorpayx.keyId = '';
    const unconfigured = await PayoutService.queryGatewayByReference('ref_test_123');
    expect(unconfigured.found).toBe(false);
    expect(unconfigured.message).toBe('Payment gateway credentials unconfigured');
    config.razorpayx.keyId = origKey;

    // Mock fetch for gateway response
    const origFetch = global.fetch;
    try {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'pout_12345', status: 'processed' }] }),
      } as any);
      const found = await PayoutService.queryGatewayByReference('ref_test_123');
      expect(found.found).toBe(true);
      expect(found.payout.id).toBe('pout_12345');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as any);
      const notFound = await PayoutService.queryGatewayByReference('ref_test_empty');
      expect(notFound.found).toBe(false);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);
      const failed = await PayoutService.queryGatewayByReference('ref_test_fail');
      expect(failed.found).toBe(false);
      expect(failed.message).toContain('Gateway query returned status 500');

      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network failure'));
      const errorRes = await PayoutService.queryGatewayByReference('ref_test_err');
      expect(errorRes.found).toBe(false);
      expect(errorRes.message).toBe('Network failure');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('8. DEF-EXT-02: PayoutWorker tracks heartbeat, last polled timestamp, and cursor checkpoint in Redis', async () => {
    PayoutWorker.resetMetrics();
    await prisma.outboxEvent.deleteMany({ where: { eventType: 'PAYOUT_DISPATCH' } });

    // Create a mock payout to be processed by outbox event
    const testPayout = await prisma.payout.create({
      data: {
        userId: user.id,
        walletId: user.wallet.id,
        paymentAccountId: paymentAccount.id,
        paymentType: 'UPI',
        amount: 250.0,
        status: 'APPROVED',
        idempotencyKey: `idem-outbox-cursor-${Date.now()}`,
      },
    });

    // Create an outbox event for this payout
    const outboxEvent = await prisma.outboxEvent.create({
      data: {
        eventType: 'PAYOUT_DISPATCH',
        payload: { payoutId: testPayout.id },
        status: 'PENDING',
        attempts: 0,
      },
    });

    try {
      const processedCount = await PayoutWorker.processOutboxEvents();
      expect(processedCount).toBeGreaterThanOrEqual(1);

      // Verify worker heartbeat
      const heartbeat = await PayoutWorker.getHeartbeat();
      expect(heartbeat).not.toBeNull();
      expect(heartbeat?.worker).toBe('payout');
      expect(heartbeat?.status).toBe('idle');
      expect(heartbeat?.lastPolledAt).toBeDefined();
      expect(heartbeat?.lastPollCompletedAt).toBeDefined();
      expect(heartbeat?.lastBatchProcessedCount).toBeGreaterThanOrEqual(1);
      expect(heartbeat?.totalProcessedCount).toBeGreaterThanOrEqual(1);

      // Verify cursor checkpoint (DEF-EXT-02 resilience)
      const checkpoint = await PayoutWorker.getCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.worker).toBe('payout');
      expect(checkpoint?.lastProcessedEventId).toBe(outboxEvent.id);
      expect(checkpoint?.cursorTimestamp).toBeDefined();
      expect(checkpoint?.processedCount).toBeGreaterThanOrEqual(1);
      expect(checkpoint?.updatedAt).toBeDefined();
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { id: outboxEvent.id } });
      await prisma.payout.deleteMany({ where: { id: testPayout.id } });
    }
  });

  test('9. DEF-EXT-02: ReconciliationWorker tracks heartbeat, last polled timestamp, and cursor checkpoint in Redis', async () => {
    ReconciliationWorker.resetMetrics();

    await ReconciliationWorker.reconcileStuckPayouts();

    // Verify heartbeat
    const heartbeat = await ReconciliationWorker.getHeartbeat();
    expect(heartbeat).not.toBeNull();
    expect(heartbeat?.worker).toBe('reconciliation');
    expect(heartbeat?.lastPolledAt).toBeDefined();
    expect(typeof heartbeat?.totalReconciledCount).toBe('number');
    expect(typeof heartbeat?.totalWebhooksRetriedCount).toBe('number');

    // Verify checkpoint
    const checkpoint = await ReconciliationWorker.getCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.worker).toBe('reconciliation');
    expect(checkpoint?.lastCheckpointAt).toBeDefined();
    expect(checkpoint?.updatedAt).toBeDefined();
    expect(typeof checkpoint?.totalReconciledCount).toBe('number');
  });

  test('10. DEF-EXT-02: Resilience - workers safely continue without crashing when Redis is offline or throws errors', async () => {
    // Test simulated Redis error during heartbeat & checkpoint update
    const origSet = (PayoutWorker as any).safeRedisSet;
    const origGet = (PayoutWorker as any).safeRedisGet;

    try {
      // Force internal Redis calls to fail
      (PayoutWorker as any).safeRedisSet = jest.fn().mockRejectedValue(new Error('Redis connection lost ECONNRESET'));
      (PayoutWorker as any).safeRedisGet = jest.fn().mockRejectedValue(new Error('Redis offline'));

      // Both heartbeat and checkpoint must swallow the error gracefully and continue
      await expect(PayoutWorker.updateHeartbeat('polling')).resolves.not.toThrow();
      await expect(PayoutWorker.updateCheckpoint('mock-event-id', new Date(), 1)).resolves.not.toThrow();

      // ReconciliationWorker safe Redis calls
      (ReconciliationWorker as any).safeRedisSet = jest.fn().mockRejectedValue(new Error('Redis timeout'));
      (ReconciliationWorker as any).safeRedisGet = jest.fn().mockRejectedValue(new Error('Redis timeout'));

      await expect(ReconciliationWorker.updateHeartbeat('running')).resolves.not.toThrow();
      await expect(ReconciliationWorker.updateCheckpoint({ reconciledIncrement: 1 })).resolves.not.toThrow();

      // Confirm workers still function cleanly
      const pHeartbeat = await PayoutWorker.getHeartbeat();
      expect(pHeartbeat).toBeDefined();

      const rHeartbeat = await ReconciliationWorker.getHeartbeat();
      expect(rHeartbeat).toBeDefined();
    } finally {
      (PayoutWorker as any).safeRedisSet = origSet;
      (PayoutWorker as any).safeRedisGet = origGet;
    }
  });
});
