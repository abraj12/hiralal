import { dbStore, BillRecord, WalletTransactionRecord, NotificationRecord, AuditLogRecord } from '../db/store';
import { RewardService } from './reward.service';
import { StorageService } from './storage.service';

export class BillService {
  /**
   * Submits a new bill.
   */
  static async submitBill(data: {
    userId: string;
    invoiceNumber: string;
    invoiceDate: string;
    billAmount: number;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    remarks?: string;
  }): Promise<BillRecord> {
    const user = dbStore.users.get(data.userId);
    if (!user) {
      throw new Error('User not found.');
    }

    if (data.billAmount <= 0) {
      throw new Error('Bill amount must be greater than zero.');
    }

    const cleanInvoiceNumber = data.invoiceNumber.trim().toUpperCase();

    // Check for duplicate invoice submission by this user
    const existing = Array.from(dbStore.bills.values()).find(
      b => b.userId === data.userId && b.invoiceNumber.toUpperCase() === cleanInvoiceNumber
    );

    if (existing) {
      throw new Error(`Invoice number "${cleanInvoiceNumber}" has already been submitted.`);
    }

    // Check active reward rules
    const rules = RewardService.getRewardRules();
    const calculatedReward = RewardService.calculateReward(data.billAmount, rules.percentage);

    // Save private document
    const { fileKey, fileUrl } = await StorageService.uploadInvoiceFile(
      data.fileBuffer,
      data.fileName,
      data.mimeType,
      data.userId
    );

    const billId = `bill-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const newBill: BillRecord = {
      id: billId,
      userId: data.userId,
      invoiceNumber: cleanInvoiceNumber,
      invoiceDate: new Date(data.invoiceDate),
      billAmount: data.billAmount,
      calculatedReward,
      rewardPercentage: rules.percentage,
      status: 'PENDING',
      fileUrl,
      fileKey,
      remarks: data.remarks?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.bills.set(billId, newBill);

    // Create Notification
    const notif: NotificationRecord = {
      id: `notif-${Date.now()}`,
      userId: data.userId,
      title: 'Bill Submitted Successfully',
      message: `Your invoice ${cleanInvoiceNumber} of ₹${data.billAmount.toLocaleString('en-IN')} has been submitted for verification.`,
      type: 'BILL_STATUS',
      isRead: false,
      createdAt: new Date(),
    };
    dbStore.notifications.set(notif.id, notif);

    return newBill;
  }

  /**
   * Retrieves bills for a user.
   */
  static getUserBills(userId: string, status?: string): BillRecord[] {
    let bills = Array.from(dbStore.bills.values()).filter(b => b.userId === userId);

    if (status && status !== 'ALL') {
      bills = bills.filter(b => b.status === status);
    }

    // Refresh signed URLs for private viewing
    return bills
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(b => ({
        ...b,
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      }));
  }

  /**
   * Retrieves all bills for admin management.
   */
  static getAllBills(status?: string, profession?: string): any[] {
    let bills = Array.from(dbStore.bills.values());

    if (status && status !== 'ALL') {
      bills = bills.filter(b => b.status === status);
    }

    return bills
      .map(b => {
        const user = dbStore.users.get(b.userId);
        return {
          ...b,
          fileUrl: StorageService.generateSignedUrl(b.fileKey, 60),
          userFullName: user?.fullName || 'Unknown User',
          userMobile: user?.mobile || '',
          userProfession: user?.profession || 'NONE',
        };
      })
      .filter(b => {
        if (!profession || profession === 'ALL') return true;
        return b.userProfession === profession;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Admin verifies (Approves or Rejects) a bill.
   */
  static async verifyBill(
    billId: string,
    action: 'APPROVE' | 'REJECT',
    adminId: string,
    rejectionReason?: string
  ): Promise<BillRecord> {
    const bill = dbStore.bills.get(billId);
    if (!bill) {
      throw new Error('Bill not found.');
    }

    if (bill.status === 'APPROVED') {
      throw new Error('Bill has already been approved.');
    }

    const user = dbStore.users.get(bill.userId);
    if (!user) {
      throw new Error('User associated with this bill was not found.');
    }

    let wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);
    if (!wallet) {
      wallet = {
        id: `wallet-${user.id}`,
        userId: user.id,
        availableBalance: 0,
        processingAmount: 0,
        totalRedeemed: 0,
        version: 1,
        updatedAt: new Date(),
      };
      dbStore.wallets.set(wallet.id, wallet);
    }

    if (action === 'REJECT') {
      if (!rejectionReason || !rejectionReason.trim()) {
        throw new Error('A rejection reason is required when rejecting a bill.');
      }

      bill.status = 'REJECTED';
      bill.rejectionReason = rejectionReason.trim();
      bill.verifiedByAdminId = adminId;
      bill.updatedAt = new Date();
      dbStore.bills.set(bill.id, bill);

      // User notification
      const notif: NotificationRecord = {
        id: `notif-${Date.now()}`,
        userId: user.id,
        title: 'Bill Verification Rejected',
        message: `Your invoice ${bill.invoiceNumber} was rejected: ${rejectionReason}`,
        type: 'BILL_STATUS',
        isRead: false,
        createdAt: new Date(),
      };
      dbStore.notifications.set(notif.id, notif);

      // Audit Log
      const audit: AuditLogRecord = {
        id: `audit-${Date.now()}`,
        adminId,
        action: 'BILL_REJECTED',
        entityType: 'BILL',
        entityId: bill.id,
        newValue: JSON.stringify({ status: 'REJECTED', reason: rejectionReason }),
        createdAt: new Date(),
      };
      dbStore.auditLogs.set(audit.id, audit);

      return bill;
    }

    // Action is APPROVE:
    // 1. Recalculate reward strictly on backend
    const rules = RewardService.getRewardRules();
    const serverCalculatedReward = RewardService.calculateReward(bill.billAmount, rules.percentage);

    // 2. Enforce monthly ₹50,000 pool cap atomically
    RewardService.claimPoolAmount(serverCalculatedReward);

    // 3. Atomically update bill status
    bill.status = 'APPROVED';
    bill.calculatedReward = serverCalculatedReward;
    bill.rewardPercentage = rules.percentage;
    bill.verifiedByAdminId = adminId;
    bill.rejectionReason = null;
    bill.updatedAt = new Date();
    dbStore.bills.set(bill.id, bill);

    // 4. Update user wallet balance with ledger entry
    wallet.availableBalance = Math.round((wallet.availableBalance + serverCalculatedReward) * 100) / 100;
    wallet.version++;
    wallet.updatedAt = new Date();
    dbStore.wallets.set(wallet.id, wallet);

    // 5. Append immutable wallet transaction
    const tx: WalletTransactionRecord = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      walletId: wallet.id,
      userId: user.id,
      amount: serverCalculatedReward,
      type: 'REWARD_CREDIT',
      balanceAfter: wallet.availableBalance,
      referenceType: 'BILL',
      referenceId: bill.id,
      description: `Reward of ₹${serverCalculatedReward.toFixed(2)} credited for approved invoice ${bill.invoiceNumber}`,
      createdAt: new Date(),
    };
    dbStore.walletTransactions.set(tx.id, tx);

    // 6. User notification
    const notif: NotificationRecord = {
      id: `notif-${Date.now()}`,
      userId: user.id,
      title: 'Reward Credited!',
      message: `₹${serverCalculatedReward.toLocaleString('en-IN')} has been added to your wallet for invoice ${bill.invoiceNumber}!`,
      type: 'REWARD_CREDITED',
      isRead: false,
      createdAt: new Date(),
    };
    dbStore.notifications.set(notif.id, notif);

    // 7. Audit Log
    const audit: AuditLogRecord = {
      id: `audit-${Date.now()}`,
      adminId,
      action: 'BILL_APPROVED',
      entityType: 'BILL',
      entityId: bill.id,
      newValue: JSON.stringify({
        status: 'APPROVED',
        reward: serverCalculatedReward,
        walletBalanceAfter: wallet.availableBalance,
      }),
      createdAt: new Date(),
    };
    dbStore.auditLogs.set(audit.id, audit);

    return bill;
  }
}
