import crypto from 'crypto';
import { prisma } from '../db';
import { RewardService } from './reward.service';
import { RewardRuleService } from './reward-rule.service';
import { GstService } from './gst.service';
import { StorageService } from './storage';
import { BillStatus, Profession } from '@prisma/client';

export class BillService {
  /**
   * Submits a new bill with pre-upload duplicate hash detection and private R2 storage.
   * Authoritative profession is ALWAYS loaded from the authenticated User database record.
   * Reward percentage is NOT calculated or fixed at submission time; it is resolved dynamically at verification.
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

    // 2. Validate file, magic-bytes, and calculate SHA-256 hash BEFORE storage write
    const { fileHash, normalizedMime } = StorageService.validateAndHashFile({
      buffer: data.fileBuffer,
      originalFilename: data.fileName,
      mimeType: data.mimeType,
      maxSizeInMb: 10,
    });

    // 3. Check duplicate document file hash across all users
    const duplicateDoc = await prisma.bill.findFirst({
      where: { fileHash },
    });

    if (duplicateDoc) {
      throw new Error('This invoice document has already been uploaded to the system. Duplicate documents are rejected.');
    }

    const billId = crypto.randomUUID();

    // 4. Upload file privately to Cloudflare R2 / S3
    const uploadResult = await StorageService.uploadInvoice({
      userId: data.userId,
      billId,
      buffer: data.fileBuffer,
      originalFilename: data.fileName,
      mimeType: normalizedMime,
    });

    // 5. Persist bill record in PostgreSQL
    // Notice: reward is NOT committed until Admin verifies and approves the invoice.
    try {
      return await prisma.bill.create({
        data: {
          id: billId,
          userId: data.userId,
          invoiceNumber: cleanInvoiceNumber,
          invoiceDate: new Date(data.invoiceDate),
          billAmount: data.billAmount,
          grossBillAmount: data.billAmount,
          gstIncluded: false,
          calculatedReward: 0.0, // Pending verification
          rewardPercentage: null, // Hidden from unapproved bills
          status: 'PENDING',
          fileUrl: uploadResult.fileUrl,
          fileKey: uploadResult.fileKey,
          fileHash,
          fileSize: uploadResult.fileSize,
          mimeType: normalizedMime,
          remarks: data.remarks || null,
        },
      });
    } catch (dbErr: any) {
      try {
        await StorageService.getProvider().delete(uploadResult.fileKey);
      } catch (cleanupErr: any) {
        console.error(`[STORAGE-CLEANUP-FAILED] Failed to delete orphaned file ${uploadResult.fileKey}:`, cleanupErr.message);
      }
      throw dbErr;
    }
  }

  /**
   * Retrieves user bills for mobile worker.
   * INTERNAL BUSINESS RULES (reward percentage, GST breakdown) ARE STRONGLY HIDDEN.
   * Pending bills show reward as null; approved bills show reward earned amount.
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

        const isApproved = b.status === 'APPROVED';

        return {
          id: b.id,
          invoiceNumber: b.invoiceNumber,
          invoiceDate: b.invoiceDate,
          billAmount: Number(b.billAmount),
          status: b.status,
          fileUrl: freshUrl,
          rejectionReason: b.rejectionReason,
          remarks: b.remarks,
          createdAt: b.createdAt,
          // Mobile worker display: reward is available ONLY when approved
          calculatedReward: isApproved ? Number(b.calculatedReward) : null,
          rewardEarned: isApproved ? Number(b.calculatedReward) : null,
          message: isApproved ? 'Approved' : 'Bill submitted. Awaiting verification.',
        };
      })
    );
  }

  /**
   * Admin Bill Directory with strict server-side filtering by profession and status.
   */
  static async getAdminBills(filters: {
    profession?: Profession | 'ALL';
    status?: BillStatus | 'ALL';
    search?: string;
  }) {
    const where: any = {};

    if (filters.profession && filters.profession !== 'ALL') {
      where.user = { profession: filters.profession };
    }

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { user: { mobile: { contains: q } } },
      ];
    }

    const bills = await prisma.bill.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, mobile: true, profession: true } },
        rewardRule: { select: { id: true, version: true, rewardPercentage: true } },
        gstRule: { select: { id: true, ratePercentage: true, description: true } },
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
            // fallback
          }
        }

        return {
          ...b,
          billAmount: Number(b.billAmount),
          grossBillAmount: Number(b.grossBillAmount || b.billAmount),
          gstAmount: b.gstAmount !== null ? Number(b.gstAmount) : 0,
          gstRate: b.gstRate !== null ? Number(b.gstRate) : 0,
          eligibleRewardAmount: b.eligibleRewardAmount !== null ? Number(b.eligibleRewardAmount) : Number(b.billAmount),
          calculatedReward: Number(b.calculatedReward),
          rewardPercentage: b.rewardPercentage !== null ? Number(b.rewardPercentage) : null,
          rewardRateSnapshot: b.rewardRateSnapshot !== null ? Number(b.rewardRateSnapshot) : null,
          fileUrl: freshUrl,
          userFullName: b.user.fullName,
          userMobile: b.user.mobile,
          profession: b.user.profession,
        };
      })
    );
  }

  /**
   * Approves a bill atomically:
   * 1. Loads user's authoritative profession.
   * 2. Resolves applicable active RewardRule for that profession and invoice date.
   * 3. Calculates GST and tax-exclusive eligible reward amount.
   * 4. Calculates final reward.
   * 5. Atomically claims from profession-specific monthly pool.
   * 6. Atomically credits wallet with double-entry ledger entry.
   * 7. Stores complete immutable financial calculation snapshot on the Bill.
   * 8. Records comprehensive audit log.
   */
  static async approveBill(
    billIdOrParams:
      | string
      | {
          billId: string;
          adminId: string;
          gstIncluded?: boolean;
          gstRate?: number;
          gstRuleId?: string;
          gstOverrideReason?: string;
          customRewardAmount?: number;
        },
    adminIdArg?: string,
    optionsArg?: {
      gstIncluded?: boolean;
      gstRate?: number;
      gstRuleId?: string;
      gstOverrideReason?: string;
      customRewardAmount?: number;
    }
  ) {
    let billId: string;
    let adminId: string;
    let options: {
      gstIncluded?: boolean;
      gstRate?: number;
      gstRuleId?: string;
      gstOverrideReason?: string;
      customRewardAmount?: number;
    } | undefined;

    if (typeof billIdOrParams === 'object') {
      billId = billIdOrParams.billId;
      adminId = billIdOrParams.adminId;
      options = billIdOrParams;
    } else {
      billId = billIdOrParams;
      adminId = adminIdArg!;
      options = optionsArg;
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Fetch and lock bill row
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Bill"
        WHERE "id" = ${billId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('Bill not found.');
      }

      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { user: true },
      });

      if (!bill) throw new Error('Bill not found.');
      if (bill.status === 'APPROVED') {
        throw new Error('This bill has already been approved.');
      }
      if (bill.status === 'REJECTED') {
        throw new Error('Rejected bills cannot be approved.');
      }
      if (bill.status === 'CANCELLED') {
        throw new Error('Cancelled bills cannot be approved.');
      }
      if (bill.status === 'DUPLICATE') {
        throw new Error('Duplicate bills cannot be approved.');
      }
      if (bill.status !== 'PENDING' && bill.status !== 'UNDER_REVIEW') {
        throw new Error(`Bills with status ${bill.status} cannot be approved.`);
      }

      const profession: Profession = bill.user.profession || 'PLUMBER';
      const invoiceDate = bill.invoiceDate || new Date();

      // 2. Resolve applicable active reward rule for this profession and date
      const rule = await RewardRuleService.getApplicableRule(profession, invoiceDate, tx);
      const rulePercentage = Number(rule.rewardPercentage);

      // 3. Resolve GST calculation
      const gross = Number(bill.grossBillAmount || bill.billAmount);
      const isGstIncluded = options?.gstIncluded === true;
      let effectiveGstRate = 0.0;
      let selectedGstRuleId: string | null = null;

      if (isGstIncluded) {
        if (options?.gstRuleId) {
          const gstRule = await tx.gstRule.findUnique({ where: { id: options.gstRuleId } });
          if (gstRule) {
            effectiveGstRate = Number(gstRule.ratePercentage);
            selectedGstRuleId = gstRule.id;
          }
        } else if (typeof options?.gstRate === 'number' && options.gstRate >= 0) {
          effectiveGstRate = options.gstRate;
        } else {
          const defaultGst = await GstService.getDefaultGstRule(tx);
          if (defaultGst) {
            effectiveGstRate = Number(defaultGst.ratePercentage);
            selectedGstRuleId = defaultGst.id;
          }
        }
      }

      const gstCalc = GstService.calculateGstAndEligibleAmount(gross, isGstIncluded, effectiveGstRate);

      // 4. Final reward calculation
      let finalReward: number;
      if (typeof options?.customRewardAmount === 'number' && options.customRewardAmount > 0) {
        finalReward = Math.round(options.customRewardAmount * 100) / 100;
      } else {
        finalReward = RewardService.calculateReward(gstCalc.eligibleRewardAmount, rulePercentage);
      }

      // 5. Atomically claim reward amount from profession-specific monthly pool
      await RewardService.claimPoolAmount(tx, profession, finalReward);

      // 6. Ensure wallet exists and credit atomically
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

      // 7. Create immutable ledger record
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: bill.userId,
          amount: finalReward,
          type: 'REWARD_CREDIT',
          balanceAfter: newBalance,
          referenceType: 'BILL',
          referenceId: bill.id,
          description: `Reward of ₹${finalReward.toFixed(2)} credited for approved invoice #${bill.invoiceNumber} (${profession})`,
        },
      });

      // 8. Update bill status and store complete financial calculation snapshot
      const updatedBill = await tx.bill.update({
        where: { id: bill.id },
        data: {
          status: 'APPROVED',
          grossBillAmount: gross,
          gstIncluded: gstCalc.gstIncluded,
          gstRate: gstCalc.gstRate,
          gstAmount: gstCalc.gstAmount,
          eligibleRewardAmount: gstCalc.eligibleRewardAmount,
          calculatedReward: finalReward,
          rewardPercentage: rule.rewardPercentage,
          rewardRateSnapshot: rule.rewardPercentage,
          rewardRuleId: rule.id,
          gstRuleId: selectedGstRuleId,
          gstOverrideReason: options?.gstOverrideReason || null,
          verifiedByAdminId: adminId,
          rejectionReason: null,
        },
      });

      // 9. Immutable Audit Log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'BILL_APPROVED',
          entityType: 'Bill',
          entityId: bill.id,
          newValue: JSON.stringify({
            invoiceNumber: bill.invoiceNumber,
            profession,
            grossBillAmount: gross,
            gstIncluded: gstCalc.gstIncluded,
            gstRate: gstCalc.gstRate,
            gstAmount: gstCalc.gstAmount,
            eligibleRewardAmount: gstCalc.eligibleRewardAmount,
            rewardRate: rulePercentage,
            rewardRuleId: rule.id,
            rewardCredited: finalReward,
            gstOverrideReason: options?.gstOverrideReason || null,
          }),
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
   * Rejects a bill with mandatory reason.
   */
  static async rejectBill(billId: string, adminId: string, rejectionReason: string) {
    if (!rejectionReason || rejectionReason.trim().length < 3) {
      throw new Error('A valid rejection reason (minimum 3 characters) is required to reject a bill.');
    }

    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Bill"
        WHERE "id" = ${billId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('Bill not found.');
      }

      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { user: true },
      });

      if (!bill) throw new Error('Bill not found.');
      if (bill.status === 'APPROVED') {
        throw new Error('Approved bills cannot be rejected.');
      }
      if (bill.status === 'REJECTED') {
        throw new Error('This bill has already been rejected.');
      }
      if (bill.status === 'CANCELLED') {
        throw new Error('Cancelled bills cannot be rejected.');
      }
      if (bill.status === 'DUPLICATE') {
        throw new Error('Duplicate bills cannot be rejected.');
      }
      if (bill.status !== 'PENDING' && bill.status !== 'UNDER_REVIEW') {
        throw new Error(`Bills with status ${bill.status} cannot be rejected.`);
      }

      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'REJECTED',
          rejectionReason: rejectionReason.trim(),
          verifiedByAdminId: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'BILL_REJECTED',
          entityType: 'Bill',
          entityId: billId,
          newValue: JSON.stringify({
            invoiceNumber: bill.invoiceNumber,
            profession: bill.user?.profession,
            rejectionReason: rejectionReason.trim(),
          }),
        },
      });

      return updated;
    });
  }
}
