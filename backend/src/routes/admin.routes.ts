import { Router, Response } from 'express';
import {
  authenticate,
  requireRole,
  requireAdmin,
  requireBillAdmin,
  requireOperationsAdmin,
  AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { prisma } from '../db';
import { RewardService } from '../services/reward.service';
import { RewardRuleService } from '../services/reward-rule.service';
import { GstService, parseStrictGstRate } from '../services/gst.service';
import { BillService } from '../services/bill.service';
import { StorageService } from '../services/storage.service';
import { PayoutService } from '../services/payout.service';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { BillStatus, Profession, UserStatus } from '@prisma/client';
import { getIstYearAndMonth, parseStrictIndiaTimestamp } from '../utils/timezone.utils';

const router = Router();

// Protect all admin endpoints with authentication
router.use(authenticate);

/**
 * 1. Dashboard Overview Stats with Strict Server-Side Profession Filtering
 */
router.get('/dashboard', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const professionQuery = req.query.profession as string;
    const filterProfession = (professionQuery && professionQuery !== 'ALL') ? (professionQuery as Profession) : undefined;

    const billWhere: any = {};
    if (filterProfession) billWhere.user = { profession: filterProfession };

    const pendingBills = await prisma.bill.count({
      where: { ...billWhere, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
    });
    const approvedBillsCount = await prisma.bill.count({ where: { ...billWhere, status: 'APPROVED' } });
    const rejectedBillsCount = await prisma.bill.count({ where: { ...billWhere, status: 'REJECTED' } });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthBills = await prisma.bill.findMany({
      where: {
        ...billWhere,
        status: 'APPROVED',
        updatedAt: { gte: startOfMonth },
      },
      select: { calculatedReward: true },
    });
    const rewardsThisMonth = monthBills.reduce((acc, b) => acc + Number(b.calculatedReward), 0);

    // 10 most recent bills
    const recentBills = await prisma.bill.findMany({
      where: billWhere,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, mobile: true, profession: true } },
      },
    });

    const mappedRecentBills = recentBills.map((b) => ({
      ...b,
      billAmount: Number(b.billAmount),
      grossBillAmount: Number(b.grossBillAmount || b.billAmount),
      gstAmount: b.gstAmount !== null ? Number(b.gstAmount) : 0,
      gstRate: b.gstRate !== null ? Number(b.gstRate) : 0,
      eligibleRewardAmount: b.eligibleRewardAmount !== null ? Number(b.eligibleRewardAmount) : Number(b.billAmount),
      calculatedReward: Number(b.calculatedReward),
      rewardPercentage: b.rewardPercentage !== null ? Number(b.rewardPercentage) : null,
      fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
    }));

    // Strict Role Separation: BILL_ADMIN sees only bill review stats and recent bills
    if (req.user?.role === 'BILL_ADMIN') {
      return res.json({
        success: true,
        profession: filterProfession || 'ALL',
        stats: {
          pendingBills,
          approvedBillsCount,
          rejectedBillsCount,
          rewardsThisMonth: Math.round(rewardsThisMonth * 100) / 100,
        },
        recentBills: mappedRecentBills,
      });
    }

    // OPERATIONS_ADMIN (and other authorized roles) see full operational metrics
    const userWhere: any = { role: 'USER' };
    if (filterProfession) userWhere.profession = filterProfession;

    const totalUsers = await prisma.user.count({ where: userWhere });
    const plumbersCount = await prisma.user.count({ where: { role: 'USER', profession: 'PLUMBER' } });
    const tilesCount = await prisma.user.count({ where: { role: 'USER', profession: 'TILE_INSTALLER' } });
    const kycVerifiedCount = await prisma.user.count({
      where: {
        ...userWhere,
        kycRecords: { some: { panStatus: 'VERIFIED' } },
      },
    });

    const payoutWhere: any = {};
    if (filterProfession) payoutWhere.user = { profession: filterProfession };

    const pendingPayouts = await prisma.payout.count({
      where: { ...payoutWhere, status: { in: ['PENDING', 'PROCESSING', 'PAYOUT_INITIATED'] } },
    });
    const successfulPayouts = await prisma.payout.count({ where: { ...payoutWhere, status: 'SUCCESS' } });

    const redeemedBills = await prisma.payout.aggregate({
      where: { ...payoutWhere, status: 'SUCCESS' },
      _sum: { amount: true },
    });
    const totalRedeemed = Number(redeemedBills._sum.amount || 0);

    const pendingPayoutAgg = await prisma.payout.aggregate({
      where: { ...payoutWhere, status: { in: ['PENDING', 'PROCESSING', 'PAYOUT_INITIATED'] } },
      _sum: { amount: true },
    });
    const pendingPayoutAmount = Number(pendingPayoutAgg._sum.amount || 0);

    const failedPayouts = await prisma.payout.count({
      where: { ...payoutWhere, status: { in: ['FAILED', 'REVERSED'] } },
    });
    const failedPayoutAgg = await prisma.payout.aggregate({
      where: { ...payoutWhere, status: { in: ['FAILED', 'REVERSED'] } },
      _sum: { amount: true },
    });
    const failedPayoutAmount = Number(failedPayoutAgg._sum.amount || 0);

    const walletLiabilityAgg = await prisma.wallet.aggregate({
      _sum: { availableBalance: true, processingAmount: true },
    });
    const availableWalletLiability = Number(walletLiabilityAgg._sum.availableBalance || 0);
    const reservedWalletLiability = Number(walletLiabilityAgg._sum.processingAmount || 0);

    const totalRewardsCreditedAgg = await prisma.walletTransaction.aggregate({
      where: { type: 'REWARD_CREDIT' },
      _sum: { amount: true },
    });
    const totalRewardsCredited = Number(totalRewardsCreditedAgg._sum.amount || 0);

    const { year: istYear, month: istMonth } = getIstYearAndMonth();
    const istStartOfMonth = new Date(`${istYear}-${String(istMonth).padStart(2, '0')}-01T00:00:00+05:30`);

    const monthlyRewardCredits = await prisma.walletTransaction.findMany({
      where: {
        type: 'REWARD_CREDIT',
        createdAt: { gte: istStartOfMonth },
      },
      select: {
        amount: true,
        wallet: {
          select: {
            user: {
              select: {
                profession: true,
              },
            },
          },
        },
      },
    });

    let plumberTotal = 0;
    let plumberCount = 0;
    let tileTotal = 0;
    let tileCount = 0;

    for (const tx of monthlyRewardCredits) {
      const prof = tx.wallet?.user?.profession;
      const amt = Number(tx.amount || 0);
      if (prof === 'PLUMBER') {
        plumberTotal += amt;
        plumberCount += 1;
      } else if (prof === 'TILE_INSTALLER') {
        tileTotal += amt;
        tileCount += 1;
      }
    }

    const programTotals = {
      PLUMBER: {
        totalAllocated: Math.round(plumberTotal * 100) / 100,
        count: plumberCount,
        averageReward: plumberCount > 0 ? Math.round((plumberTotal / plumberCount) * 100) / 100 : 0,
      },
      TILE_INSTALLER: {
        totalAllocated: Math.round(tileTotal * 100) / 100,
        count: tileCount,
        averageReward: tileCount > 0 ? Math.round((tileTotal / tileCount) * 100) / 100 : 0,
      },
    };

    res.json({
      success: true,
      profession: filterProfession || 'ALL',
      stats: {
        totalUsers,
        plumbersCount: filterProfession === 'TILE_INSTALLER' ? 0 : plumbersCount,
        tilesCount: filterProfession === 'PLUMBER' ? 0 : tilesCount,
        kycVerifiedCount,
        pendingBills,
        approvedBillsCount,
        rejectedBillsCount,
        rewardsThisMonth: Math.round(rewardsThisMonth * 100) / 100,
        totalRewardsCredited: Math.round(totalRewardsCredited * 100) / 100,
        availableWalletLiability: Math.round(availableWalletLiability * 100) / 100,
        reservedWalletLiability: Math.round(reservedWalletLiability * 100) / 100,
        pendingPayouts,
        pendingPayoutAmount: Math.round(pendingPayoutAmount * 100) / 100,
        successfulPayouts,
        totalRedeemed: Math.round(totalRedeemed * 100) / 100,
        failedPayouts,
        failedPayoutAmount: Math.round(failedPayoutAmount * 100) / 100,
        programTotals,
      },
      recentBills: mappedRecentBills,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 2. User Directory with Server-Side Profession Filtering
 */
router.get('/users', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profession = req.query.profession as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const where: any = { role: 'USER' };
    if (profession && profession !== 'ALL') {
      where.profession = profession as Profession;
    }
    if (status && status !== 'ALL') {
      where.status = status as UserStatus;
    }
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        wallet: true,
        kycRecords: { orderBy: { createdAt: 'desc' }, take: 1 },
        paymentAccounts: { where: { isDefault: true }, take: 1 },
        _count: { select: { bills: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = users.map((u) => {
      const kyc = u.kycRecords[0] || null;
      const payment = u.paymentAccounts[0] || null;

      return {
        id: u.id,
        fullName: u.fullName,
        mobile: u.mobile,
        profession: u.profession,
        status: u.status,
        createdAt: u.createdAt,
        walletBalance: u.wallet ? Number(u.wallet.availableBalance) : 0,
        panStatus: kyc ? kyc.panStatus : 'PENDING',
        paymentStatus: payment ? (payment.isVerified ? 'VERIFIED' : 'PENDING') : 'NOT_ADDED',
        billsCount: u._count.bills,
      };
    });

    res.json({ success: true, users: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 3. User Details
 */
router.get('/users/:id', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: true,
        kycRecords: { orderBy: { createdAt: 'desc' } },
        paymentAccounts: { orderBy: { createdAt: 'desc' } },
        bills: { orderBy: { createdAt: 'desc' } },
        payouts: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const ledger = await prisma.walletTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        mobile: user.mobile,
        profession: user.profession,
        status: user.status,
        createdAt: user.createdAt,
      },
      wallet: user.wallet
        ? {
            availableBalance: Number(user.wallet.availableBalance),
            processingAmount: Number(user.wallet.processingAmount),
            totalRedeemed: Number(user.wallet.totalRedeemed),
          }
        : null,
      kyc: user.kycRecords[0]
        ? {
            id: user.kycRecords[0].id,
            panName: user.kycRecords[0].panName,
            panStatus: user.kycRecords[0].panStatus,
            maskedPan: user.kycRecords[0].maskedPan,
            provider: user.kycRecords[0].provider,
            verifiedAt: user.kycRecords[0].verifiedAt,
            rejectionReason: user.kycRecords[0].rejectionReason,
            createdAt: user.kycRecords[0].createdAt,
          }
        : null,
      paymentAccounts: user.paymentAccounts.map((p) => ({
        id: p.id,
        accountType: p.accountType,
        accountHolderName: p.accountHolderName,
        maskedInfo: p.maskedInfo,
        ifscCode: p.ifscCode,
        bankName: p.bankName,
        isVerified: p.isVerified,
        verifiedAt: p.verifiedAt,
        isDefault: p.isDefault,
        createdAt: p.createdAt,
      })),
      bills: user.bills.map((b) => ({
        ...b,
        billAmount: Number(b.billAmount),
        grossBillAmount: Number(b.grossBillAmount || b.billAmount),
        gstAmount: b.gstAmount !== null ? Number(b.gstAmount) : 0,
        eligibleRewardAmount: b.eligibleRewardAmount !== null ? Number(b.eligibleRewardAmount) : Number(b.billAmount),
        calculatedReward: Number(b.calculatedReward),
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      })),
      payouts: user.payouts.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentType: p.paymentType,
        status: p.status,
        failureReason: p.failureReason,
        initiatedAt: p.initiatedAt,
        completedAt: p.completedAt,
        createdAt: p.createdAt,
      })),
      ledger: ledger.map((l) => ({
        ...l,
        amount: Number(l.amount),
        balanceAfter: Number(l.balanceAfter),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 3b. Admin Privileged Name Correction for Users (Audited)
 */
router.put('/users/:id/name', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { firstName, middleName, lastName, fullName, reason } = req.body;
    const ipAddress = req.ip || req.socket.remoteAddress;

    const updatedUser = await AuthService.adminUpdateUserName({
      userId: req.params.id,
      adminId: admin.id,
      firstName,
      middleName,
      lastName,
      fullName,
      reason,
      ipAddress,
    });

    res.json({
      success: true,
      message: 'User name corrected successfully. Re-verification policy has been enforced.',
      user: updatedUser,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 4. Bills Management with Strict Server-Side Profession & Status Filtering
 */
router.get('/bills', requireBillAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const profession = req.query.profession as string;
    const search = req.query.search as string;

    const bills = await BillService.getAdminBills({
      profession: (profession && profession !== 'ALL') ? (profession as Profession) : 'ALL',
      status: (status && status !== 'ALL') ? (status as BillStatus) : 'ALL',
      search,
    });

    res.json({
      success: true,
      bills,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 4.1 Fresh Signed Document URL for Bill Inspection (Admin Only)
 */
router.get('/bills/:id/document-url', requireBillAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const bill = await prisma.bill.findUnique({
      where: { id },
      select: {
        id: true,
        fileKey: true,
        mimeType: true,
        invoiceNumber: true,
        status: true,
      },
    });

    if (!bill) {
      return res.status(404).json({ success: false, code: 'BILL_NOT_FOUND', message: 'Bill not found.' });
    }

    if (!bill.fileKey) {
      return res.status(404).json({ success: false, code: 'DOCUMENT_NOT_FOUND', message: 'No document file associated with this bill.' });
    }

    const documentUrl = await StorageService.getSignedInvoiceUrl(bill.fileKey, 1800);
    res.json({
      success: true,
      documentUrl,
      mimeType: bill.mimeType,
      fileType: bill.mimeType,
      expiresIn: 1800,
    });
  } catch (err: any) {
    console.error(`[STORAGE-ERROR] Failed to generate signed URL for bill ${req.params.id}: ${err.message}`);
    res.status(500).json({ success: false, message: 'Could not generate document access URL. Please retry.' });
  }
});

/**
 * 4.2 Read-only, bill-specific rules for invoice review.
 * Bill Admin may read the applicable rules but cannot change settings.
 */
router.get(
  '/bills/:id/review-config',
  requireBillAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const bill = await prisma.bill.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          invoiceDate: true,
          createdAt: true,
          status: true,
          user: {
            select: {
              profession: true,
            },
          },
        },
      });

      if (!bill) {
        return res.status(404).json({
          success: false,
          code: 'BILL_NOT_FOUND',
          message: 'Bill not found.',
        });
      }

      if (!bill.user || !bill.user.profession) {
        return res.status(409).json({
          success: false,
          code: 'PROFESSION_NOT_CONFIGURED',
          message: 'The worker profession is unavailable.',
        });
      }

      // Bill approval resolves reward and GST rules based on server-recorded submission timestamp (Bill.createdAt).
      // Review-config endpoint must use the exact same authoritative timestamp to prevent UI rule discrepancy.
      const submissionTimestamp = bill.createdAt || new Date();

      const rewardRule = await RewardRuleService.getApplicableRule(
        bill.user.profession,
        submissionTimestamp
      );

      const gstRules = await GstService.getApplicableGstRules(submissionTimestamp, prisma);

      return res.json({
        success: true,
        billId: bill.id,
        invoiceDate: bill.invoiceDate,
        submissionTimestamp: bill.createdAt,
        profession: bill.user.profession,
        rewardRule: {
          id: rewardRule.id,
          profession: rewardRule.profession,
          version: rewardRule.version,
          rewardPercentage: Number(rewardRule.rewardPercentage),
          effectiveFrom: rewardRule.effectiveFrom,
          effectiveUntil: rewardRule.effectiveUntil,
        },
        gstRules: gstRules.map((rule) => ({
          ...rule,
          ratePercentage: Number(rule.ratePercentage),
        })),
      });
    } catch (error: any) {
      // Log a sanitized error internally; never expose DB internals.
      console.error(`[ADMIN-BILL-REVIEW-CONFIG] Failed to load review configuration for bill ${req.params.id}: ${error.message}`);

      return res.status(503).json({
        success: false,
        code: 'REVIEW_CONFIG_UNAVAILABLE',
        message: 'Bill review configuration is temporarily unavailable.',
      });
    }
  }
);

/**
 * 5. Bill Verification (Approve / Reject with GST and Financial Snapshot)
 */
router.post('/bills/:id/verify', requireBillAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, rejectionReason, gstIncluded, gstRate, gstRuleId, gstOverrideReason } = req.body;
    const admin = req.user!;

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'customRewardAmount')) {
      return res.status(400).json({
        success: false,
        message: 'Custom reward overrides are not permitted. Rewards are calculated using the applicable system rules.',
      });
    }

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    if (action === 'APPROVE') {
      if (typeof gstIncluded !== 'boolean') {
        return res.status(400).json({
          success: false,
          code: 'GST_SELECTION_REQUIRED',
          message: 'Select whether GST is included in this bill. GST selection must be a boolean.',
        });
      }

      if (gstIncluded) {
        if (!gstRuleId || typeof gstRuleId !== 'string' || !gstRuleId.trim()) {
          return res.status(400).json({
            success: false,
            code: 'GST_RULE_REQUIRED',
            message: 'A valid configured GST rule must be selected when GST is included. Bill Review Administrators cannot manually override GST rates; rates are determined strictly by Operations Administrator rules.',
          });
        }
      }

      const result = await BillService.approveBill(req.params.id, admin.id, {
        gstIncluded,
        gstRate: gstIncluded ? (typeof gstRate === 'number' ? gstRate : undefined) : 0,
        gstRuleId: gstIncluded ? (typeof gstRuleId === 'string' && gstRuleId.trim() ? gstRuleId.trim() : undefined) : undefined,
        gstOverrideReason: gstIncluded && typeof gstOverrideReason === 'string' ? gstOverrideReason.trim() : undefined,
      });

      res.json({
        success: true,
        message: 'Bill approved and reward credited to wallet.',
        bill: result.bill,
        rewardCredited: result.creditedReward,
        walletBalance: result.walletBalance,
      });
    } else {
      if (!rejectionReason || typeof rejectionReason !== 'string' || !rejectionReason.trim()) {
        return res.status(400).json({
          success: false,
          message: 'A rejection reason is required.',
        });
      }
      const updatedBill = await BillService.rejectBill(req.params.id, admin.id, rejectionReason.trim());
      res.json({
        success: true,
        message: 'Bill rejected.',
        bill: updatedBill,
      });
    }
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 6. Payouts Management with Strict Server-Side Profession Filtering
 */
router.get('/payouts', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const profession = req.query.profession as string;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (profession && profession !== 'ALL') {
      where.user = { profession: profession as Profession };
    }

    const payouts = await prisma.payout.findMany({
      where,
      include: {
        user: { select: { fullName: true, mobile: true, profession: true } },
        paymentAccount: { select: { accountType: true, maskedInfo: true, bankName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      payouts: payouts.map((p) => ({
        id: p.id,
        userName: p.user?.fullName || 'Craftsman',
        userMobile: p.user?.mobile || '',
        profession: p.user?.profession || '',
        user: {
          fullName: p.user?.fullName || 'Craftsman',
          mobile: p.user?.mobile || '',
          profession: p.user?.profession || '',
        },
        amount: Number(p.amount),
        status: p.status,
        paymentType: p.paymentType,
        accountType: p.paymentAccount?.accountType || p.paymentType,
        maskedAccount: p.paymentAccount?.maskedInfo || '',
        accountNumber: p.paymentAccount?.maskedInfo || '',
        upiId: p.paymentAccount?.maskedInfo || '',
        bankName: p.paymentAccount?.bankName || null,
        razorpayPayoutId: p.razorpayPayoutId,
        requiresManualReview: p.requiresManualReview,
        manualReviewReason: p.manualReviewReason,
        failureReason: p.failureReason,
        adminRejectionReason: p.adminRejectionReason,
        approvedByAdminId: p.approvedByAdminId,
        approvedAt: p.approvedAt,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payouts/:id/action', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, reason } = req.body;
    const { id } = req.params;
    const admin = req.user!;

    if (action === 'APPROVE') {
      const payout = await PayoutService.approveRedemption(id, admin.id);
      return res.json({ success: true, message: 'Payout approved and queued for disbursement.', payout });
    } else if (action === 'REJECT') {
      if (!reason || !reason.trim()) {
        return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      }
      const payout = await PayoutService.rejectRedemption(id, admin.id, reason.trim());
      return res.json({ success: true, message: 'Payout rejected and refunded to user.', payout });
    }

    return res.status(400).json({ success: false, message: 'Invalid action. Must be APPROVE or REJECT.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 7. Redemption Settings (Profession-Specific Windows)
 */
router.get('/settings/redemption', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profession = req.query.profession as string;
    const prof = (profession && profession !== 'ALL') ? (profession as Profession) : undefined;

    const result = await PayoutService.getRedemptionSettings(prof);

    res.json({
      success: true,
      settings: result.settings,
      isWindowOpen: result.isWindowOpen,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings/redemption', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { isEnabled, startAt, endAt, message, profession, minimumRedemptionAmount } = req.body;

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    try {
      if (startAt !== undefined && startAt !== null && startAt !== '') {
        startDate = parseStrictIndiaTimestamp(String(startAt));
      }
    } catch (err: any) {
      return res.status(400).json({ success: false, message: `Invalid start time: ${err.message}` });
    }

    try {
      if (endAt !== undefined && endAt !== null && endAt !== '') {
        endDate = parseStrictIndiaTimestamp(String(endAt));
      }
    } catch (err: any) {
      return res.status(400).json({ success: false, message: `Invalid end time: ${err.message}` });
    }

    if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
      return res.status(400).json({ success: false, message: 'End date and time must be after the start date.' });
    }

    let minRedemption: number | null | undefined = undefined;
    if (minimumRedemptionAmount !== undefined) {
      if (minimumRedemptionAmount === null || minimumRedemptionAmount === '') {
        minRedemption = null;
      } else {
        const parsed =
          typeof minimumRedemptionAmount === 'number'
            ? minimumRedemptionAmount
            : parseFloat(String(minimumRedemptionAmount));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Minimum redemption amount must be a valid positive number.',
          });
        }
        minRedemption = Math.round(parsed * 100) / 100;
      }
    }

    // Server-side validation for enabling redemption:
    // Requires positive finite minimum amount, valid start timestamp, valid end timestamp, and endAt > startAt
    if (Boolean(isEnabled)) {
      if (!startDate) {
        return res.status(400).json({
          success: false,
          message: 'An opening timestamp (startAt) is required to enable redemption.',
        });
      }
      if (!endDate) {
        return res.status(400).json({
          success: false,
          message: 'A closing timestamp (endAt) is required to enable redemption.',
        });
      }
      if (endDate.getTime() <= startDate.getTime()) {
        return res.status(400).json({
          success: false,
          message: 'End date and time must be after the start date.',
        });
      }
      if (minRedemption === null || minRedemption === undefined || minRedemption <= 0) {
        return res.status(400).json({
          success: false,
          message: 'A positive minimum redemption threshold is required to enable redemption.',
        });
      }
    } else if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
      return res.status(400).json({
        success: false,
        message: 'End date and time must be after the start date.',
      });
    }

    const prof: Profession | null = profession && profession !== 'ALL' ? (profession as Profession) : null;
    const settingId = prof ? `setting_${prof}` : 'default';

    const updated = await prisma.$transaction(async (tx) => {
      const prevSettings = await tx.redemptionSettings.findUnique({
        where: prof ? { profession: prof } : { id: settingId },
      });

      const saved = await tx.redemptionSettings.upsert({
        where: prof ? { profession: prof } : { id: settingId },
        update: {
          isEnabled: Boolean(isEnabled),
          startAt: startDate,
          endAt: endDate,
          ...(minRedemption !== undefined && { minimumRedemptionAmount: minRedemption }),
          message: message || (Boolean(isEnabled) ? 'Rewards redemption window is open for verified craftsmen.' : 'Rewards redemption is currently unavailable.'),
          updatedByAdminId: admin.id,
        },
        create: {
          id: settingId,
          profession: prof,
          isEnabled: Boolean(isEnabled),
          startAt: startDate,
          endAt: endDate,
          minimumRedemptionAmount: minRedemption !== undefined ? minRedemption : null,
          message: message || (Boolean(isEnabled) ? 'Rewards redemption window is open for verified craftsmen.' : 'Rewards redemption is currently unavailable.'),
          updatedByAdminId: admin.id,
        },
      });

      // Immutable Audit Log
      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          action: 'REDEMPTION_SETTINGS_UPDATED',
          entityType: 'REDEMPTION_SETTINGS',
          entityId: saved.id,
          oldValue: JSON.stringify(prevSettings),
          newValue: JSON.stringify(saved),
        },
      });

      return saved;
    });

    res.json({
      success: true,
      message: `Redemption window settings for ${prof || 'ALL'} updated successfully.`,
      settings: updated,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 8. Dynamic Reward Rules Configuration (Profession-Specific & Versioned)
 */
router.get('/settings/reward-rules', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profession = req.query.profession as string;
    const prof = (profession && profession !== 'ALL') ? (profession as Profession) : undefined;

    const rules = await RewardRuleService.listRules(prof);

    res.json({
      success: true,
      rules: rules.map((r: any) => ({
        id: r.id,
        profession: r.profession,
        version: r.version,
        rewardPercentage: Number(r.rewardPercentage),
        percentage: Number(r.rewardPercentage),
        effectiveFrom: r.effectiveFrom,
        effectiveUntil: r.effectiveUntil,
        isActive: r.isActive,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/settings/reward-rules', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { profession, rewardPercentage, effectiveFrom, effectiveUntil } = req.body;

    if (!profession || !['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Valid profession (PLUMBER or TILE_INSTALLER) is required.' });
    }

    const pct = typeof rewardPercentage === 'number' ? rewardPercentage : parseFloat(rewardPercentage);
    if (!Number.isFinite(pct) || Number.isNaN(pct)) {
      return res.status(400).json({ success: false, message: 'Reward percentage must be a valid, finite number.' });
    }

    const created = await RewardRuleService.createRule(admin.id, {
      profession: profession as Profession,
      rewardPercentage: pct,
      effectiveFrom: effectiveFrom !== undefined && effectiveFrom !== null && effectiveFrom !== '' ? effectiveFrom : undefined,
      effectiveUntil: effectiveUntil !== undefined && effectiveUntil !== null && effectiveUntil !== '' ? effectiveUntil : null,
    });

    res.status(201).json({
      success: true,
      message: `New versioned rule (v${created.version}) created for ${profession}.`,
      rule: {
        id: created.id,
        profession: created.profession,
        version: created.version,
        rewardPercentage: Number(created.rewardPercentage),
        effectiveFrom: created.effectiveFrom,
        effectiveUntil: created.effectiveUntil,
        isActive: created.isActive,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/settings/reward-rules', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { percentage, profession } = req.body;
    const admin = req.user!;

    if (percentage === undefined || percentage === null || isNaN(parseFloat(percentage))) {
      return res.status(400).json({ success: false, message: 'Explicit reward percentage is required.' });
    }
    if (!profession || !['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Explicit profession (PLUMBER or TILE_INSTALLER) is required.' });
    }

    const prof = profession as Profession;
    const updated = await RewardService.updateRewardRules(admin.id, {
      percentage: parseFloat(percentage),
      profession: prof,
    });

    res.json({
      success: true,
      message: `Reward rule for ${prof} updated successfully.`,
      rule: updated,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 9. GST Rates Configuration
 */
router.get('/settings/gst-rules', requireOperationsAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = await GstService.getActiveGstRules();
    res.json({
      success: true,
      rules: rules.map((r: any) => ({
        id: r.id,
        ratePercentage: Number(r.ratePercentage),
        description: r.description,
        isDefault: r.isDefault,
        isActive: r.isActive,
        effectiveFrom: r.effectiveFrom,
        effectiveUntil: r.effectiveUntil,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/settings/gst-rules', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { ratePercentage, description, isDefault } = req.body;

    let validatedRate: number;
    try {
      validatedRate = parseStrictGstRate(ratePercentage);
    } catch (parseErr: any) {
      return res.status(400).json({
        success: false,
        message: `Invalid GST rate percentage: ${parseErr.message}`,
      });
    }

    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isDefault must be a boolean.',
      });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'GST rule description must be a string.',
      });
    }

    const rule = await GstService.createGstRule(admin.id, {
      ratePercentage: validatedRate,
      description,
      isDefault,
    });

    res.status(201).json({
      success: true,
      message: 'GST rate created successfully.',
      rule,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.patch('/settings/gst-rules/:id', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { description, isDefault, isActive } = req.body;

    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isDefault must be a boolean.',
      });
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean.',
      });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'GST rule description must be a string.',
      });
    }

    const updated = await GstService.updateGstRule(admin.id, req.params.id, {
      description,
      isDefault,
      isActive,
    });

    res.json({
      success: true,
      message: 'GST rate updated successfully.',
      rule: updated,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/audit-logs', requireOperationsAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        admin: { select: { fullName: true, mobile: true } },
      },
    });

    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// NOTIFICATIONS MANAGEMENT (OPERATIONS_ADMIN)
// ==========================================

/**
 * POST /api/admin/notifications/broadcast
 * Broadcasts an announcement or alert to craftsmen/workers.
 * Restricted to OPERATIONS_ADMIN only (BILL_ADMIN gets 403).
 */
router.post('/notifications/broadcast', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.user!.id;
    const { title, message, targetAudience, idempotencyKey, metadata } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const campaign = await NotificationService.broadcastToWorkers(adminId, {
      title,
      message,
      targetAudience,
      idempotencyKey,
      metadata,
    });

    res.status(201).json({
      success: true,
      message: `Notification broadcast dispatched to ${campaign.recipientCount} workers.`,
      campaign,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/notifications/users/:userId
 * Sends a direct message or notification to a specific user.
 * Restricted to OPERATIONS_ADMIN only.
 */
router.post('/notifications/users/:userId', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.user!.id;
    const targetUserId = req.params.userId;
    const { title, message, metadata } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const notification = await NotificationService.sendDirectNotification(adminId, targetUserId, {
      title,
      message,
      metadata,
    });

    res.status(201).json({
      success: true,
      message: 'Direct notification dispatched successfully.',
      notification,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/notifications/history
 * Retrieves broadcast campaign history and recipient metrics.
 * Restricted to OPERATIONS_ADMIN only.
 */
router.get('/notifications/history', requireOperationsAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const history = await NotificationService.getCampaignHistory({ page, limit });
    res.json({ success: true, ...history });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
