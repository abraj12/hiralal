import { prisma } from '../db';
import { config } from '../config';
import { PayoutStatus, Profession } from '@prisma/client';
import { getIstDate } from '../utils/timezone.utils';
import { toPaise, fromPaise } from '../utils/money.utils';

export class PayoutService {
  /**
   * Retrieves active admin redemption settings for a profession and evaluates window status
   * using Asia/Kolkata business interpretation with UTC timestamps.
   */
  static async getRedemptionSettings(profession?: Profession) {
    let settings = null;
    if (profession) {
      settings = await prisma.redemptionSettings.findUnique({
        where: { profession },
      });
    }

    if (!settings) {
      settings = await prisma.redemptionSettings.findUnique({
        where: { id: 'default' },
      });
    }

    if (!settings) {
      settings = await prisma.redemptionSettings.create({
        data: {
          id: 'default',
          profession: profession || null,
          isEnabled: false, // Default CLOSED until explicitly opened
          startAt: null,
          endAt: null,
          minimumAmount: config.rewards.minRedemptionAmount,
          maximumAmount: config.rewards.maxRedemptionAmount,
          message: 'Rewards redemption is currently unavailable.',
        },
      });
    }

    const now = new Date();
    let isWindowOpen = settings.isEnabled;

    if (settings.startAt && now < settings.startAt) {
      isWindowOpen = false;
    }
    if (settings.endAt && now > settings.endAt) {
      isWindowOpen = false;
    }

    return {
      settings: {
        ...settings,
        minimumAmount: Number(settings.minimumAmount),
        maximumAmount: Number(settings.maximumAmount),
      },
      isWindowOpen,
      serverTime: now.toISOString(),
      businessTimeIst: getIstDate(now).toISOString(),
    };
  }

  /**
   * Evaluates user eligibility for rewards payout based on their profession.
   */
  static async checkUserEligibility(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        kycRecords: { where: { panStatus: 'VERIFIED' } },
        paymentAccounts: { where: { isVerified: true, isDefault: true } },
      },
    });

    if (!user) throw new Error('User not found.');

    const { settings, isWindowOpen } = await this.getRedemptionSettings(user.profession || undefined);

    const availableBalance = user.wallet ? Number(user.wallet.availableBalance) : 0;
    const hasVerifiedKyc = user.kycRecords.length > 0;
    const verifiedAccount = user.paymentAccounts[0] || null;

    let canRedeem = true;
    let reason = '';

    if (!isWindowOpen) {
      canRedeem = false;
      reason = settings.message || 'Rewards redemption window is currently closed by administration.';
    } else if (!hasVerifiedKyc) {
      canRedeem = false;
      reason = 'Please verify your PAN card details before redeeming rewards.';
    } else if (!verifiedAccount) {
      canRedeem = false;
      reason = 'Please add and verify a bank account or UPI ID to receive payouts.';
    } else if (availableBalance < settings.minimumAmount) {
      canRedeem = false;
      reason = `Minimum redemption amount is ₹${settings.minimumAmount}. Your current balance is ₹${availableBalance.toFixed(2)}.`;
    }

    return {
      canRedeem,
      reason,
      availableBalance,
      minimumAmount: settings.minimumAmount,
      maximumAmount: settings.maximumAmount,
      verifiedKyc: hasVerifiedKyc ? user.kycRecords[0] : null,
      verifiedAccount,
      windowSettings: settings,
    };
  }

  /**
   * Requests reward redemption using durable outbox architecture.
   * Scopes idempotency strictly to (userId, idempotencyKey).
   */
  static async requestRedemption(userId: string, idempotencyKey: string, requestedAmount?: number) {
    const cleanKey = idempotencyKey.trim();

    // 1. Idempotency Check scoped to USER
    const existingPayout = await prisma.payout.findUnique({
      where: {
        user_payout_idempotency_unique: {
          userId,
          idempotencyKey: cleanKey,
        },
      },
      include: { paymentAccount: true },
    });

    if (existingPayout) {
      return {
        payout: existingPayout,
        amountDebited: Number(existingPayout.amount),
        message: 'Returning existing redemption request for this reference.',
      };
    }

    // 2. Enforce strict eligibility and window rules
    const eligibility = await this.checkUserEligibility(userId);
    if (!eligibility.canRedeem) {
      throw new Error(eligibility.reason);
    }

    const verifiedAccount = eligibility.verifiedAccount;
    if (!verifiedAccount) {
      throw new Error('A verified bank account or UPI ID is required for payout.');
    }

    // 3. Server validates payout amount: NO silent clamping!
    let payoutAmount = eligibility.availableBalance;
    if (requestedAmount !== undefined) {
      if (requestedAmount < eligibility.minimumAmount) {
        throw new Error(`Requested amount ₹${requestedAmount} is below the minimum redemption limit of ₹${eligibility.minimumAmount}.`);
      }
      if (requestedAmount > eligibility.maximumAmount) {
        throw new Error(`Requested amount ₹${requestedAmount} exceeds the maximum single payout limit of ₹${eligibility.maximumAmount}.`);
      }
      if (requestedAmount > eligibility.availableBalance) {
        throw new Error(`Requested amount ₹${requestedAmount} exceeds your available balance of ₹${eligibility.availableBalance.toFixed(2)}.`);
      }
      payoutAmount = requestedAmount;
    } else {
      // Default: redeem all available balance up to maximum
      payoutAmount = Math.min(eligibility.availableBalance, eligibility.maximumAmount);
    }

    // Format to 2-decimal paise precision
    payoutAmount = fromPaise(toPaise(payoutAmount));

    // 4. Atomic PostgreSQL Transaction: lock wallet, reserve funds, create payout, create outbox event
    const { payout } = await prisma.$transaction(async (tx) => {
      // Lock wallet row for update
      const walletRows: any[] = await tx.$queryRaw`
        SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE;
      `;

      if (!walletRows || walletRows.length === 0) {
        throw new Error('User wallet not found.');
      }

      const userWallet = walletRows[0];
      const currentAvailable = Number(userWallet.availableBalance);

      if (currentAvailable < payoutAmount) {
        throw new Error(`Insufficient available balance for payout. Current: ₹${currentAvailable.toFixed(2)}, Required: ₹${payoutAmount.toFixed(2)}.`);
      }

      // Move funds from availableBalance to processingAmount atomically
      await tx.$executeRaw`
        UPDATE "Wallet"
        SET "availableBalance" = "availableBalance" - ${payoutAmount}::decimal,
            "processingAmount" = "processingAmount" + ${payoutAmount}::decimal,
            "version" = "version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${userWallet.id};
      `;

      const newAvailable = currentAvailable - payoutAmount;

      // Create immutable ledger record
      await tx.walletTransaction.create({
        data: {
          walletId: userWallet.id,
          userId,
          amount: payoutAmount,
          type: 'PAYOUT_DEBIT',
          balanceAfter: newAvailable,
          referenceType: 'PAYOUT',
          referenceId: cleanKey,
          description: `Payout debit of ₹${payoutAmount.toFixed(2)} reserved for ${verifiedAccount.maskedInfo}`,
        },
      });

      // Create Payout record with PENDING status
      const newPayout = await tx.payout.create({
        data: {
          userId,
          walletId: userWallet.id,
          amount: payoutAmount,
          paymentAccountId: verifiedAccount.id,
          paymentType: verifiedAccount.accountType,
          idempotencyKey: cleanKey,
          status: 'PENDING',
        },
      });

      // Create durable OutboxEvent for background dispatch
      await tx.outboxEvent.create({
        data: {
          eventType: 'PAYOUT_DISPATCH',
          payload: {
            payoutId: newPayout.id,
            userId,
            amount: payoutAmount,
            paymentAccountId: verifiedAccount.id,
            idempotencyKey: cleanKey,
          },
          status: 'PENDING',
        },
      });

      return { payout: newPayout };
    });

    // 5. Trigger dispatch worker asynchronously (in non-test environment)
    if (config.nodeEnv !== 'test') {
      this.triggerPayoutDispatch(payout.id).catch((err) => {
        console.warn(`[PAYOUT-DISPATCH-DEFERRED] Payout ${payout.id} queued for background worker: ${err.message}`);
      });
    }

    return {
      payout,
      amountDebited: payoutAmount,
      message: 'Redemption initiated successfully. Disbursement dispatched to your verified account.',
    };
  }

  /**
   * Reverses a failed payout: refunds funds from processingAmount back to availableBalance,
   * creates an immutable PAYOUT_REVERSAL transaction, updates payout status to FAILED,
   * and notifies the user.
   */
  static async reversePayout(payoutId: string, reason: string) {
    return await prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { wallet: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);

      // Forbidden transition: SUCCESS payouts cannot be reversed without manual ledger compensation
      if (payout.status === 'SUCCESS') {
        throw new Error(`Cannot reverse payout ${payoutId} because it has already successfully completed.`);
      }

      // Idempotency: if already in FAILED or REVERSED state, return current record without duplicate refund
      if (payout.status === 'FAILED' || payout.status === 'REVERSED') {
        return payout;
      }

      const payoutAmount = Number(payout.amount);

      // Atomically shift funds from processingAmount back to availableBalance
      await tx.wallet.update({
        where: { id: payout.walletId },
        data: {
          processingAmount: { decrement: payoutAmount },
          availableBalance: { increment: payoutAmount },
          version: { increment: 1 },
        },
      });

      // Get updated balance for ledger
      const updatedWallet = await tx.wallet.findUnique({
        where: { id: payout.walletId },
      });
      const balanceAfter = Number(updatedWallet?.availableBalance || 0);

      // Create immutable ledger reversal entry
      await tx.walletTransaction.create({
        data: {
          walletId: payout.walletId,
          userId: payout.userId,
          amount: payoutAmount,
          type: 'PAYOUT_REVERSAL',
          balanceAfter,
          referenceType: 'PAYOUT',
          referenceId: payout.idempotencyKey,
          description: `Payout reversed: ${reason}`,
        },
      });

      // Mark payout as FAILED
      const updatedPayout = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          failureReason: reason,
        },
      });

      // Notify user
      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Payout Failed & Refunded',
          message: `Your payout request of ₹${payoutAmount.toFixed(2)} could not be processed (${reason}). The amount has been refunded back to your wallet.`,
          type: 'PAYOUT_FAILED',
        },
      });

      return updatedPayout;
    });
  }

  /**
   * Finalizes a successful payout: moves funds out of processingAmount, increments totalRedeemed,
   * updates payout status to SUCCESS, and notifies user.
   */
  static async finalizeSuccess(payoutId: string, razorpayPayoutId?: string) {
    return await prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { wallet: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);
      if (payout.status === 'SUCCESS') return payout;

      // Forbidden transition: Cannot finalize a payout that was already FAILED or REVERSED
      if (payout.status === 'FAILED' || payout.status === 'REVERSED') {
        throw new Error(`Cannot finalize payout ${payoutId} because it is already in terminal state ${payout.status}`);
      }

      const payoutAmount = Number(payout.amount);

      await tx.wallet.update({
        where: { id: payout.walletId },
        data: {
          processingAmount: { decrement: payoutAmount },
          totalRedeemed: { increment: payoutAmount },
          version: { increment: 1 },
        },
      });

      const updatedPayout = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'SUCCESS',
          razorpayPayoutId: razorpayPayoutId || payout.razorpayPayoutId,
          completedAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Reward Disbursement Successful!',
          message: `₹${payoutAmount.toFixed(2)} has been credited to your verified payment account.`,
          type: 'PAYOUT_SUCCESS',
        },
      });

      return updatedPayout;
    });
  }

  /**
   * Invokes immediate worker dispatch or falls back to background processor.
   */
  static async triggerPayoutDispatch(payoutId: string) {
    const { PayoutWorker } = await import('../worker/payout.worker');
    await PayoutWorker.processPayout(payoutId);
  }
}
