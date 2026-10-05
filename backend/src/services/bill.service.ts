import { prisma } from '../db';
import { RewardService } from './reward.service';
import { StorageService } from './storage.service';
import { BillStatus } from '@prisma/client';

export class BillService {
  /**
   * Submits a new bill with real file upload and duplicate hash detection.
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
  }) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    if (data.billAmount <= 0) {
      throw new Error('Bill amount must be greater than zero.');
    }

    const cleanInvoiceNumber = data.invoiceNumber.trim().toUpperCase();

    // 1. Check duplicate invoice number for this user
    const existingInvoice = await prisma.bill.findUnique({
      where: {
        user_invoice_unique: {
          userId: data.userId,
          invoiceNumber: cleanInvoiceNumber,
        },
      },
    });

    if (existingInvoice) {
      throw new Error(`Invoice #${cleanInvoiceNumber} has already been submitted by your account.`);
    }

    // 2. Upload file to R2 / Storage and compute SHA-256 hash
    const { fileKey, fileUrl, fileHash, fileSize } = await StorageService.uploadInvoiceFile(
      data.fileBuffer,
      data.fileName,
      data.mimeType,
      data.userId
    );

    // 3. Check duplicate document file hash across all users
    const duplicateDoc = await prisma.bill.findFirst({
      where: { fileHash },
    });

    if (duplicateDoc) {
      throw new Error('This invoice document has already been uploaded to the system. Duplicate documents are rejected.');
    }

    // 4. Calculate estimated reward server-side
    const rule = await RewardService.getRewardRule(user.profession);
    const rulePercentage = Number(rule.percentage);
    const calculatedReward = RewardService.calculateReward(data.billAmount, rulePercentage);

    // 5. Create bill in PostgreSQL
    return await prisma.bill.create({
      data: {
        userId: data.userId,
        invoiceNumber: cleanInvoiceNumber,
        invoiceDate: new Date(data.invoiceDate),
        billAmount: data.billAmount,
        calculatedReward,
        rewardPercentage: rulePercentage,
        status: 'PENDING',
        fileUrl,
        fileKey,
        fileHash,
        fileSize,
        mimeType: data.mimeType,
        remarks: data.remarks || null,
      },
    });
  }

  /**
   * Retrieves all bills for a specific user with freshly signed private URLs.
   */
  static async getUserBills(userId: string, status?: BillStatus) {
    const bills = await prisma.bill.findMany({
      where: {
        userId,
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return bills.map((b) => ({
      ...b,
      billAmount: Number(b.billAmount),
      calculatedReward: Number(b.calculatedReward),
      rewardPercentage: Number(b.rewardPercentage),
      fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
    }));
  }

  /**
   * Retrieves single bill with signed URL.
   */
  static async getBillById(billId: string, userId?: string) {
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: {
        user: {
          select: { id: true, fullName: true, mobile: true, profession: true },
        },
      },
    });

    if (!bill) {
      throw new Error('Invoice not found.');
    }

    if (userId && bill.userId !== userId) {
      throw new Error('Unauthorized access to this bill.');
    }

    return {
      ...bill,
      billAmount: Number(bill.billAmount),
      calculatedReward: Number(bill.calculatedReward),
      rewardPercentage: Number(bill.rewardPercentage),
      fileUrl: StorageService.generateSignedUrl(bill.fileKey, 60),
    };
  }

  /**
   * Admin approves a bill: recalculates reward server-side, checks monthly cap, and credits wallet transactionally.
   */
  static async approveBill(billId: string, adminId: string, remarks?: string) {
    return await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { user: true },
      });

      if (!bill) {
        throw new Error('Bill not found.');
      }

      if (bill.status === 'APPROVED') {
        throw new Error('This bill has already been approved.');
      }

      // 1. Recalculate reward server-side based on user profession
      const rule = await RewardService.getRewardRule(bill.user.profession);
      const rulePercentage = Number(rule.percentage);
      const approvedBillAmount = Number(bill.billAmount);
      const finalReward = RewardService.calculateReward(approvedBillAmount, rulePercentage);

      // 2. Claim amount from monthly pool atomically
      await RewardService.claimPoolAmount(tx, finalReward);

      // 3. Fetch or initialize wallet
      let wallet = await tx.wallet.findUnique({
        where: { userId: bill.userId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: bill.userId,
            availableBalance: 0.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        });
      }

      const newBalance = Number(wallet.availableBalance) + finalReward;

      // 4. Update wallet balance
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: newBalance,
          version: { increment: 1 },
        },
      });

      // 5. Create immutable double-entry ledger entry
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: bill.userId,
          amount: finalReward,
          type: 'REWARD_CREDIT',
          balanceAfter: newBalance,
          referenceType: 'BILL',
          referenceId: bill.id,
          description: `Reward credited for approved invoice #${bill.invoiceNumber} (${rulePercentage}%)`,
        },
      });

      // 6. Update bill status
      const updatedBill = await tx.bill.update({
        where: { id: bill.id },
        data: {
          status: 'APPROVED',
          calculatedReward: finalReward,
          rewardPercentage: rulePercentage,
          verifiedByAdminId: adminId,
          remarks: remarks || null,
        },
      });

      // 7. Create notification for user
      await tx.notification.create({
        data: {
          userId: bill.userId,
          title: 'Bill Approved! Reward Credited',
          message: `Your invoice #${bill.invoiceNumber} (₹${approvedBillAmount.toLocaleString('en-IN')}) has been approved. ₹${finalReward.toFixed(2)} has been credited to your rewards wallet.`,
          type: 'BILL_APPROVED',
        },
      });

      // 8. Record audit log
      const validAdmin = adminId ? await tx.user.findUnique({ where: { id: adminId } }) : null;
      await tx.auditLog.create({
        data: {
          adminId: validAdmin ? adminId : null,
          action: 'BILL_APPROVED',
          entityType: 'BILL',
          entityId: bill.id,
          newValue: JSON.stringify({ reward: finalReward, balanceAfter: newBalance }),
        },
      });

      return {
        bill: updatedBill,
        wallet: updatedWallet,
        rewardCredited: finalReward,
      };
    });
  }

  /**
   * Admin rejects a bill with mandatory reason.
   */
  static async rejectBill(billId: string, adminId: string, reason: string) {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A rejection reason is mandatory when rejecting a bill.');
    }

    return await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id: billId },
      });

      if (!bill) {
        throw new Error('Bill not found.');
      }

      if (bill.status === 'APPROVED') {
        throw new Error('Cannot reject a bill that has already been approved and credited.');
      }

      const updatedBill = await tx.bill.update({
        where: { id: bill.id },
        data: {
          status: 'REJECTED',
          rejectionReason: reason.trim(),
          verifiedByAdminId: adminId,
        },
      });

      await tx.notification.create({
        data: {
          userId: bill.userId,
          title: 'Bill Rejected',
          message: `Your invoice #${bill.invoiceNumber} was rejected. Reason: ${reason.trim()}`,
          type: 'BILL_REJECTED',
        },
      });

      const validAdmin = adminId ? await tx.user.findUnique({ where: { id: adminId } }) : null;
      await tx.auditLog.create({
        data: {
          adminId: validAdmin ? adminId : null,
          action: 'BILL_REJECTED',
          entityType: 'BILL',
          entityId: bill.id,
          newValue: JSON.stringify({ reason: reason.trim() }),
        },
      });

      return updatedBill;
    });
  }
}
