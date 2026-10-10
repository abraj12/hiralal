import { prisma } from '../db';
import { config } from '../config';
import { toPaise } from '../utils/money.utils';
import { decryptSensitive } from '../utils/crypto.utils';
import { PayoutService } from '../services/payout.service';

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
}): string {
  if (account.accountType !== 'UPI') {
    throw new Error('UPI details requested for a non-UPI account.');
  }

  if (!account.upiId || !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(account.upiId.trim())) {
    throw new Error('Stored UPI handle details are invalid.');
  }

  return account.upiId.trim();
}

export class PayoutWorker {
  private static isOutboxPolling = false;
  private static pollTimer: NodeJS.Timeout | null = null;

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
    try {
      const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
      const paymentAccount = payout.paymentAccount;

      // 1. Resolve Contact on RazorpayX with timeout
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
            name: payout.user.fullName,
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

      // 2. Resolve Fund Account on RazorpayX with timeout
      let fundAccountBody: any;
      if (paymentAccount.accountType === 'UPI') {
        const upiAddress = resolveUpiAddress(paymentAccount);
        fundAccountBody = {
          contact_id: contactId,
          account_type: 'vpa',
          vpa: { address: upiAddress },
        };
      } else {
        const accountNumber = resolveBankAccountNumber(paymentAccount);
        fundAccountBody = {
          contact_id: contactId,
          account_type: 'bank_account',
          bank_account: {
            name: paymentAccount.accountHolderName || payout.user.fullName,
            ifsc: paymentAccount.ifscCode,
            account_number: accountNumber,
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
      const fundAccountId = fundAccData.id;

      if (!fundAccRes.ok || !fundAccountId || typeof fundAccountId !== 'string') {
        throw new Error(fundAccData.error?.description || `Failed to create fund account on RazorpayX (HTTP ${fundAccRes.status})`);
      }

      // Save fund account ID
      await prisma.payout.update({
        where: { id: payout.id },
        data: { razorpayFundAccountId: fundAccountId },
      });

      // 3. Dispatch Payout with AbortController for network timeout handling
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
          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: 'PROCESSING',
              razorpayPayoutId,
            },
          });
        }
      } else {
        // HTTP 4xx Client Error: Definite rejection by Razorpay before processing
        if (payoutRes.status >= 400 && payoutRes.status < 500) {
          const reason = payoutData.error?.description || 'Disbursement rejected by payment gateway';
          console.warn(`[PAYOUT-WORKER] Payout ${payout.id} rejected by Razorpay: ${reason}`);
          await PayoutService.reversePayout(payout.id, reason);
        } else {
          // 5xx Server Error: Gateway is in ambiguous state!
          // TIMEOUT SAFETY: DO NOT REVERSE WALLET! Move to PROCESSING for reconciliation.
          console.error(`[PAYOUT-WORKER] Gateway 5xx response for payout ${payout.id}. Moving to PROCESSING.`);
          await prisma.payout.update({
            where: { id: payout.id },
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
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'PROCESSING',
          failureReason: `Network error/timeout: ${err.message} (Pending reconciliation)`,
        },
      });
    }
  }

  /**
   * Polls OutboxEvent table for unprocessed PAYOUT_DISPATCH events.
   */
  static async processOutboxEvents(): Promise<void> {
    const leaseTimeout = new Date(Date.now() - 5 * 60 * 1000);
    const candidateEvents = await prisma.outboxEvent.findMany({
      where: {
        eventType: 'PAYOUT_DISPATCH',
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', updatedAt: { lt: leaseTimeout } },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });

    for (const event of candidateEvents) {
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
      } catch (err: any) {
        console.error(`[OUTBOX-ERROR] Failed to process OutboxEvent ${event.id}:`, err.message);
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: event.attempts >= 3 ? 'FAILED' : 'PENDING',
            lastError: err.message,
          },
        });
      }
    }
  }

  /**
   * Starts periodic polling of OutboxEvent.
   */
  static startOutboxPolling(intervalMs = 5000): void {
    if (this.isOutboxPolling) return;
    this.isOutboxPolling = true;

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
  }
}
