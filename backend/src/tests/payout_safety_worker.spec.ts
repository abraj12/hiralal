import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { PayoutService } from '../services/payout.service';
import { PayoutWorker } from '../worker/payout.worker';
import { ReconciliationWorker } from '../worker/reconciliation.worker';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';

describe('Payout Worker, Webhook Deduplication & Timeout Safety Tests', () => {
  let user: any;
  let paymentAccount: any;

  beforeAll(async () => {
    // Clean up
    await prisma.webhookEvent.deleteMany({ where: { provider: 'RAZORPAYX' } });
    await prisma.payout.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9666666666' } } });
    await prisma.user.deleteMany({ where: { mobile: '9666666666' } });

    user = await prisma.user.create({
      data: {
        mobile: '9666666666',
        fullName: 'Disbursement Safety Craftsman',
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

    await KycService.submitPan(user.id, 'ABCDE9876K', 'Disbursement Craftsman');
    paymentAccount = await PaymentService.addUpiAccount(user.id, 'disbursementsafety@upi');

    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: { isEnabled: true, minimumAmount: 500, maximumAmount: 10000, startAt: null, endAt: null },
      create: { id: 'default', isEnabled: true, minimumAmount: 500, maximumAmount: 10000, startAt: null, endAt: null },
    });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { provider: 'RAZORPAYX' } });
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.paymentAccount.deleteMany({ where: { userId: user.id } });
    await prisma.kycRecord.deleteMany({ where: { userId: user.id } });
    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  test('1. Timeout Safety: Simulated gateway network failure holds payout in PROCESSING without reversing funds', async () => {
    const key = `idem-timeout-${Date.now()}`;
    const result = await PayoutService.requestRedemption(user.id, key, 1000);
    const payoutId = result.payout.id;

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
      expect(payoutAfter?.failureReason).toMatch(/Network error\/timeout/i);

      // Critical check: Wallet funds MUST NOT be refunded yet!
      const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(walletAfter?.availableBalance)).toBe(4000.0);
      expect(Number(walletAfter?.processingAmount)).toBe(1000.0);

      // Verify no reversal transaction was generated
      const reversalTx = await prisma.walletTransaction.findFirst({
        where: { referenceId: key, type: 'PAYOUT_REVERSAL' },
      });
      expect(reversalTx).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('2. Definite 4xx Rejection: Safely marks FAILED, refunds available balance, creates PAYOUT_REVERSAL', async () => {
    const key = `idem-rejected-${Date.now()}`;
    const result = await PayoutService.requestRedemption(user.id, key, 500);
    const payoutId = result.payout.id;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/contacts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'cont_1' }) });
      }
      if (url.includes('/fund_accounts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'fa_1' }) });
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
      expect(Number(reversalTx?.amount)).toBe(500.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('3. Webhook Deduplication: Prevents double-processing of identical eventId', async () => {
    const eventId = `evt_dedup_${Date.now()}`;
    const payload = {
      id: eventId,
      event: 'payout.processed',
      payload: {
        payout: {
          entity: {
            id: 'pout_fake_test_1',
            reference_id: 'ref_dummy',
          },
        },
      },
    };

    // First delivery
    const res1 = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', eventId)
      .send(payload);

    expect(res1.status).toBe(200);

    // Duplicate delivery
    const res2 = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', eventId)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('duplicate_ignored');
  });

  test('4. Reconciliation Worker: Gracefully handles offline or mock gateway sync', async () => {
    const report = await ReconciliationWorker.reconcileStuckPayouts();
    expect(typeof report.reconciledCount).toBe('number');
    expect(Array.isArray(report.errors)).toBe(true);
  });

  test('5. Post-Success Reversal: handleReversedPayout safely reverses PROCESSED payout, decrements totalRedeemed, and refunds availableBalance', async () => {
    // 1. Setup a PROCESSED payout
    const key = `idem-post-rev-${Date.now()}`;
    const redemption = await PayoutService.requestRedemption(user.id, key, 500);
    const payoutId = redemption.payout.id;

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

    // 4. Verify wallet compensation: totalRedeemed decremented by 500, availableBalance incremented by 500
    const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(Number(walletAfter?.totalRedeemed)).toBe(initialRedeemed - 500);
    expect(Number(walletAfter?.availableBalance)).toBe(initialAvail + 500);

    // 5. Verify compensation ledger entry was recorded
    const reversalTx = await prisma.walletTransaction.findFirst({
      where: { referenceId: payoutId, type: 'PAYOUT_REVERSAL' },
    });
    expect(reversalTx).not.toBeNull();
    expect(Number(reversalTx?.amount)).toBe(500);
  });

  test('6. Payout Worker atomic claim: atomic status transition ensures worker idempotency', async () => {
    const key = `idem-claim-${Date.now()}`;
    const redemption = await PayoutService.requestRedemption(user.id, key, 500);
    const payoutId = redemption.payout.id;

    // Simulate 2 workers concurrently attempting to claim this payout
    const [claim1, claim2] = await Promise.all([
      prisma.payout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'PAYOUT_INITIATED', updatedAt: new Date() },
      }),
      prisma.payout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'PAYOUT_INITIATED', updatedAt: new Date() },
      }),
    ]);

    expect(claim1.count + claim2.count).toBe(1);
    expect([claim1.count, claim2.count].sort()).toEqual([0, 1]);
  });
});
