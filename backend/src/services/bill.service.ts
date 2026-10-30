import crypto from 'crypto';
import { prisma } from '../db';
import { RewardService } from './reward.service';
import { RewardRuleService } from './reward-rule.service';
import { GstService } from './gst.service';
import { StorageService } from './storage';
import { NotificationService } from './notification.service';
import { Bill, BillStatus, Profession } from '@prisma/client';
import { parseIndiaBusinessDate } from '../utils/timezone.utils';
import { getInvoiceIdentity, isUniqueViolation } from '../utils/invoice-identity.utils';

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
    parentBillId?: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    if (user.role !== 'USER') {
      throw new Error('Only registered users can submit bills for rewards.');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('User account is suspended or inactive.');
    }

    if (user.deletionScheduledAt) {
      throw new Error('Account is scheduled for deletion; new invoice submissions are disabled.');
    }

    if (!Number.isFinite(data.billAmount) || data.billAmount < 1.00) {
      throw new Error('Bill amount must be greater than zero. Minimum bill amount is ₹1.00.');
    }

    const cleanInvoiceNumber = data.invoiceNumber.trim().toUpperCase();
    const invoiceDate = parseIndiaBusinessDate(data.invoiceDate);
    const identity = getInvoiceIdentity(cleanInvoiceNumber, invoiceDate);

    // 1. Validate file, magic-bytes, and calculate SHA-256 hash BEFORE storage write
    const { fileHash, normalizedMime } = StorageService.validateAndHashFile({
      buffer: data.fileBuffer,
      originalFilename: data.fileName,
      mimeType: data.mimeType,
      maxSizeInMb: (() => {
        const val = parseInt(process.env.BILL_MAX_UPLOAD_SIZE_MB || '10', 10);
        return Number.isFinite(val) && val > 0 ? val : 10;
      })(),
    });

    const billId = crypto.randomUUID();
    let uploadedFileKey: string | null = null;

    try {
      // AUDIT-DB-01: Upload file privately to Cloudflare R2 / S3 staging path OUTSIDE interactive transaction
      // This prevents slow network uplinks (>5s) from triggering Prisma transaction timeouts or connection starvation.
      const uploadResult = await StorageService.uploadInvoice({
        userId: data.userId,
        billId,
        buffer: data.fileBuffer,
        originalFilename: data.fileName,
        mimeType: normalizedMime,
      });
      uploadedFileKey = uploadResult.fileKey;

      return await prisma.$transaction(async (tx) => {
        // Re-query and lock the User record to eliminate TOCTOU race with account deletion (DB-001)
        const lockedUserRows = await tx.$queryRaw<Array<{ id: string; status: string; deletionScheduledAt: Date | null }>>`
          SELECT "id", "status", "deletionScheduledAt"
          FROM "User"
          WHERE "id" = ${data.userId}
          FOR UPDATE
        `;
        const lockedUser = lockedUserRows[0];
        if (!lockedUser || lockedUser.status !== 'ACTIVE' || lockedUser.deletionScheduledAt) {
          throw new Error('Account is inactive or scheduled for deletion; invoice submission aborted.');
        }

        // Serialize operations on this invoice identity and document hash to eliminate TOCTOU races
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity.lockKey}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'lock:doc:' + fileHash}))`;

        // Check duplicate document file hash across all users (additional check on top of invoice identity)
        const duplicateDoc = await tx.bill.findFirst({
          where: { fileHash },
        });

        if (duplicateDoc) {
          throw new Error('This invoice document has already been uploaded to the system. Duplicate documents are rejected.');
        }

        // Single-seller invoice identity check across ALL customers. The amount is not part of the
        // identity, so a different claimed amount cannot make a duplicate invoice look unique.
        const liveClaim = await tx.bill.findFirst({
          where: {
            invoicePeriod: identity.invoicePeriod,
            invoiceKey: identity.invoiceKey,
            status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] },
          },
          select: { userId: true, status: true },
        });
        if (liveClaim) {
          if (liveClaim.userId === data.userId) {
            throw new Error(
              liveClaim.status === 'APPROVED'
                ? `Invoice #${cleanInvoiceNumber} dated ${identity.invoicePeriod} has already been approved.`
                : `Invoice #${cleanInvoiceNumber} dated ${identity.invoicePeriod} is currently undergoing review.`
            );
          }
          throw new Error(`Invoice #${cleanInvoiceNumber} dated ${identity.invoicePeriod} has already been submitted on the platform.`);
        }

        // Rejected-invoice resubmission: link to the rejected bill so revision history is preserved.
        // An explicit parentBillId lets the customer correct the number/date of a rejected invoice;
        // otherwise this customer's latest rejected bill with the same identity is used.
        let parent: Bill | null = null;
        if (data.parentBillId) {
          parent = await tx.bill.findFirst({ where: { id: data.parentBillId, userId: data.userId } });
          if (!parent) {
            throw new Error('The invoice being resubmitted was not found.');
          }
        } else {
          parent = await tx.bill.findFirst({
            where: { userId: data.userId, invoicePeriod: identity.invoicePeriod, invoiceKey: identity.invoiceKey },
            orderBy: [{ createdAt: 'desc' }, { revisionNumber: 'desc' }],
          });
          if (parent && parent.status !== 'REJECTED') {
            throw new Error(`Invoice #${cleanInvoiceNumber} cannot be resubmitted while in status ${parent.status}.`);
          }
        }

        let revisionNumber = 1;
        let parentBillId: string | null = null;
        let requiresSecondaryApproval = false;
        let initialStatus: BillStatus = 'PENDING';

        if (parent) {
          if (parent.status !== 'REJECTED') {
            throw new Error('Only rejected invoices can be resubmitted.');
          }
          const existingChild = await tx.bill.findFirst({ where: { parentBillId: parent.id }, select: { id: true } });
          if (existingChild) {
            throw new Error('This rejected invoice has already been resubmitted. Resubmit the latest revision instead.');
          }
          parentBillId = parent.id;
          revisionNumber = parent.revisionNumber + 1;

          let rootBill = parent;
          for (let depth = 0; rootBill.parentBillId && depth < 50; depth++) {
            const ancestor = await tx.bill.findUnique({ where: { id: rootBill.parentBillId } });
            if (!ancestor) break;
            rootBill = ancestor;
          }
          const rootGross = Number(rootBill.grossBillAmount || rootBill.billAmount);
          const parentGross = Number(parent.grossBillAmount || parent.billAmount);
          const newGross = data.billAmount;
          if ((parentGross > 0 && newGross > parentGross * 1.25) || (rootGross > 0 && newGross > rootGross * 1.25)) {
            requiresSecondaryApproval = true;
            initialStatus = 'UNDER_REVIEW';
          }
        }

        return await tx.bill.create({
          data: {
            id: billId,
            userId: data.userId,
            invoiceNumber: cleanInvoiceNumber,
            invoiceDate,
            billAmount: data.billAmount,
            grossBillAmount: data.billAmount,
            gstIncluded: false,
            calculatedReward: 0.0, // Pending verification
            rewardPercentage: null, // Hidden from unapproved bills
            status: initialStatus,
            parentBillId,
            revisionNumber,
            requiresSecondaryApproval,
            fileUrl: uploadResult.fileUrl,
            fileKey: uploadResult.fileKey,
            fileHash,
            fileSize: uploadResult.fileSize,
            mimeType: normalizedMime,
            remarks: data.remarks || null,
          },
        });
      });
    } catch (err: any) {
      if (uploadedFileKey) {
        try {
          await StorageService.getProvider().delete(uploadedFileKey);
        } catch (cleanupErr: any) {
          console.error(`[STORAGE-CLEANUP-FAILED] Failed to delete file ${uploadedFileKey}:`, cleanupErr.message);
        }
      }
      // Database-level backstop: Bill_live_invoice_identity_key / Bill_parentBillId_key / fileHash
      if (isUniqueViolation(err)) {
        throw new Error(`Invoice #${cleanInvoiceNumber} dated ${identity.invoicePeriod} has already been submitted on the platform.`);
      }
      throw err;
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
      take: 100,
    });

    return await Promise.all(
      bills.map(async (b) => {
        let freshUrl: string | null = null;
        if (b.fileKey) {
          try {
            freshUrl = await StorageService.getSignedInvoiceUrl(b.fileKey, 1800);
          } catch (e: any) {
            console.error(`[STORAGE-ERROR] Failed to generate signed URL for user bill ${b.id}: ${e?.message || e}`);
            freshUrl = null;
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
          message: isApproved
            ? 'Approved'
            : b.status === 'REJECTED'
            ? 'Rejected'
            : 'Bill submitted. Awaiting verification.',
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
    userRole?: string;
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
      take: 200,
    });

    return await Promise.all(
      bills.map(async (b) => {
        let freshUrl: string | null = null;
        const canAccessDocument =
          !filters.userRole ||
          filters.userRole === 'BILL_ADMIN' ||
          (filters.userRole === 'OPERATIONS_ADMIN' && Boolean(b.requiresSecondaryApproval));

        if (b.fileKey && canAccessDocument) {
          try {
            freshUrl = await StorageService.getSignedInvoiceUrl(b.fileKey, 1800);
          } catch (e: any) {
            console.error(`[STORAGE-ERROR] Failed to generate signed URL for admin bill ${b.id}: ${e?.message || e}`);
            freshUrl = null;
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
   * 2. Resolves applicable active RewardRule for that profession and bill submission timestamp (createdAt).
   * 3. Calculates GST and tax-exclusive eligible reward amount.
   * 4. Calculates final reward.
   * 5. Pool-free direct cashback reward model (no monthly or global pool caps).
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
          correctedGrossAmount?: number;
          isOperationsAdminApproved?: boolean;
        },
    adminIdArg?: string,
    optionsArg?: {
      gstIncluded?: boolean;
      gstRate?: number;
      gstRuleId?: string;
      gstOverrideReason?: string;
      isOperationsAdminApproved?: boolean;
    }
  ) {
    let billId: string;
    let adminId: string;
    let options: {
      gstIncluded?: boolean;
      gstRate?: number;
      gstRuleId?: string;
      gstOverrideReason?: string;
      isOperationsAdminApproved?: boolean;
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

    const result = await prisma.$transaction(async (tx) => {
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
      if (bill.userId === adminId) {
        throw new Error('Administrators cannot approve bills submitted under their own account.');
      }
      // SEC-HIGH-13: Trojan craftsman collusion guard - administrators cannot approve bills for accounts matching their phone
      const adminUser = await tx.user.findUnique({ where: { id: adminId }, select: { mobile: true } });
      if (adminUser && bill.user && bill.user.mobile) {
        const adminClean = adminUser.mobile.replace(/\D/g, '').slice(-10);
        const userClean = bill.user.mobile.replace(/\D/g, '').slice(-10);
        if (adminClean === userClean) {
          throw new Error('Administrators cannot approve bills submitted under accounts matching their registered mobile number.');
        }
      }
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

      // Defense-in-depth: single-seller invoice identity (Hiralal & Sons + YYYY-MM + normalised number)
      // must not already be approved for ANY customer. The amount is not part of the identity.
      // Bill_live_invoice_identity_key enforces the same rule in the database.
      const identity = getInvoiceIdentity(bill.invoiceNumber, bill.invoiceDate);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity.lockKey}))`;
      const alreadyApproved = await tx.bill.findFirst({
        where: {
          id: { not: bill.id },
          invoicePeriod: identity.invoicePeriod,
          invoiceKey: identity.invoiceKey,
          status: 'APPROVED',
        },
        select: { id: true },
      });
      if (alreadyApproved) {
        throw new Error(
          `[DUPLICATE_INVOICE] Invoice #${bill.invoiceNumber} dated ${identity.invoicePeriod} has already been approved (bill ${alreadyApproved.id}). Reject this submission as a duplicate.`
        );
      }

      if (!bill.user.profession) {
        throw new Error('User has no registered profession. Cannot resolve reward rule.');
      }
      const profession = bill.user.profession;
      // Authoritative server-recorded bill-submission timestamp determines applicable reward & GST rules
      const submissionTimestamp = bill.createdAt || new Date();

      // 2. Resolve applicable active reward rule for this profession and submission timestamp
      const rule = await RewardRuleService.getApplicableRule(profession, submissionTimestamp, tx);
      const rulePercentage = Number(rule.rewardPercentage);

      // 3. Resolve GST calculation
      // HIGHEST-PRIORITY BUSINESS RULE: Bill Admin must NEVER edit a submitted invoice.
      // Gross amount is strictly immutable and derived from the submitter's original submission.
      const gross = Number(bill.grossBillAmount || bill.billAmount);

      // ADV-02 / Secondary review rule: If bill requires secondary approval (>25% upward revision),
      // only OPERATIONS_ADMIN can approve it.
      if (bill.requiresSecondaryApproval && !options?.isOperationsAdminApproved) {
        throw new Error(
          'This invoice revision exceeds upward deviation thresholds and requires secondary approval by an Operations Administrator.'
        );
      }

      const isGstIncluded = options?.gstIncluded === true;
      let effectiveGstRate = 0.0;
      let selectedGstRuleId: string | null = null;

      if (isGstIncluded) {
        if (!options?.gstRuleId) {
          throw new Error(
            '[NO_APPLICABLE_GST_RULE] A valid applicable GST rule is required when GST is included. Bill Review Administrators cannot manually override GST rates; rates are determined strictly by Operations Administrator rules.'
          );
        }
        const gstRule = await tx.gstRule.findUnique({ where: { id: options.gstRuleId } });
        if (
          !gstRule ||
          !gstRule.isActive ||
          submissionTimestamp < gstRule.effectiveFrom ||
          (gstRule.effectiveUntil !== null && submissionTimestamp >= gstRule.effectiveUntil)
        ) {
          throw new Error('The selected GST rule is invalid or not applicable to this bill');
        }
        selectedGstRuleId = gstRule.id;
        effectiveGstRate = Number(gstRule.ratePercentage);
        if (typeof options?.gstRate === 'number' && Number.isFinite(options.gstRate)) {
          if (Math.abs(options.gstRate - effectiveGstRate) > 0.001) {
            throw new Error(`Submitted GST rate ${options.gstRate}% conflicts with configured rule rate ${effectiveGstRate}%.`);
          }
        }
      } else {
        selectedGstRuleId = null;
        effectiveGstRate = 0.0;
      }

      const gstCalc = GstService.calculateReverseGst(gross, isGstIncluded, isGstIncluded ? effectiveGstRate : null);

      // 4. Final reward calculation strictly rule-based
      const finalReward = RewardService.calculateReward(gstCalc.eligibleRewardAmount, rulePercentage);

      if (finalReward < 0) {
        throw new Error('Calculated reward amount cannot be negative.');
      }

      // 5. Ensure wallet exists and credit atomically only if reward > 0 (FIN-002: Zero-reward bills approved without ledger failure)
      let newBalance = 0;
      if (finalReward > 0) {
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
              deficitLiability: 0.0,
            },
          });
        }

        // Lock wallet FOR UPDATE to read fresh deficitLiability and prevent concurrent race conditions
        const lockedWalletRows = await tx.$queryRaw<Array<{ id: string; availableBalance: any; deficitLiability: any }>>`
          SELECT "id", "availableBalance", "deficitLiability"
          FROM "Wallet"
          WHERE "id" = ${wallet.id}
          FOR UPDATE
        `;
        const lockedWallet = lockedWalletRows[0] || wallet;
        const previousBalance = Number(lockedWallet.availableBalance || 0);

        // FIN-FINDING-04: Offset deficit liability from previous financial drift clawbacks
        const currentDeficit = Number(lockedWallet.deficitLiability || 0);
        const deficitOffset = Math.min(currentDeficit, finalReward);
        const netCreditToBalance = finalReward - deficitOffset;

        const updatedWalletRows: any[] = await tx.$queryRaw`
          UPDATE "Wallet"
          SET "availableBalance" = "availableBalance" + ${netCreditToBalance}::decimal,
              "deficitLiability" = "deficitLiability" - ${deficitOffset}::decimal,
              "version" = "version" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${wallet.id}
          RETURNING *;
        `;

        const updatedWallet = updatedWalletRows[0];
        newBalance = Number(updatedWallet.availableBalance);

        // 7. Create immutable ledger record(s) - FINDING-15: Double-entry ledger continuity
        if (deficitOffset > 0) {
          const balanceAfterGrossCredit = previousBalance + finalReward;
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              userId: bill.userId,
              amount: finalReward,
              type: 'REWARD_CREDIT',
              balanceAfter: balanceAfterGrossCredit,
              referenceType: 'BILL',
              referenceId: bill.id,
              description: `Reward of ${Number(finalReward).toLocaleString('en-IN')} Points credited for approved invoice #${bill.invoiceNumber} (${profession})`,
            },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              userId: bill.userId,
              amount: deficitOffset,
              type: 'DEFICIT_OFFSET',
              balanceAfter: newBalance,
              referenceType: 'BILL',
              referenceId: bill.id,
              description: `Deficit liability offset of ${Number(deficitOffset).toLocaleString('en-IN')} Points deducted against approved invoice #${bill.invoiceNumber} (${profession})`,
            },
          });
        } else {
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              userId: bill.userId,
              amount: finalReward,
              type: 'REWARD_CREDIT',
              balanceAfter: newBalance,
              referenceType: 'BILL',
              referenceId: bill.id,
              description: `Reward of ${Number(finalReward).toLocaleString('en-IN')} Points credited for approved invoice #${bill.invoiceNumber} (${profession})`,
            },
          });
        }
      } else {
        const existingWallet = await tx.wallet.findUnique({
          where: { userId: bill.userId },
          select: { availableBalance: true },
        });
        newBalance = Number(existingWallet?.availableBalance || 0);
      }

      if (options?.isOperationsAdminApproved && bill.requiresSecondaryApproval) {
        if (bill.verifiedByAdminId && bill.verifiedByAdminId === adminId) {
          throw new Error('Secondary approver cannot be the same administrator who performed primary verification.');
        }
        // FINDING-07: Dual custody revision ancestor recursion - check all ancestor revisions up to root
        let currentAncestorId = bill.parentBillId;
        const visitedAncestors = new Set<string>();
        while (currentAncestorId && !visitedAncestors.has(currentAncestorId)) {
          visitedAncestors.add(currentAncestorId);
          const ancestor = await tx.bill.findUnique({
            where: { id: currentAncestorId },
            select: { parentBillId: true, verifiedByAdminId: true, secondaryApprovedByAdminId: true },
          });
          if (!ancestor) break;
          if (
            (ancestor.verifiedByAdminId && ancestor.verifiedByAdminId === adminId) ||
            (ancestor.secondaryApprovedByAdminId && ancestor.secondaryApprovedByAdminId === adminId)
          ) {
            throw new Error('Secondary approver cannot be the same administrator who performed primary verification or secondary approval on any ancestor revision of this bill.');
          }
          currentAncestorId = ancestor.parentBillId;
        }

        // HIR-M-02: Dual custody requires a recorded BILL_ADMIN primary verification before the
        // Operations Administrator's secondary approval can credit the wallet.
        const primaryVerifier = bill.verifiedByAdminId
          ? await tx.user.findUnique({ where: { id: bill.verifiedByAdminId }, select: { role: true } })
          : null;
        if (!primaryVerifier || primaryVerifier.role !== 'BILL_ADMIN') {
          throw new Error(
            '[PRIMARY_VERIFICATION_REQUIRED] This invoice revision must first be verified by the Bill Review Administrator before Operations Administrator approval.'
          );
        }
      }

      // 8. Update bill status and store complete financial calculation snapshot
      const updatedBill = await tx.bill.update({
        where: { id: bill.id },
        data: {
          status: 'APPROVED',
          grossBillAmount: gross,
          billAmount: gross,
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
          verifiedByAdminId: bill.requiresSecondaryApproval ? (bill.verifiedByAdminId || null) : adminId,
          secondaryApprovedByAdminId: options?.isOperationsAdminApproved ? adminId : bill.secondaryApprovedByAdminId,
          secondaryApprovedAt: options?.isOperationsAdminApproved ? new Date() : bill.secondaryApprovedAt,
          rejectionReason: null,
          remarks: bill.remarks,
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
            invoicePeriod: identity.invoicePeriod,
            profession,
            grossBillAmount: gross,
            gstIncluded: gstCalc.gstIncluded,
            gstRate: gstCalc.gstRate,
            gstAmount: gstCalc.gstAmount,
            eligibleRewardAmount: gstCalc.eligibleRewardAmount,
            rewardRate: rulePercentage,
            rewardRuleId: rule.id,
            rewardRuleVersion: rule.version,
            rewardCredited: finalReward,
            calculationTimestamp: new Date().toISOString(),
            submissionTimestamp: submissionTimestamp.toISOString(),
            gstOverrideReason: options?.gstOverrideReason || null,
          }),
        },
      });

      // 10. User In-App Notification
      await tx.notification.create({
        data: {
          userId: bill.userId,
          title: 'Bill Approved',
          message: `Your bill (Invoice #${bill.invoiceNumber || bill.id.slice(0, 8)}) has been approved! ${Number(finalReward).toLocaleString('en-IN')} Points reward has been credited to your rewards wallet.`,
          type: 'BILL_APPROVED',
          metadata: {
            billId: bill.id,
            invoiceNumber: bill.invoiceNumber,
            rewardCredited: finalReward,
            walletBalance: newBalance,
          },
          dedupeKey: `bill_approved_${bill.id}`,
        },
      });

      return {
        bill: updatedBill,
        creditedReward: finalReward,
        walletBalance: newBalance,
      };
    });

    NotificationService.dispatchPushForUser(
      result.bill.userId,
      'Bill Approved',
      `Your bill (Invoice #${result.bill.invoiceNumber || result.bill.id.slice(0, 8)}) has been approved! ${Number(result.creditedReward).toLocaleString('en-IN')} Points reward has been credited to your rewards wallet.`,
      { billId: result.bill.id, invoiceNumber: result.bill.invoiceNumber, rewardCredited: result.creditedReward, walletBalance: result.walletBalance }
    ).catch((err) => console.error('[BILL-SERVICE] Push notification dispatch failed:', err.message));

    return result;
  }

  /**
   * HIR-M-02: Records the Bill Review Administrator's primary verification of an invoice revision that
   * requires secondary approval. No reward is credited; the bill stays UNDER_REVIEW until the
   * Operations Administrator performs the secondary approval.
   */
  static async recordPrimaryVerification(
    billId: string,
    adminId: string,
    params: { remarks?: string }
  ) {
    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Bill" WHERE "id" = ${billId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('Bill not found.');
      }

      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new Error('Bill not found.');
      if (!bill.requiresSecondaryApproval) {
        throw new Error('Primary verification applies only to invoice revisions that require secondary approval.');
      }
      if (bill.status !== 'PENDING' && bill.status !== 'UNDER_REVIEW') {
        throw new Error(`Bills with status ${bill.status} cannot be verified.`);
      }
      if (bill.verifiedByAdminId) {
        throw new Error('This invoice revision has already been verified and is awaiting Operations Administrator approval.');
      }
      if (bill.userId === adminId) {
        throw new Error('Administrators cannot verify bills submitted under their own account.');
      }

      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'UNDER_REVIEW',
          verifiedByAdminId: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'BILL_PRIMARY_VERIFIED',
          entityType: 'Bill',
          entityId: billId,
          newValue: JSON.stringify({
            invoiceNumber: bill.invoiceNumber,
            remarks: params.remarks?.trim() || null,
            forwardedTo: 'OPERATIONS_ADMIN',
          }),
        },
      });

      return updated;
    });
  }

  /**
   * Rejects a bill with mandatory reason.
   */
  static async rejectBill(billId: string, adminId: string, rejectionReason: string) {
    if (!rejectionReason || rejectionReason.trim().length < 3) {
      throw new Error('A valid rejection reason (minimum 3 characters) is required to reject a bill.');
    }

    const result = await prisma.$transaction(async (tx) => {
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

      // User In-App Notification
      await tx.notification.create({
        data: {
          userId: bill.userId,
          title: 'Bill Rejected',
          message: `Your bill (Invoice #${bill.invoiceNumber || bill.id.slice(0, 8)}) could not be approved. Reason: ${rejectionReason.trim()}`,
          type: 'BILL_REJECTED',
          metadata: {
            billId: bill.id,
            invoiceNumber: bill.invoiceNumber,
            rejectionReason: rejectionReason.trim(),
          },
          dedupeKey: `bill_rejected_${bill.id}`,
        },
      });

      return updated;
    });

    NotificationService.dispatchPushForUser(
      result.userId,
      'Bill Rejected',
      `Your bill (Invoice #${result.invoiceNumber || result.id.slice(0, 8)}) could not be approved. Reason: ${rejectionReason.trim()}`,
      { billId: result.id, invoiceNumber: result.invoiceNumber, rejectionReason: rejectionReason.trim() }
    ).catch((err) => console.error('[BILL-SERVICE] Push notification dispatch failed:', err.message));

    return result;
  }

  /**
   * Cancels a submitted or under-review bill (invalid or fraudulent submission) with mandatory reason.
   */
  static async cancelBill(billId: string, adminId: string, reason: string) {
    if (!reason || !reason.trim() || reason.trim().length < 3) {
      throw new Error('A cancellation reason of at least 3 characters is required.');
    }

    const result = await prisma.$transaction(async (tx) => {
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
        throw new Error('Approved bills cannot be cancelled.');
      }
      if (bill.status === 'CANCELLED') {
        throw new Error('This bill has already been cancelled.');
      }
      if (bill.status !== 'PENDING' && bill.status !== 'UNDER_REVIEW') {
        throw new Error(`Bills with status ${bill.status} cannot be cancelled.`);
      }

      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'CANCELLED',
          cancellationReason: reason.trim(),
          cancelledByAdminId: adminId,
          cancelledAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'BILL_CANCELLED',
          entityType: 'Bill',
          entityId: bill.id,
          newValue: JSON.stringify({
            invoiceNumber: bill.invoiceNumber,
            billAmount: Number(bill.billAmount),
            reason: reason.trim(),
          }),
        },
      });

      // User In-App Notification
      await tx.notification.create({
        data: {
          userId: bill.userId,
          title: 'Bill Cancelled',
          message: `Your bill (Invoice #${bill.invoiceNumber || bill.id.slice(0, 8)}) was cancelled by administrator. Reason: ${reason.trim()}`,
          type: 'BILL_REJECTED',
          metadata: {
            billId: bill.id,
            invoiceNumber: bill.invoiceNumber,
            cancellationReason: reason.trim(),
          },
          dedupeKey: `bill_cancelled_${bill.id}`,
        },
      });

      return updated;
    });

    NotificationService.dispatchPushForUser(
      result.userId,
      'Bill Cancelled',
      `Your bill (Invoice #${result.invoiceNumber || result.id.slice(0, 8)}) was cancelled by administrator. Reason: ${reason.trim()}`,
      { billId: result.id, invoiceNumber: result.invoiceNumber, cancellationReason: reason.trim() }
    ).catch((err) => console.error('[BILL-SERVICE] Push notification dispatch failed:', err.message));

    return result;
  }
}
