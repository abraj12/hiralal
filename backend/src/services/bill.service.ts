import crypto from 'crypto';
import { prisma } from '../db';
import { RewardService } from './reward.service';
import { StorageService } from './storage';
import { BillStatus } from '@prisma/client';

export class BillService {
  /**
   * Submits a new bill with pre-upload duplicate hash detection and private R2 storage.
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

    // 2. Validate file, magic-bytes, and calculate SHA-256 hash BEFORE uploading
    const { fileHash, normalizedMime } = StorageService.validateAndHashFile({
      buffer: data.fileBuffer,
      originalFilename: data.fileName,
      mimeType: data.mimeType,
      maxSizeInMb: 10,
    });

    // 3. Check duplicate document file hash across all users BEFORE storage write
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

    const billId = crypto.randomUUID();

    // 5. Upload file privately to Cloudflare R2
    const uploadResult = await StorageService.uploadInvoice({
      userId: data.userId,
      billId,
      buffer: data.fileBuffer,
      originalFilename: data.fileName,
      mimeType: normalizedMime,
    });

    // 6. Persist bill record in PostgreSQL
    return await prisma.bill.create({
      data: {
        id: billId,
        userId: data.userId,
        invoiceNumber: cleanInvoiceNumber,
        invoiceDate: new Date(data.invoiceDate),
        billAmount: data.billAmount,
        calculatedReward,
        rewardPercentage: rulePercentage,
        status: 'PENDING',
        fileUrl: uploadResult.fileUrl,
        fileKey: uploadResult.fileKey,
        fileHash,
        fileSize: uploadResult.fileSize,
        mimeType: normalizedMime,
        remarks: data.remarks || null,
      },
    });
  }

  /**
   * Retrieves user bills with freshly generated signed R2 URLs.
   */
  static async getUserBills(userId: string, status?: BillStatus) {
    const bills = await prisma.bill.findMany({
      where: {
        userId,
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return await Promise.all(
      bills.map(async (b) => {
        let freshUrl = b.fileUrl;
        if (b.fileKey) {
          try {
            freshUrl = await StorageService.getSignedInvoiceUrl(b.fileKey, 1800);
          } catch (e) {
            // Keep existing URL if signing error
          }
        }
        return {
          ...b,
          billAmount: Number(b.billAmount),
          calculatedReward: Number(b.calculatedReward),
          rewardPercentage: Number(b.rewardPercentage),
          fileUrl: freshUrl,
        };
      })
    );
  }

  /**
   * Approves a bill atomically with pool headroom check and wallet ledger credit.
   */
  static async approveBill(billId: string, adminId: string, customRewardAmount?: number) {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock and fetch bill
      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { user: true },
      });

      if (!bill) throw new Error('Bill not found.');
      if (bill.status === 'APPROVED') {
        throw new Error('This bill has already been approved.');
      }
      if (bill.status === 'CANCELLED') {
        throw new Error('Cancelled bills cannot be approved.');
      }

      // 2. Final reward calculation
      const finalReward = customRewardAmount !== undefined && customRewardAmount > 0
        ? RewardService.calculateReward(customRewardAmount, 100)
        : Number(bill.calculatedReward);

      // 3. Atomically claim reward amount from monthly pool
      await RewardService.claimPoolAmount(tx, finalReward);

      // 4. Ensure wallet exists and credit atomically
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

      // Update wallet balance atomically
      const updatedWalletRows: any[] = await tx.$queryRaw`
        UPDATE "Wallet"
        SET "availableBalance" = "availableBalance" + ${finalReward}::decimal,
            "version" = "version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${wallet.id}
        RETURNING *;
      `;

      const updatedWallet = updatedWalletRows[0];
      const newBalance = Number(updatedWallet.availableBalance);

      // 5. Create immutable ledger record
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: bill.userId,
          amount: finalReward,
          type: 'REWARD_CREDIT',
          balanceAfter: newBalance,
          referenceType: 'BILL',
          referenceId: bill.id,
          description: `Reward of ₹${finalReward.toFixed(2)} credited for approved invoice #${bill.invoiceNumber}`,
        },
      });

      // 6. Update bill status
      const updatedBill = await tx.bill.update({
        where: { id: bill.id },
        data: {
          status: 'APPROVED',
          calculatedReward: finalReward,
          verifiedByAdminId: adminId,
          rejectionReason: null,
        },
      });

      // 7. Audit Log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'BILL_APPROVED',
          entityType: 'Bill',
          entityId: bill.id,
          newValue: `Approved invoice #${bill.invoiceNumber} for user ${bill.userId}. Credited: ₹${finalReward.toFixed(2)}.`,
        },
      });

      return {
        bill: updatedBill,
        creditedReward: finalReward,
        walletBalance: newBalance,
      };
    });
  }

  /**
   * Rejects a bill. Mandatory rejection reason required.
   */
  static async rejectBill(billId: string, adminId: string, rejectionReason: string) {
    if (!rejectionReason || rejectionReason.trim().length < 3) {
      throw new Error('A valid rejection reason (minimum 3 characters) is required to reject a bill.');
    }

    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) throw new Error('Bill not found.');
    if (bill.status === 'APPROVED') {
      throw new Error('Approved bills cannot be rejected.');
    }

    const updated = await prisma.bill.update({
      where: { id: billId },
      data: {
        status: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
        verifiedByAdminId: adminId,
      },
    });

    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'BILL_REJECTED',
        entityType: 'Bill',
        entityId: billId,
        newValue: `Rejected invoice #${bill.invoiceNumber}. Reason: ${rejectionReason.trim()}`,
      },
    });

    return updated;
  }
}
