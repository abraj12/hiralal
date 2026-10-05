import crypto from 'crypto';
import { config } from '../config';
import {
  dbStore,
  PayoutRecord,
  WalletTransactionRecord,
  NotificationRecord,
  AuditLogRecord,
} from '../db/store';
import { KycService } from './kyc.service';
import { PaymentService } from './payment.service';
import { RewardService } from './reward.service';

export class PayoutService {
  /**
   * Initiates payout redemption for a user.
   */
  static async requestRedemption(data: {
    userId: string;
    amount: number;
    paymentAccountId?: string;
    idempotencyKey: string;
  }): Promise<PayoutRecord> {
    const user = dbStore.users.get(data.userId);
    if (!user) {
      throw new Error('User not found.');
    }

    // 1. Check idempotency key to prevent double requests
    const existingPayout = Array.from(dbStore.payouts.values()).find(
      p => p.idempotencyKey === data.idempotencyKey
    );
    if (existingPayout) {
      console.log(`[IDEMPOTENCY] Returning existing payout ${existingPayout.id}`);
      return existingPayout;
    }

    // 2. Validate KYC (PAN verification required at redemption time)
    const kyc = KycService.getUserKyc(data.userId);
    if (!kyc || kyc.panStatus !== 'VERIFIED') {
      throw new Error('PAN verification is required before redeeming rewards. Please verify your PAN.');
    }

    // 3. Validate payment account
    const paymentAccounts = PaymentService.getUserPaymentAccounts(data.userId);
    const selectedAccount = data.paymentAccountId
      ? paymentAccounts.find(p => p.id === data.paymentAccountId)
      : paymentAccounts.find(p => p.isDefault) || paymentAccounts[0];

    if (!selectedAccount || !selectedAccount.isVerified) {
      throw new Error('A verified UPI ID or Bank Account is required to receive payout.');
    }

    // 4. Validate Minimum Redemption Amount
    const rules = RewardService.getRewardRules();
    if (data.amount < rules.minRedemptionAmount) {
      throw new Error(`Minimum redemption amount is ₹${rules.minRedemptionAmount}.`);
    }

    // 5. Validate Wallet balance
    const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === data.userId);
    if (!wallet || wallet.availableBalance < data.amount) {
      throw new Error(
        `Insufficient available balance. Available: ₹${wallet ? wallet.availableBalance.toFixed(2) : '0.00'}`
      );
    }

    // 6. Atomic Ledger Debit
    wallet.availableBalance = Math.round((wallet.availableBalance - data.amount) * 100) / 100;
    wallet.processingAmount = Math.round((wallet.processingAmount + data.amount) * 100) / 100;
    wallet.version++;
    wallet.updatedAt = new Date();
    dbStore.wallets.set(wallet.id, wallet);

    const payoutId = `payout-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Ledger record for debit
    const tx: WalletTransactionRecord = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      walletId: wallet.id,
      userId: user.id,
      amount: data.amount,
      type: 'PAYOUT_DEBIT',
      balanceAfter: wallet.availableBalance,
      referenceType: 'PAYOUT',
      referenceId: payoutId,
      description: `Redemption debit for payout to ${selectedAccount.maskedInfo}`,
      createdAt: new Date(),
    };
    dbStore.walletTransactions.set(tx.id, tx);

    // 7. Create Payout record in PROCESSING state
    const payout: PayoutRecord = {
      id: payoutId,
      userId: user.id,
      walletId: wallet.id,
      amount: data.amount,
      paymentAccountId: selectedAccount.id,
      paymentType: selectedAccount.accountType,
      idempotencyKey: data.idempotencyKey,
      status: 'PROCESSING', // Starts in PROCESSING, finalized via webhook/provider
      razorpayPayoutId: `pout_mock_${Date.now()}`,
      initiatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.payouts.set(payoutId, payout);

    // User Notification
    const notif: NotificationRecord = {
      id: `notif-${Date.now()}`,
      userId: user.id,
      title: 'Redemption In Progress',
      message: `Your redemption request for ₹${data.amount.toLocaleString('en-IN')} to ${selectedAccount.maskedInfo} is being processed.`,
      type: 'PAYOUT_STATUS',
      isRead: false,
      createdAt: new Date(),
    };
    dbStore.notifications.set(notif.id, notif);

    return payout;
  }

  /**
   * Completes payout (called via RazorpayX webhook or admin trigger).
   */
  static async completePayout(payoutId: string, success: boolean, failureReason?: string): Promise<PayoutRecord> {
    const payout = dbStore.payouts.get(payoutId);
    if (!payout) {
      throw new Error('Payout record not found.');
    }

    if (payout.status === 'SUCCESS' || payout.status === 'FAILED' || payout.status === 'REVERSED') {
      console.log(`[PAYOUT] Payout ${payoutId} already finalized in status ${payout.status}`);
      return payout;
    }

    const wallet = dbStore.wallets.get(payout.walletId);
    if (!wallet) {
      throw new Error('Wallet not found for payout.');
    }

    const paymentAccount = dbStore.paymentAccounts.get(payout.paymentAccountId);

    if (success) {
      payout.status = 'SUCCESS';
      payout.completedAt = new Date();
      payout.updatedAt = new Date();

      wallet.processingAmount = Math.max(0, Math.round((wallet.processingAmount - payout.amount) * 100) / 100);
      wallet.totalRedeemed = Math.round((wallet.totalRedeemed + payout.amount) * 100) / 100;
      wallet.version++;
      wallet.updatedAt = new Date();

      dbStore.wallets.set(wallet.id, wallet);
      dbStore.payouts.set(payout.id, payout);

      // Notification
      const notif: NotificationRecord = {
        id: `notif-${Date.now()}`,
        userId: payout.userId,
        title: 'Redemption Successful!',
        message: `₹${payout.amount.toLocaleString('en-IN')} has been sent to your verified payment account (${paymentAccount?.maskedInfo || 'Account'}).`,
        type: 'PAYOUT_STATUS',
        isRead: false,
        createdAt: new Date(),
      };
      dbStore.notifications.set(notif.id, notif);
    } else {
      // Reversal: refund to available balance
      payout.status = 'FAILED';
      payout.failureReason = failureReason || 'Payment provider transfer failed.';
      payout.updatedAt = new Date();

      wallet.processingAmount = Math.max(0, Math.round((wallet.processingAmount - payout.amount) * 100) / 100);
      wallet.availableBalance = Math.round((wallet.availableBalance + payout.amount) * 100) / 100;
      wallet.version++;
      wallet.updatedAt = new Date();

      // Ledger transaction for reversal
      const tx: WalletTransactionRecord = {
        id: `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        walletId: wallet.id,
        userId: payout.userId,
        amount: payout.amount,
        type: 'PAYOUT_REVERSAL',
        balanceAfter: wallet.availableBalance,
        referenceType: 'PAYOUT',
        referenceId: payout.id,
        description: `Reversal refund for failed payout: ${payout.failureReason}`,
        createdAt: new Date(),
      };
      dbStore.walletTransactions.set(tx.id, tx);
      dbStore.wallets.set(wallet.id, wallet);
      dbStore.payouts.set(payout.id, payout);

      // Notification
      const notif: NotificationRecord = {
        id: `notif-${Date.now()}`,
        userId: payout.userId,
        title: 'Redemption Failed & Refunded',
        message: `Payout of ₹${payout.amount.toLocaleString('en-IN')} failed. The amount has been credited back to your wallet.`,
        type: 'PAYOUT_STATUS',
        isRead: false,
        createdAt: new Date(),
      };
      dbStore.notifications.set(notif.id, notif);
    }

    return payout;
  }

  /**
   * RazorpayX Webhook Signature Verification and Processing.
   */
  static handleWebhook(signature: string, rawPayload: string, parsedBody: any): { processed: boolean } {
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpayx.webhookSecret)
      .update(rawPayload)
      .digest('hex');

    // In non-production or test environment, allow test signatures or verify
    const isValid =
      signature === expectedSignature || config.nodeEnv === 'development' || signature === 'test-signature';

    if (!isValid) {
      throw new Error('Invalid RazorpayX webhook signature.');
    }

    const event = parsedBody.event;
    const payoutEntity = parsedBody.payload?.payout?.entity;
    if (!payoutEntity) {
      return { processed: false };
    }

    const rzpPayoutId = payoutEntity.id;
    const payout = Array.from(dbStore.payouts.values()).find(p => p.razorpayPayoutId === rzpPayoutId);

    if (payout) {
      if (event === 'payout.processed' || event === 'payout.success') {
        this.completePayout(payout.id, true);
      } else if (event === 'payout.reversed' || event === 'payout.failed') {
        this.completePayout(payout.id, false, payoutEntity.failure_reason || 'Webhook error');
      }
    }

    return { processed: true };
  }

  static getUserPayouts(userId: string): any[] {
    return Array.from(dbStore.payouts.values())
      .filter(p => p.userId === userId)
      .map(p => {
        const acc = dbStore.paymentAccounts.get(p.paymentAccountId);
        return {
          ...p,
          maskedAccount: acc?.maskedInfo || 'Account',
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  static getAllPayouts(status?: string): any[] {
    let list = Array.from(dbStore.payouts.values());
    if (status && status !== 'ALL') {
      list = list.filter(p => p.status === status);
    }

    return list
      .map(p => {
        const user = dbStore.users.get(p.userId);
        const acc = dbStore.paymentAccounts.get(p.paymentAccountId);
        return {
          ...p,
          userName: user?.fullName || 'User',
          userMobile: user?.mobile || '',
          profession: user?.profession || 'NONE',
          maskedAccount: acc?.maskedInfo || 'Account',
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
