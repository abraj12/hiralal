import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../db';
import { RewardService } from '../services/reward.service';
import { RewardRuleService } from '../services/reward-rule.service';
import { GstService } from '../services/gst.service';
import { BillService } from '../services/bill.service';
import { StorageService } from '../services/storage.service';
import { PayoutService } from '../services/payout.service';
import { BillStatus, Profession, UserStatus } from '@prisma/client';

const router = Router();

// Protect all admin endpoints with strict ADMIN role check
router.use(authenticate);
router.use(requireRole(['ADMIN']));

/**
 * 1. Dashboard Overview Stats with Strict Server-Side Profession Filtering
 */
router.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const professionQuery = req.query.profession as string;
    const filterProfession = (professionQuery && professionQuery !== 'ALL') ? (professionQuery as Profession) : undefined;

    const userWhere: any = { role: 'USER' };
    if (filterProfession) userWhere.profession = filterProfession;

    const totalUsers = await prisma.user.count({ where: userWhere });
    const plumbersCount = await prisma.user.count({ where: { role: 'USER', profession: 'PLUMBER' } });
    const tilesCount = await prisma.user.count({ where: { role: 'USER', profession: 'TILE_INSTALLER' } });

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

    const pool = await RewardService.getPoolAnalytics(filterProfession);

    // 10 most recent bills
    const recentBills = await prisma.bill.findMany({
      where: billWhere,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, mobile: true, profession: true } },
      },
    });

    res.json({
      success: true,
      profession: filterProfession || 'ALL',
      stats: {
        totalUsers,
        plumbersCount: filterProfession === 'TILE_INSTALLER' ? 0 : plumbersCount,
        tilesCount: filterProfession === 'PLUMBER' ? 0 : tilesCount,
        pendingBills,
        approvedBillsCount,
        rejectedBillsCount,
        rewardsThisMonth: Math.round(rewardsThisMonth * 100) / 100,
        pendingPayouts,
        successfulPayouts,
        totalRedeemed,
        pool,
      },
      recentBills: recentBills.map((b) => ({
        ...b,
        billAmount: Number(b.billAmount),
        grossBillAmount: Number(b.grossBillAmount || b.billAmount),
        gstAmount: b.gstAmount !== null ? Number(b.gstAmount) : 0,
        gstRate: b.gstRate !== null ? Number(b.gstRate) : 0,
        eligibleRewardAmount: b.eligibleRewardAmount !== null ? Number(b.eligibleRewardAmount) : Number(b.billAmount),
        calculatedReward: Number(b.calculatedReward),
        rewardPercentage: b.rewardPercentage !== null ? Number(b.rewardPercentage) : null,
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 2. User Directory with Server-Side Profession Filtering
 */
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
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
router.get('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
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
      kyc: user.kycRecords[0] || null,
      paymentAccounts: user.paymentAccounts,
      bills: user.bills.map((b) => ({
        ...b,
        billAmount: Number(b.billAmount),
        grossBillAmount: Number(b.grossBillAmount || b.billAmount),
        gstAmount: b.gstAmount !== null ? Number(b.gstAmount) : 0,
        eligibleRewardAmount: b.eligibleRewardAmount !== null ? Number(b.eligibleRewardAmount) : Number(b.billAmount),
        calculatedReward: Number(b.calculatedReward),
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      })),
      payouts: user.payouts,
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
 * 4. Bills Management with Strict Server-Side Profession & Status Filtering
 */
router.get('/bills', async (req: AuthenticatedRequest, res: Response) => {
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
 * 5. Bill Verification (Approve / Reject with GST and Financial Snapshot)
 */
router.post('/bills/:id/verify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, rejectionReason, gstIncluded, gstRate, gstRuleId, gstOverrideReason, customRewardAmount } = req.body;
    const admin = req.user!;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    if (action === 'APPROVE') {
      const result = await BillService.approveBill(req.params.id, admin.id, {
        gstIncluded: Boolean(gstIncluded),
        gstRate: typeof gstRate === 'number' ? gstRate : undefined,
        gstRuleId: typeof gstRuleId === 'string' ? gstRuleId : undefined,
        gstOverrideReason: typeof gstOverrideReason === 'string' ? gstOverrideReason : undefined,
        customRewardAmount: typeof customRewardAmount === 'number' ? customRewardAmount : undefined,
      });

      res.json({
        success: true,
        message: 'Bill approved and reward credited to wallet.',
        bill: result.bill,
        rewardCredited: result.creditedReward,
        walletBalance: result.walletBalance,
      });
    } else {
      const updatedBill = await BillService.rejectBill(req.params.id, admin.id, rejectionReason);
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
router.get('/payouts', async (req: AuthenticatedRequest, res: Response) => {
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
        userName: p.user.fullName,
        userMobile: p.user.mobile,
        profession: p.user.profession,
        amount: Number(p.amount),
        status: p.status,
        paymentType: p.paymentType,
        maskedAccount: p.paymentAccount.maskedInfo,
        bankName: p.paymentAccount.bankName,
        razorpayPayoutId: p.razorpayPayoutId,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payouts/:id/action', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, reason } = req.body;
    const { id } = req.params;

    if (action === 'COMPLETE') {
      const payout = await PayoutService.finalizeSuccess(id);
      return res.json({ success: true, message: 'Payout marked as complete.', payout });
    } else if (action === 'FAIL') {
      const payout = await PayoutService.reversePayout(id, reason || 'Admin manual rejection');
      return res.json({ success: true, message: 'Payout marked as failed and reversed.', payout });
    }

    return res.status(400).json({ success: false, message: 'Invalid action. Must be COMPLETE or FAIL.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 7. Redemption Settings (Profession-Specific Windows)
 */
router.get('/settings/redemption', async (req: AuthenticatedRequest, res: Response) => {
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

router.put('/settings/redemption', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { isEnabled, startAt, endAt, minimumAmount, maximumAmount, message, profession } = req.body;

    const startDate = startAt ? new Date(startAt) : null;
    const endDate = endAt ? new Date(endAt) : null;

    if (startDate && endDate && endDate <= startDate) {
      return res.status(400).json({ success: false, message: 'End date and time must be after the start date.' });
    }

    const minAmt = minimumAmount !== undefined ? parseFloat(minimumAmount) : 500;
    const maxAmt = maximumAmount !== undefined ? parseFloat(maximumAmount) : 10000;

    if (minAmt <= 0 || maxAmt < minAmt) {
      return res.status(400).json({ success: false, message: 'Maximum redemption must be greater than or equal to minimum amount.' });
    }

    const prof: Profession | null = profession && profession !== 'ALL' ? (profession as Profession) : null;
    const settingId = prof ? `setting_${prof}` : 'default';

    const prevSettings = await prisma.redemptionSettings.findUnique({
      where: prof ? { profession: prof } : { id: settingId },
    });

    const updated = await prisma.redemptionSettings.upsert({
      where: prof ? { profession: prof } : { id: settingId },
      update: {
        isEnabled: Boolean(isEnabled),
        startAt: startDate,
        endAt: endDate,
        minimumAmount: minAmt,
        maximumAmount: maxAmt,
        message: message || 'Rewards redemption window is open for verified craftsmen.',
        updatedByAdminId: admin.id,
      },
      create: {
        id: settingId,
        profession: prof,
        isEnabled: Boolean(isEnabled),
        startAt: startDate,
        endAt: endDate,
        minimumAmount: minAmt,
        maximumAmount: maxAmt,
        message: message || 'Rewards redemption window is open for verified craftsmen.',
        updatedByAdminId: admin.id,
      },
    });

    // Immutable Audit Log
    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: 'REDEMPTION_SETTINGS_UPDATED',
        entityType: 'REDEMPTION_SETTINGS',
        entityId: updated.id,
        oldValue: JSON.stringify(prevSettings),
        newValue: JSON.stringify(updated),
      },
    });

    res.json({
      success: true,
      message: `Redemption window settings for ${prof || 'ALL'} updated successfully.`,
      settings: {
        ...updated,
        minimumAmount: Number(updated.minimumAmount),
        maximumAmount: Number(updated.maximumAmount),
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 8. Dynamic Reward Rules Configuration (Profession-Specific & Versioned)
 */
router.get('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profession = req.query.profession as string;
    const prof = (profession && profession !== 'ALL') ? (profession as Profession) : undefined;

    const rules = await RewardRuleService.listRules(prof);
    const pool = await RewardService.getPoolAnalytics(prof);

    res.json({
      success: true,
      rules: rules.map((r: any) => ({
        id: r.id,
        profession: r.profession,
        version: r.version,
        rewardPercentage: Number(r.rewardPercentage),
        percentage: Number(r.rewardPercentage),
        monthlyPoolLimit: Number(r.monthlyPoolLimit),
        minRedemptionAmount: Number(r.minRedemptionAmount),
        maxRedemptionAmount: Number(r.maxRedemptionAmount),
        effectiveFrom: r.effectiveFrom,
        effectiveUntil: r.effectiveUntil,
        isActive: r.isActive,
      })),
      pool,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { profession, rewardPercentage, monthlyPoolLimit, minRedemptionAmount, maxRedemptionAmount, effectiveFrom, effectiveUntil } = req.body;

    if (!profession || !['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Valid profession (PLUMBER or TILE_INSTALLER) is required.' });
    }

    const created = await RewardRuleService.createRule(admin.id, {
      profession: profession as Profession,
      rewardPercentage: parseFloat(rewardPercentage),
      monthlyPoolLimit: parseFloat(monthlyPoolLimit),
      minRedemptionAmount: minRedemptionAmount ? parseFloat(minRedemptionAmount) : undefined,
      maxRedemptionAmount: maxRedemptionAmount ? parseFloat(maxRedemptionAmount) : undefined,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveUntil: effectiveUntil ? new Date(effectiveUntil) : null,
    });

    res.status(201).json({
      success: true,
      message: `New versioned rule (v${created.version}) created for ${profession}.`,
      rule: created,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { percentage, monthlyPoolLimit, minRedemptionAmount, profession } = req.body;
    const admin = req.user!;

    const prof = profession as Profession || 'PLUMBER';
    const updated = await RewardService.updateRewardRules(admin.id, {
      percentage: percentage ? parseFloat(percentage) : undefined,
      monthlyPoolLimit: monthlyPoolLimit ? parseFloat(monthlyPoolLimit) : undefined,
      minRedemptionAmount: minRedemptionAmount ? parseFloat(minRedemptionAmount) : undefined,
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
router.get('/settings/gst-rules', async (_req: AuthenticatedRequest, res: Response) => {
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

router.post('/settings/gst-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { ratePercentage, description, isDefault } = req.body;

    const rule = await GstService.createGstRule(admin.id, {
      ratePercentage: parseFloat(ratePercentage),
      description,
      isDefault: Boolean(isDefault),
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

router.patch('/settings/gst-rules/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { description, isDefault, isActive } = req.body;

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

/**
 * 10. Audit Logs
 */
router.get('/audit-logs', async (_req: AuthenticatedRequest, res: Response) => {
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

export default router;
