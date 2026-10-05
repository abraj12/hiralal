import crypto from 'crypto';
import { prisma } from '../db';
import { config } from '../config';
import { PayoutStatus } from '@prisma/client';

export class PayoutService {
  /**
   * Retrieves active admin redemption settings and evaluates window status.
   */
  static async getRedemptionSettings() {
    let settings = await prisma.redemptionSettings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      settings = await prisma.redemptionSettings.create({
        data: {
          id: 'default',
          isEnabled: false,
          startAt: null,
          endAt: null,
          minimumAmount: 500.0,
          maximumAmount: 10000.0,
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
    };
  }

  /**
   * Checks whether a user is eligible to initiate a redemption.
   */
  static async checkUserEligibility(userId: string) {
    const { settings, isWindowOpen } = await this.getRedemptionSettings();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        kycRecords: { where: { panStatus: 'VERIFIED' } },
        paymentAccounts: { where: { isVerified: true, isDefault: true } },
      },
    });

    if (!user) throw new Error('User not found.');

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
   * Initiates reward redemption with database transaction safety and official RazorpayX API.
   */
  static async requestRedemption(userId: string, idempotencyKey: string, requestedAmount?: number) {
    // 1. Check idempotency
    const cleanKey = idempotencyKey.trim();
    const existingPayout = await prisma.payout.findUnique({
      where: { idempotencyKey: cleanKey },
      include: { paymentAccount: true },
    });

    if (existingPayout) {
      return {
        payout: existingPayout,
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

    // 3. Server computes payout amount safely from DB
    let payoutAmount = eligibility.availableBalance;
    if (requestedAmount && requestedAmount >= eligibility.minimumAmount && requestedAmount <= eligibility.availableBalance) {
      payoutAmount = requestedAmount;
    }
    // Cap at maximum configured
    if (payoutAmount > eligibility.maximumAmount) {
      payoutAmount = eligibility.maximumAmount;
    }

    payoutAmount = Math.floor(payoutAmount * 100) / 100;

    // 4. Atomic PostgreSQL Transaction
    const { payout, wallet } = await prisma.$transaction(async (tx) => {
      const userWallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!userWallet || Number(userWallet.availableBalance) < payoutAmount) {
        throw new Error('Insufficient available rewards balance for redemption.');
      }

      const newAvailable = Number(userWallet.availableBalance) - payoutAmount;
      const newProcessing = Number(userWallet.processingAmount) + payoutAmount;

      // Reserve funds in processing amount
      const updatedWallet = await tx.wallet.update({
        where: { id: userWallet.id },
        data: {
          availableBalance: newAvailable,
          processingAmount: newProcessing,
          version: { increment: 1 },
        },
      });

      // Create ledger transaction
      await tx.walletTransaction.create({
        data: {
          walletId: userWallet.id,
          userId,
          amount: payoutAmount,
          type: 'PAYOUT_DEBIT',
          balanceAfter: newAvailable,
          referenceType: 'PAYOUT',
          referenceId: cleanKey,
          description: `Redemption debit of ₹${payoutAmount.toFixed(2)} to ${verifiedAccount.maskedInfo}`,
        },
      });

      // Create Payout record
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

      return { payout: newPayout, wallet: updatedWallet };
    });

    // 5. Real RazorpayX Payout Dispatch
    let razorpayPayoutId: string | null = null;
    let payoutStatus: PayoutStatus = 'PENDING';

    if (config.razorpayx.keyId && config.razorpayx.keySecret && config.razorpayx.accountNumber && config.nodeEnv !== 'test') {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
        const user = await prisma.user.findUnique({ where: { id: userId } });

        // A. Create/Get Contact in RazorpayX
        const contactRes = await fetch('https://api.razorpay.com/v1/contacts', {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: user?.fullName || 'Hiralal Craftsman',
            contact: user?.mobile || '',
            type: 'vendor',
            reference_id: userId,
          }),
        });
        const contactData: any = await contactRes.json();
        const contactId = contactData.id;

        // B. Create Fund Account in RazorpayX
        const fundAccountPayload =
          verifiedAccount.accountType === 'UPI'
            ? {
                contact_id: contactId,
                account_type: 'vpa',
                vpa: { address: verifiedAccount.upiId },
              }
            : {
                contact_id: contactId,
                account_type: 'bank_account',
                bank_account: {
                  name: verifiedAccount.accountHolderName || user?.fullName,
                  ifsc: verifiedAccount.ifscCode,
                  account_number: verifiedAccount.accountNumber,
                },
              };

        const fundRes = await fetch('https://api.razorpay.com/v1/fund_accounts', {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify(fundAccountPayload),
        });
        const fundData: any = await fundRes.json();
        const fundAccountId = fundData.id;

        // C. Initiate Real RazorpayX Payout
        const payoutRes = await fetch('https://api.razorpay.com/v1/payouts', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            'X-Payout-Idempotency': cleanKey,
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account_id: fundAccountId,
            amount: Math.round(payoutAmount * 100), // in paise
            currency: 'INR',
            mode: verifiedAccount.accountType === 'UPI' ? 'UPI' : 'IMPS',
            purpose: 'payout',
            queue_if_low_balance: true,
            reference_id: payout.id,
            narration: 'Hiralal & Sons Rewards',
          }),
        });

        const payoutData: any = await payoutRes.json();
        if (payoutData.id) {
          razorpayPayoutId = payoutData.id;
          payoutStatus = payoutData.status === 'processed' ? 'SUCCESS' : 'PAYOUT_INITIATED';

          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: payoutStatus,
              razorpayPayoutId,
              razorpayFundAccountId: fundAccountId,
              initiatedAt: new Date(),
            },
          });
        } else {
          throw new Error(payoutData.error?.description || 'RazorpayX payout creation failed.');
        }
      } catch (err: any) {
        console.error('RazorpayX Payout Error:', err);
        // Automatic reversal if payout initiation outright rejected
        await this.reversePayout(payout.id, `Payment Gateway Error: ${err.message}`);
        throw new Error(`Failed to initiate bank disbursement: ${err.message}. Your balance has been restored.`);
      }
    }

    return {
      payout: {
        ...payout,
        status: payoutStatus,
        razorpayPayoutId,
      },
      amountDebited: payoutAmount,
      wallet,
    };
  }

  /**
   * Reverses a failed payout transaction and restores funds to user's available balance.
   */
  static async reversePayout(payoutId: string, reason: string) {
    return await prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
      });

      if (!payout || payout.status === 'REVERSED' || payout.status === 'SUCCESS') {
        return null;
      }

      const payoutAmount = Number(payout.amount);

      const wallet = await tx.wallet.findUnique({
        where: { id: payout.walletId },
      });

      if (!wallet) return null;

      const restoredAvailable = Number(wallet.availableBalance) + payoutAmount;
      const restoredProcessing = Math.max(0, Number(wallet.processingAmount) - payoutAmount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: restoredAvailable,
          processingAmount: restoredProcessing,
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: payout.userId,
          amount: payoutAmount,
          type: 'PAYOUT_REVERSAL',
          balanceAfter: restoredAvailable,
          referenceType: 'PAYOUT',
          referenceId: payout.id,
          description: `Disbursement reversed: ${reason}`,
        },
      });

      return await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'REVERSED',
          failureReason: reason,
        },
      });
    });
  }
}
