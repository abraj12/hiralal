import { prisma } from '../db';
import { config } from '../config';
import { PayoutStatus, Profession } from '@prisma/client';
import { getIstDate } from '../utils/timezone.utils';
import { toPaise, fromPaise } from '../utils/money.utils';
import { areNamesMatching } from '../utils/name.utils';

export interface RedemptionWindowInput {
  isEnabled: boolean;
  minimumRedemptionAmount: unknown;
  startAt: Date | null;
  endAt: Date | null;
}

export function isRedemptionWindowOpen(
  settings: RedemptionWindowInput,
  now: Date = new Date()
): boolean {
  const minimum = Number(settings.minimumRedemptionAmount);

  const validMinimum =
    settings.minimumRedemptionAmount !== null &&
    settings.minimumRedemptionAmount !== undefined &&
    Number.isFinite(minimum) &&
    minimum > 0;

  const validTimestamps =
    settings.startAt instanceof Date &&
    settings.endAt instanceof Date &&
    Number.isFinite(settings.startAt.getTime()) &&
    Number.isFinite(settings.endAt.getTime()) &&
    settings.startAt.getTime() < settings.endAt.getTime();

  if (
    settings.isEnabled !== true ||
    !validMinimum ||
    !validTimestamps ||
    !Number.isFinite(now.getTime())
  ) {
    return false;
  }

  return (
    now.getTime() >= settings.startAt!.getTime() &&
    now.getTime() < settings.endAt!.getTime()
  );
}

export class PayoutService {
  /**
   * Retrieves active admin redemption settings for a profession and evaluates window status
   * using Asia/Kolkata business interpretation with UTC timestamps.
   */
  static async getRedemptionSettings(profession?: Profession, tx: any = prisma) {
    let settings = null;
    if (profession) {
      settings = await tx.redemptionSettings.findUnique({
        where: { profession },
      });
    }

    if (!settings) {
      settings = await tx.redemptionSettings.findUnique({
        where: { id: 'default' },
      });
    }

    if (!settings) {
      settings = await tx.redemptionSettings.create({
        data: {
          id: 'default',
          profession: profession || null,
          isEnabled: false, // Default CLOSED until explicitly opened
          startAt: null,
          endAt: null,
          minimumRedemptionAmount: null,
          message: 'Rewards redemption is currently unavailable.',
        },
      });
    }

    const now = new Date();
    const isWindowOpen = isRedemptionWindowOpen(
      {
        isEnabled: settings.isEnabled,
        minimumRedemptionAmount: settings.minimumRedemptionAmount,
        startAt: settings.startAt,
        endAt: settings.endAt,
      },
      now
    );

    return {
      settings,
      isWindowOpen,
      serverTime: now.toISOString(),
      businessTimeIst: getIstDate(now).toISOString(),
    };
  }

  /**
   * Authoritative helper to validate that the verified PAN holder name matches
   * the provider-confirmed payment account beneficiary name.
   */
  static validateBeneficiaryMatch(
    verifiedKycRecord: { panStatus?: string; nameMatched?: boolean; verifiedName?: string | null; panName?: string | null } | null,
    verifiedAccount: { isVerified?: boolean; providerNameVerified?: boolean; providerRegisteredName?: string | null } | null
  ): { isValid: boolean; reason?: string; panHolderName?: string; beneficiaryName?: string } {
    if (!verifiedKycRecord || verifiedKycRecord.panStatus !== 'VERIFIED') {
      return { isValid: false, reason: 'Please verify your PAN card details before redeeming rewards.' };
    }

    if (!verifiedKycRecord.nameMatched) {
      return { isValid: false, reason: 'Your verified PAN name does not match your registered account name. Please update your profile name or complete verification.' };
    }

    const panHolderName = (verifiedKycRecord.verifiedName || verifiedKycRecord.panName || '').trim();
    if (!panHolderName) {
      return { isValid: false, reason: 'Authoritative PAN card name is missing from verification records.' };
    }

    if (!verifiedAccount || !verifiedAccount.isVerified) {
      return { isValid: false, reason: 'Please add and verify a bank account or UPI ID to receive payouts.' };
    }

    if (verifiedAccount.providerNameVerified !== true) {
      return { isValid: false, reason: 'The payment account beneficiary name has not been verified by the payment provider. Please re-verify your payout account.' };
    }

    const beneficiaryName = (verifiedAccount.providerRegisteredName || '').trim();
    if (!beneficiaryName) {
      return { isValid: false, reason: 'Authoritative beneficiary name is missing from payment provider verification.' };
    }

    const match = areNamesMatching(beneficiaryName, panHolderName);
    if (!match) {
      return { isValid: false, reason: 'Registered payment account beneficiary name does not match verified PAN name.' };
    }

    return { isValid: true, panHolderName, beneficiaryName };
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
    if (user.role !== 'USER') {
      throw new Error('Only registered users can participate in rewards payouts.');
    }
    if (user.status !== 'ACTIVE') {
      throw new Error('User account is suspended or inactive.');
    }

    const { settings, isWindowOpen } = await this.getRedemptionSettings(user.profession || undefined);

    const availableBalance = user.wallet ? Number(user.wallet.availableBalance) : 0;
    const verifiedKycRecord = user.kycRecords.length > 0 ? user.kycRecords[0] : null;
    const verifiedAccount = user.paymentAccounts[0] || null;

    const beneficiaryCheck = this.validateBeneficiaryMatch(verifiedKycRecord, verifiedAccount);

    const activePayout = await prisma.payout.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'APPROVED', 'PAYOUT_INITIATED', 'PROCESSING'] },
      },
    });

    const minThreshold =
      settings.minimumRedemptionAmount !== null && settings.minimumRedemptionAmount !== undefined
        ? Number(settings.minimumRedemptionAmount)
        : null;

    const isThresholdConfigured = minThreshold !== null && minThreshold > 0;
    const isThresholdMet = isThresholdConfigured && availableBalance >= minThreshold;
    const hasActivePayout = Boolean(activePayout);

    // Authoritative eligibility requires both configured minimum threshold and active time window, without pending payout
    const isEligible = isWindowOpen && isThresholdConfigured && isThresholdMet && !hasActivePayout;
    const canRedeem = isEligible && beneficiaryCheck.isValid;
    const canInitiateKyc = isEligible && !beneficiaryCheck.isValid;

    let reason = '';
    if (!isWindowOpen) {
      if (!settings.isEnabled && settings.message && !settings.message.toLowerCase().includes('open')) {
        reason = settings.message;
      } else {
        reason = 'Rewards redemption window is currently closed by administration.';
      }
    } else if (!isThresholdConfigured) {
      reason = 'Rewards redemption minimum threshold is not configured by administration.';
    } else if (hasActivePayout) {
      reason = 'You have a redemption request currently in progress. Please wait until it completes.';
    } else if (availableBalance <= 0) {
      reason = 'No balance available for redemption.';
    } else if (!isThresholdMet) {
      reason = `Available balance (₹${availableBalance.toFixed(2)}) is below the minimum redemption threshold of ₹${minThreshold.toFixed(2)}.`;
    } else if (!beneficiaryCheck.isValid) {
      reason = beneficiaryCheck.reason || 'Please complete PAN and payment account verification to proceed.';
    }

    return {
      isEligible,
      canRedeem,
      canInitiateKyc,
      hasActivePayout,
      isWindowOpen,
      isThresholdConfigured,
      isThresholdMet,
      minimumRedemptionAmount: minThreshold,
      reason,
      availableBalance,
      verifiedKyc: verifiedKycRecord,
      verifiedAccount,
      windowSettings: {
        ...settings,
        minimumRedemptionAmount: minThreshold,
      },
    };
  }

  /**
   * Requests reward redemption using durable outbox architecture.
   * Scopes idempotency strictly to (userId, idempotencyKey).
   * Enforces 100% full balance redemption under pessimistic locking.
   * Requires admin approval before dispatch.
   */
  static async requestRedemption(userId: string, idempotencyKey: string) {
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

    // 2. Atomic PostgreSQL Transaction: lock wallet, evaluate eligibility, reserve 100% funds, create payout in PENDING status
    let payoutResult: any;
    let debitedAmount = 0;
    try {
      const { payout, amount } = await prisma.$transaction(async (tx) => {
        // Lock wallet row for update
        const walletRows: any[] = await tx.$queryRaw`
          SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE;
        `;

        if (!walletRows || walletRows.length === 0) {
          throw new Error('User wallet not found.');
        }

        const userWallet = walletRows[0];
        const currentAvailable = Number(userWallet.availableBalance);

        // Check active in-flight payout inside transaction
        const activePayout = await tx.payout.findFirst({
          where: {
            userId,
            status: { in: ['PENDING', 'APPROVED', 'PAYOUT_INITIATED', 'PROCESSING'] },
          },
        });

        if (activePayout) {
          throw new Error('You have a redemption request currently in progress. Please wait until it completes.');
        }

        // Fetch user profile, kyc, payment accounts inside transaction
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: {
            kycRecords: { where: { panStatus: 'VERIFIED' } },
            paymentAccounts: { where: { isVerified: true, isDefault: true } },
          },
        });

        if (!user) throw new Error('User not found.');
        if (user.role !== 'USER') {
          throw new Error('Only registered users can request reward payouts.');
        }
        if (user.status !== 'ACTIVE') {
          throw new Error('User account is suspended or inactive.');
        }

        const verifiedKycRecord = user.kycRecords.length > 0 ? user.kycRecords[0] : null;
        const verifiedAccount = user.paymentAccounts[0] || null;

        const { settings, isWindowOpen } = await this.getRedemptionSettings(user.profession || undefined, tx);
        if (!isWindowOpen) {
          const closedMsg =
            !settings.isEnabled && settings.message && !settings.message.toLowerCase().includes('open')
              ? settings.message
              : 'Rewards redemption window is currently closed by administration.';
          throw new Error(closedMsg);
        }

        const minThreshold =
          settings.minimumRedemptionAmount !== null && settings.minimumRedemptionAmount !== undefined
            ? Number(settings.minimumRedemptionAmount)
            : null;

        if (minThreshold === null || minThreshold <= 0) {
          throw new Error('Rewards redemption minimum threshold is not configured by administration.');
        }

        if (currentAvailable <= 0) {
          throw new Error('No balance available for redemption.');
        }

        if (currentAvailable < minThreshold) {
          throw new Error(
            `Available balance (₹${currentAvailable.toFixed(2)}) is below the minimum redemption threshold of ₹${minThreshold.toFixed(2)}.`
          );
        }

        const beneficiaryCheck = PayoutService.validateBeneficiaryMatch(verifiedKycRecord, verifiedAccount);
        if (!beneficiaryCheck.isValid) {
          throw new Error(beneficiaryCheck.reason || 'Beneficiary verification failed.');
        }

        // 100% full balance redemption
        const payoutAmount = fromPaise(toPaise(currentAvailable));

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

        // Create Payout record with PENDING status awaiting admin approval
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

        // Create immutable ledger record using stable payout ID as reference
        await tx.walletTransaction.create({
          data: {
            walletId: userWallet.id,
            userId,
            amount: payoutAmount,
            type: 'PAYOUT_DEBIT',
            balanceAfter: newAvailable,
            referenceType: 'PAYOUT',
            referenceId: newPayout.id,
            description: `Payout debit of ₹${payoutAmount.toFixed(2)} reserved for ${verifiedAccount.maskedInfo}`,
          },
        });

        // Notify user of redemption request submission
        await tx.notification.create({
          data: {
            userId,
            title: 'Redemption Request Submitted',
            message: `Your redemption request of ₹${payoutAmount.toFixed(2)} has been submitted and is pending admin approval.`,
            type: 'PAYOUT_PENDING',
          },
        });

        return { payout: newPayout, amount: payoutAmount };
      });
      payoutResult = payout;
      debitedAmount = amount;
    } catch (err: any) {
      if (err.code === 'P2002' || (err.message && err.message.includes('user_payout_idempotency_unique'))) {
        const racePayout = await prisma.payout.findUnique({
          where: {
            user_payout_idempotency_unique: {
              userId,
              idempotencyKey: cleanKey,
            },
          },
          include: { paymentAccount: true },
        });

        if (racePayout) {
          return {
            payout: racePayout,
            amountDebited: Number(racePayout.amount),
            message: 'Returning existing redemption request for this reference.',
          };
        }
      }
      throw err;
    }

    return {
      payout: payoutResult,
      amountDebited: debitedAmount,
      message: 'Redemption request submitted successfully. Awaiting admin approval before disbursement.',
    };
  }

  /**
   * Approves a PENDING payout request. Admin authorization is required.
   * Transitions status to APPROVED, creates an outbox event, creates audit log,
   * notifies user, and triggers dispatch worker.
   */
  static async approveRedemption(payoutId: string, adminId: string) {
    const updatedPayout = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Payout"
        WHERE "id" = ${payoutId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Payout ${payoutId} not found`);
      }

      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { paymentAccount: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);

      if (payout.status === 'APPROVED') {
        return payout;
      }

      if (payout.status !== 'PENDING') {
        throw new Error(`Cannot approve payout in ${payout.status} state. Only PENDING payouts can be approved.`);
      }

      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'APPROVED',
          approvedByAdminId: adminId,
          approvedAt: new Date(),
        },
      });

      // Create durable OutboxEvent for background dispatch
      await tx.outboxEvent.create({
        data: {
          eventType: 'PAYOUT_DISPATCH',
          payload: {
            payoutId: payout.id,
            userId: payout.userId,
            amount: Number(payout.amount),
            paymentAccountId: payout.paymentAccountId,
            idempotencyKey: payout.idempotencyKey,
          },
          status: 'PENDING',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'PAYOUT_APPROVED',
          entityType: 'Payout',
          entityId: payout.id,
          newValue: JSON.stringify({
            payoutId: payout.id,
            amount: Number(payout.amount),
            status: 'APPROVED',
            approvedByAdminId: adminId,
          }),
        },
      });

      // Notify User
      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Payout Approved',
          message: `Your payout request of ₹${Number(payout.amount).toFixed(2)} has been approved and is being dispatched.`,
          type: 'PAYOUT_APPROVED',
        },
      });

      return updated;
    });

    // Trigger dispatch worker asynchronously in non-test environment
    if (config.nodeEnv !== 'test') {
      this.triggerPayoutDispatch(updatedPayout.id).catch((err) => {
        console.warn(`[PAYOUT-DISPATCH-DEFERRED] Payout ${updatedPayout.id} queued for background worker: ${err.message}`);
      });
    }

    return updatedPayout;
  }

  /**
   * Rejects a redemption request before final settlement.
   * Atomically restores reserved processingAmount back to availableBalance,
   * creates immutable PAYOUT_REVERSAL ledger entry, updates payout status to FAILED with rejection reason,
   * creates audit log, and notifies user.
   */
  static async rejectRedemption(payoutId: string, adminId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new Error('Rejection reason is required.');
    }

    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Payout"
        WHERE "id" = ${payoutId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Payout ${payoutId} not found`);
      }

      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { wallet: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);

      const isPending = payout.status === 'PENDING';
      const isApproved = payout.status === 'APPROVED';
      const isProcessingStuck =
        payout.status === 'PROCESSING' &&
        payout.requiresManualReview === true &&
        !payout.razorpayPayoutId;

      const isEligibleForManualRejection = isPending || isApproved || isProcessingStuck;

      if (!isEligibleForManualRejection) {
        if (payout.status === 'SUCCESS') {
          throw new Error(`Cannot reject payout ${payoutId} because it has already successfully completed.`);
        }
        throw new Error(
          `Cannot manually reject payout in ${payout.status} state. Manual rejection is permitted only before payout dispatch or for pre-dispatch failures under manual review.`
        );
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
          referenceId: payout.id,
          description: `Payout rejected by admin: ${reason.trim()}`,
        },
      });

      const updatedPayout = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          adminRejectionReason: reason.trim(),
          failureReason: reason.trim(),
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'PAYOUT_REJECTED',
          entityType: 'Payout',
          entityId: payout.id,
          newValue: JSON.stringify({
            payoutId: payout.id,
            amount: payoutAmount,
            status: 'FAILED',
            reason: reason.trim(),
            adminId,
          }),
        },
      });

      // Notify User
      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Payout Request Rejected',
          message: `Your payout request of ₹${payoutAmount.toFixed(2)} was rejected (${reason.trim()}). The funds have been refunded to your wallet.`,
          type: 'PAYOUT_REJECTED',
        },
      });

      return updatedPayout;
    });
  }
  /**
   * Fails a payout before external provider dispatch has occurred.
   * Atomically reverts processingAmount back to availableBalance,
   * creates PAYOUT_REVERSAL transaction, transitions status to FAILED,
   * and notifies the user.
   */
  static async failBeforeDispatch(payoutId: string, reason: string) {
    return await this.reversePayout(payoutId, reason);
  }

  /**
   * Reverses a failed payout: refunds funds from processingAmount back to availableBalance,
   * creates an immutable PAYOUT_REVERSAL transaction, updates payout status to FAILED,
   * and notifies the user.
   */
  static async reversePayout(payoutId: string, reason: string) {
    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Payout"
        WHERE "id" = ${payoutId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Payout ${payoutId} not found`);
      }

      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { wallet: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);

      // Forbidden transition: SUCCESS payouts cannot be reversed via standard pre-disbursement reversal
      if (payout.status === 'SUCCESS') {
        throw new Error(`Cannot reverse payout ${payoutId} because it has already successfully completed. Use handleReversedPayout for post-settlement reversal.`);
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
          referenceId: payout.id,
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
   * Handles confirmed post-settlement or in-flight payout reversal (e.g. payout.reversed gateway webhook event).
   * Restores funds to user's available balance and creates an immutable audit and ledger trail.
   */
  static async handleReversedPayout(payoutId: string, reason: string) {
    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Payout"
        WHERE "id" = ${payoutId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Payout ${payoutId} not found`);
      }

      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { wallet: true },
      });

      if (!payout) throw new Error(`Payout ${payoutId} not found`);

      // Idempotent: already marked REVERSED
      if (payout.status === 'REVERSED') {
        return payout;
      }

      const payoutAmount = Number(payout.amount);

      if (payout.status === 'SUCCESS') {
        // Compensating transaction for settled payout: decrement totalRedeemed, restore availableBalance
        await tx.wallet.update({
          where: { id: payout.walletId },
          data: {
            totalRedeemed: { decrement: payoutAmount },
            availableBalance: { increment: payoutAmount },
            version: { increment: 1 },
          },
        });
      } else if (payout.status === 'FAILED') {
        // Already refunded from processingAmount earlier
        return payout;
      } else {
        // In-flight payout (PENDING, PAYOUT_INITIATED, PROCESSING)
        await tx.wallet.update({
          where: { id: payout.walletId },
          data: {
            processingAmount: { decrement: payoutAmount },
            availableBalance: { increment: payoutAmount },
            version: { increment: 1 },
          },
        });
      }

      const updatedWallet = await tx.wallet.findUnique({
        where: { id: payout.walletId },
      });
      const balanceAfter = Number(updatedWallet?.availableBalance || 0);

      // Create immutable compensation ledger record
      await tx.walletTransaction.create({
        data: {
          walletId: payout.walletId,
          userId: payout.userId,
          amount: payoutAmount,
          type: 'PAYOUT_REVERSAL',
          balanceAfter,
          referenceType: 'PAYOUT',
          referenceId: payout.id,
          description: `Post-success reversal / compensation: ${reason}`,
        },
      });

      const updatedPayout = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'REVERSED',
          failureReason: reason,
        },
      });

      // Immutable Audit Log
      await tx.auditLog.create({
        data: {
          action: 'PAYOUT_REVERSED',
          entityType: 'Payout',
          entityId: payout.id,
          newValue: JSON.stringify({
            payoutId: payout.id,
            amount: payoutAmount,
            previousStatus: payout.status,
            reason,
          }),
        },
      });

      // Notify user
      await tx.notification.create({
        data: {
          userId: payout.userId,
          title: 'Payout Reversed & Credited',
          message: `Your payout of ₹${payoutAmount.toFixed(2)} was reversed by the banking network (${reason}). The funds have been restored to your available wallet balance.`,
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
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Payout"
        WHERE "id" = ${payoutId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Payout ${payoutId} not found`);
      }

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
