import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { ReconciliationWorker } from '../worker/reconciliation.worker';
import { PayoutService } from '../services/payout.service';
import { AccountDeletionService } from '../services/account-deletion.service';

describe('Auditor Remediation Regression Suite: Financial Drift, Statutory Purge & Parity Defenses', () => {
  const testMobilePrefix = '95555';
  let user1: any;
  let user2: any;
  let payout1: any;
  let paymentAccount1: any;

  beforeAll(async () => {
    config.razorpayx.keyId = 'rzp_test_reconcile_auditor';
    config.razorpayx.keySecret = 'rzp_secret_reconcile_auditor';
    config.razorpayx.accountNumber = '2323230041123499';
    config.razorpayx.webhookSecret = 'webhook_secret_hiralal_rzpx_2026';

    // Cleanup existing test data
    await prisma.webhookEvent.deleteMany({
      where: { eventId: { startsWith: 'evt_audit_reconcile_' } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { startsWith: testMobilePrefix } } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { startsWith: testMobilePrefix } },
    });

    // Create user 1 with ₹50,000 available balance
    user1 = await prisma.user.create({
      data: {
        mobile: `${testMobilePrefix}00001`,
        fullName: 'Audit Financial Drift User',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 50000.0,
            processingAmount: 0.0,
            totalRedeemed: 2000.0,
          },
        },
      },
      include: { wallet: true },
    });

    paymentAccount1 = await prisma.paymentAccount.create({
      data: {
        userId: user1.id,
        accountType: 'UPI',
        upiId: 'audittest@upi',
        accountHolderName: 'Audit Financial Drift User',
        maskedInfo: 'XXXXtest@upi',
        isVerified: true,
      },
    });

    // Create payout of ₹500 in FAILED status (simulating a failed payout that refunded points)
    payout1 = await prisma.payout.create({
      data: {
        userId: user1.id,
        walletId: user1.wallet.id,
        paymentAccountId: paymentAccount1.id,
        paymentType: 'UPI',
        amount: 500.0,
        status: 'FAILED',
        razorpayPayoutId: 'pout_drift_test_123',
        idempotencyKey: `idem-drift-${Date.now()}`,
        failureReason: 'Network error/timeout: initial dispatch aborted',
      },
    });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({
      where: { eventId: { startsWith: 'evt_audit_reconcile_' } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: { startsWith: testMobilePrefix } } } },
    });
    await prisma.payout.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { startsWith: testMobilePrefix } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { startsWith: testMobilePrefix } },
    });
  });

  test('Critical: Reconciliation worker handles late-success payout drift with exact ledger clawback rather than zeroing wallet', async () => {
    const eventId = `evt_audit_reconcile_drift_${Date.now()}`;
    const payload = {
      id: eventId,
      event: 'payout.processed',
      payload: {
        payout: {
          entity: {
            id: 'pout_drift_test_123',
            reference_id: payout1.id,
            amount: 50000, // ₹500 in paise
            currency: 'INR',
          },
        },
      },
    };

    // Store webhook event in DB as pending retry
    await prisma.webhookEvent.create({
      data: {
        provider: 'RAZORPAYX',
        eventId,
        eventType: 'payout.processed',
        payload,
        isProcessed: false,
        attempts: 0,
      },
    });

    // Execute worker retry batch
    const retriedCount = await ReconciliationWorker.retryUnprocessedWebhooks();
    expect(retriedCount).toBeGreaterThanOrEqual(1);

    // Verify wallet balances: 50,000 - 500 = 49,500 (NOT 0!)
    const updatedWallet = await prisma.wallet.findUnique({
      where: { id: user1.wallet.id },
    });
    expect(Number(updatedWallet?.availableBalance)).toBe(49500.0);
    expect(Number(updatedWallet?.totalRedeemed)).toBe(2500.0); // 2000 + 500

    // Verify payout updated to SUCCESS and marked for manual review
    const updatedPayout = await prisma.payout.findUnique({
      where: { id: payout1.id },
    });
    expect(updatedPayout?.status).toBe('SUCCESS');
    expect(updatedPayout?.requiresManualReview).toBe(true);
    expect(updatedPayout?.manualReviewReason).toContain('CRITICAL FINANCIAL DRIFT');

    // Verify ledger transaction created with exact payout amount (500, NOT 0)
    const ledgerTx = await prisma.walletTransaction.findFirst({
      where: {
        walletId: user1.wallet.id,
        referenceId: payout1.id,
        type: 'PAYOUT_DEBIT',
      },
    });
    expect(ledgerTx).not.toBeNull();
    expect(Number(ledgerTx?.amount)).toBe(500.0);
    expect(Number(ledgerTx?.balanceAfter)).toBe(49500.0);

    // Verify user account suspended
    const updatedUser = await prisma.user.findUnique({
      where: { id: user1.id },
    });
    expect(updatedUser?.status).toBe('SUSPENDED');
  });

  test('Critical: concurrent distinct webhook events apply a financial drift clawback only once', async () => {
    const payout = await prisma.payout.create({
      data: {
        userId: user1.id,
        walletId: user1.wallet.id,
        paymentAccountId: paymentAccount1.id,
        paymentType: 'UPI',
        amount: 100.0,
        status: 'FAILED',
        idempotencyKey: `idem-concurrent-drift-${Date.now()}`,
      },
    });
    const beforeWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user1.wallet.id } });
    const beforeLedgerCount = await prisma.walletTransaction.count({ where: { referenceId: payout.id, type: 'PAYOUT_DEBIT' } });

    const results = await Promise.all([
      PayoutService.handleFinancialDriftClawback(payout.id, 'pout_concurrent_event', 'event A'),
      PayoutService.handleFinancialDriftClawback(payout.id, 'pout_concurrent_event', 'event B'),
    ]);

    expect(results).toHaveLength(2);
    const afterWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user1.wallet.id } });
    expect(Number(afterWallet.availableBalance)).toBe(Number(beforeWallet.availableBalance) - 100.0);
    expect(Number(afterWallet.totalRedeemed)).toBe(Number(beforeWallet.totalRedeemed) + 100.0);
    expect(await prisma.walletTransaction.count({ where: { referenceId: payout.id, type: 'PAYOUT_DEBIT' } })).toBe(beforeLedgerCount + 1);
    const afterPayout = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(afterPayout.status).toBe('SUCCESS');
    expect(afterPayout.requiresManualReview).toBe(true);
  });

  test('High: Statutory retention purge completely scrubs legacy/encrypted PII and strictly respects legal holds under transaction', async () => {
    const expiredTimestamp = new Date(Date.now() - 3600 * 1000); // 1 hour ago

    // User A: Suspended, expired retention, legalHold = false (eligible for purge)
    const eligibleUser = await prisma.user.create({
      data: {
        mobile: `${testMobilePrefix}00002`,
        fullName: 'Eligible For Purge',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'SUSPENDED',
        legalHold: false,
        statutoryRetentionExpiresAt: expiredTimestamp,
        kycRecords: {
          create: {
            panNumber: 'ABCDE1111A',
            panName: 'Eligible Person',
            maskedPan: 'ABCDE1111A',
            panNumberEncrypted: 'enc_pan_pkg',
            panBlindIndex: 'bindex_eligible_1',
            verifiedName: 'Eligible Person',
            consentText: 'I consent to PAN verification',
          },
        },
        paymentAccounts: {
          create: {
            accountType: 'BANK_ACCOUNT',
            accountNumber: '9998887771',
            accountNumberEncrypted: 'enc_acc_pkg',
            accountHolderName: 'Eligible Person',
            providerRegisteredName: 'Eligible Person',
            ifscCode: 'SBIN0001234',
            bankName: 'State Bank of India',
            upiId: 'eligible@upi',
            upiIdEncrypted: 'enc_upi_pkg',
            beneficiaryBlindIndex: 'bindex_pay_eligible_1',
            maskedInfo: 'XXXX7771',
            isVerified: true,
          },
        },
      },
      include: { kycRecords: true, paymentAccounts: true },
    });

    // User B: Suspended, expired retention, legalHold = true (BLOCKED from purge)
    const heldUser = await prisma.user.create({
      data: {
        mobile: `${testMobilePrefix}00003`,
        fullName: 'Held By Law Enforcement',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'SUSPENDED',
        legalHold: true, // STATUTORY LEGAL HOLD ACTIVE
        statutoryRetentionExpiresAt: expiredTimestamp,
        kycRecords: {
          create: {
            panNumber: 'ABCDE2222B',
            panName: 'Held Person',
            maskedPan: 'ABCDE2222B',
            panNumberEncrypted: 'enc_pan_held',
            panBlindIndex: 'bindex_held_2',
            verifiedName: 'Held Person',
            consentText: 'I consent to PAN verification',
          },
        },
        paymentAccounts: {
          create: {
            accountType: 'BANK_ACCOUNT',
            accountNumber: '9998887772',
            accountNumberEncrypted: 'enc_acc_held',
            accountHolderName: 'Held Person',
            providerRegisteredName: 'Held Person',
            ifscCode: 'HDFC0001234',
            bankName: 'HDFC Bank',
            upiId: 'held@upi',
            upiIdEncrypted: 'enc_upi_held',
            beneficiaryBlindIndex: 'bindex_pay_held_2',
            maskedInfo: 'XXXX7772',
            isVerified: true,
          },
        },
      },
      include: { kycRecords: true, paymentAccounts: true },
    });

    // Execute purge
    const purgedCount = await AccountDeletionService.purgeExpiredStatutoryRecords(prisma);
    expect(purgedCount).toBe(1); // Only User A was purged

    // Assert User A (eligible): All legacy and encrypted PII/financial data scrubbed
    const purgedKyc = await prisma.kycRecord.findFirst({
      where: { userId: eligibleUser.id },
    });
    expect(purgedKyc?.panNumber).toBeNull();
    expect(purgedKyc?.panNumberEncrypted).toBeNull();
    expect(purgedKyc?.panName).toBe('ANONYMIZED');
    expect(purgedKyc?.verifiedName).toBe('ANONYMIZED');
    expect(purgedKyc?.maskedPan).toBe('XXXXX0000X');
    expect(purgedKyc?.panBlindIndex).toBeNull();
    expect(purgedKyc?.consentText).toBeNull();

    const purgedPayment = await prisma.paymentAccount.findFirst({
      where: { userId: eligibleUser.id },
    });
    expect(purgedPayment?.accountNumber).toBeNull();
    expect(purgedPayment?.accountNumberEncrypted).toBeNull();
    expect(purgedPayment?.accountHolderName).toBe('ANONYMIZED');
    expect(purgedPayment?.providerRegisteredName).toBe('ANONYMIZED');
    expect(purgedPayment?.ifscCode).toBeNull();
    expect(purgedPayment?.bankName).toBeNull();
    expect(purgedPayment?.upiId).toBeNull();
    expect(purgedPayment?.upiIdEncrypted).toBeNull();
    expect(purgedPayment?.beneficiaryBlindIndex).toBeNull();
    expect(purgedPayment?.maskedInfo).toBe('XXXX0000');

    const purgedUser = await prisma.user.findUnique({
      where: { id: eligibleUser.id },
    });
    expect(purgedUser?.statutoryRetentionExpiresAt).toBeNull();

    // Assert User B (held): Data completely preserved due to active legal hold
    const preservedKyc = await prisma.kycRecord.findFirst({
      where: { userId: heldUser.id },
    });
    expect(preservedKyc?.panNumber).toBe('ABCDE2222B');
    expect(preservedKyc?.panName).toBe('Held Person');
    expect(preservedKyc?.panBlindIndex).toBe('bindex_held_2');

    const preservedPayment = await prisma.paymentAccount.findFirst({
      where: { userId: heldUser.id },
    });
    expect(preservedPayment?.accountNumber).toBe('9998887772');
    expect(preservedPayment?.accountHolderName).toBe('Held Person');
    expect(preservedPayment?.ifscCode).toBe('HDFC0001234');

    const preservedUser = await prisma.user.findUnique({
      where: { id: heldUser.id },
    });
    expect(preservedUser?.statutoryRetentionExpiresAt).not.toBeNull();
    expect(preservedUser?.legalHold).toBe(true);
  });

  test('Needs Correction 1: Webhook route flags requiresManualReview when amount is missing or NaN', async () => {
    // Create a dummy payout for invalid amount test
    const dummyPayout = await prisma.payout.create({
      data: {
        userId: user1.id,
        walletId: user1.wallet.id,
        paymentAccountId: paymentAccount1.id,
        paymentType: 'UPI',
        amount: 200.0,
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_invalid_amt_test',
        idempotencyKey: `idem-invalid-amt-${Date.now()}`,
      },
    });

    const eventId = `evt_audit_reconcile_invalid_${Date.now()}`;
    const res = await request(app)
      .post('/api/webhooks/razorpayx')
      .set('x-razorpay-event-id', eventId)
      .send({
        id: eventId,
        event: 'payout.processed',
        payload: {
          payout: {
            entity: {
              id: 'pout_invalid_amt_test',
              reference_id: dummyPayout.id,
              amount: 'not_a_valid_number', // NaN amount
              currency: 'INR',
            },
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected_unrecoverable');
    expect(res.body.reason).toBe('invalid_amount');

    // Assert that dummyPayout is flagged for manual review
    const flaggedPayout = await prisma.payout.findUnique({
      where: { id: dummyPayout.id },
    });
    expect(flaggedPayout?.requiresManualReview).toBe(true);
    expect(flaggedPayout?.manualReviewReason).toBe('FATAL_INVALID_AMOUNT');
  });

  test('High: Single-payout reconciliation writes an audit record for financial drift', async () => {
    const providerId = `pout_single_reconcile_drift_${Date.now()}`;
    const payout = await prisma.payout.create({
      data: {
        userId: user1.id,
        walletId: user1.wallet.id,
        paymentAccountId: paymentAccount1.id,
        paymentType: 'UPI',
        amount: 100.0,
        status: 'FAILED',
        razorpayPayoutId: providerId,
        idempotencyKey: `idem-single-reconcile-drift-${Date.now()}`,
      },
    });
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: providerId,
        status: 'processed',
        currency: 'INR',
        amount: 10000,
      }),
    } as any);

    try {
      const result = await ReconciliationWorker.reconcileSinglePayout(payout.id);
      expect(result.success).toBe(true);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'CRITICAL_FINANCIAL_DRIFT', entityType: 'Payout', entityId: payout.id },
      });
      expect(audit).not.toBeNull();
      expect(audit?.newValue).toContain('Single payout gateway polling reconciliation');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('Needs Correction 2: Gateway polling rejects currency and amount mismatches and flags manual review', async () => {
    const mismatchPayout = await prisma.payout.create({
      data: {
        userId: user1.id,
        walletId: user1.wallet.id,
        paymentAccountId: paymentAccount1.id,
        paymentType: 'UPI',
        amount: 300.0,
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_poll_mismatch_test',
        idempotencyKey: `idem-poll-mismatch-${Date.now()}`,
      },
    });

    // Backdate updatedAt so reconcileStuckPayouts considers it stuck (> 2 minutes ago)
    await prisma.$executeRaw`
      UPDATE "Payout"
      SET "updatedAt" = NOW() - INTERVAL '5 minutes'
      WHERE "id" = ${mismatchPayout.id}
    `;

    // Mock global fetch to return USD currency instead of INR
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pout_poll_mismatch_test',
        status: 'processed',
        currency: 'USD', // Mismatched currency!
        amount: 30000,
      }),
    } as any);

    try {
      const result = await ReconciliationWorker.reconcileSinglePayout(mismatchPayout.id);
      expect(result.success).toBe(false);

      const checkedPayout = await prisma.payout.findUnique({
        where: { id: mismatchPayout.id },
      });
      // Payout must NOT be finalized as SUCCESS, and must be flagged for review
      expect(checkedPayout?.status).not.toBe('SUCCESS');
      expect(checkedPayout?.requiresManualReview).toBe(true);
      expect(checkedPayout?.manualReviewReason).toContain('GATEWAY_POLL_CURRENCY_MISMATCH');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
