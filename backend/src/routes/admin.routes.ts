import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../db';
import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { StorageService } from '../services/storage.service';
import { BillStatus, Profession, UserStatus } from '@prisma/client';

const router = Router();

// Protect all admin endpoints with strict ADMIN role check
router.use(authenticate);
router.use(requireRole(['ADMIN']));

/**
 * 1. Dashboard Overview Stats
 */
router.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const totalUsers = await prisma.user.count({ where: { role: 'USER' } });
    const plumbersCount = await prisma.user.count({ where: { role: 'USER', profession: 'PLUMBER' } });
    const tilesCount = await prisma.user.count({ where: { role: 'USER', profession: 'TILE_INSTALLER' } });

    const pendingBills = await prisma.bill.count({
      where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
    });
    const approvedBillsCount = await prisma.bill.count({ where: { status: 'APPROVED' } });
    const rejectedBillsCount = await prisma.bill.count({ where: { status: 'REJECTED' } });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthBills = await prisma.bill.findMany({
      where: {
        status: 'APPROVED',
        updatedAt: { gte: startOfMonth },
      },
      select: { calculatedReward: true },
    });
    const rewardsThisMonth = monthBills.reduce((acc, b) => acc + Number(b.calculatedReward), 0);

    const pendingPayouts = await prisma.payout.count({
      where: { status: { in: ['PENDING', 'PROCESSING', 'PAYOUT_INITIATED'] } },
    });
    const successfulPayouts = await prisma.payout.count({ where: { status: 'SUCCESS' } });

    const totalRedeemedAgg = await prisma.wallet.aggregate({
      _sum: { totalRedeemed: true },
    });
    const totalRedeemed = Number(totalRedeemedAgg._sum.totalRedeemed || 0);

    const pool = await RewardService.getPoolAnalytics();

    // 10 most recent bills
    const recentBills = await prisma.bill.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, mobile: true, profession: true } },
      },
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        plumbersCount,
        tilesCount,
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
        calculatedReward: Number(b.calculatedReward),
        rewardPercentage: Number(b.rewardPercentage),
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 2. User Directory
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
 * 4. Bills Management
 */
router.get('/bills', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const profession = req.query.profession as string;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as BillStatus;
    }
    if (profession && profession !== 'ALL') {
      where.user = { profession: profession as Profession };
    }

    const bills = await prisma.bill.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, mobile: true, profession: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      bills: bills.map((b) => ({
        ...b,
        billAmount: Number(b.billAmount),
        calculatedReward: Number(b.calculatedReward),
        rewardPercentage: Number(b.rewardPercentage),
        fileUrl: StorageService.generateSignedUrl(b.fileKey, 30),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 5. Bill Verification (Approve / Reject)
 */
router.post('/bills/:id/verify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, rejectionReason, remarks } = req.body;
    const admin = req.user!;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    if (action === 'APPROVE') {
      const result = await BillService.approveBill(req.params.id, admin.id, remarks);
      res.json({
        success: true,
        message: 'Bill approved and reward credited to wallet.',
        bill: result.bill,
        rewardCredited: result.rewardCredited,
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
 * 6. Payouts Management
 */
router.get('/payouts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
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

/**
 * 7. Redemption Settings (Admin Control Window)
 */
router.get('/settings/redemption', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await prisma.redemptionSettings.findUnique({
      where: { id: 'default' },
    });

    res.json({
      success: true,
      settings: settings
        ? {
            ...settings,
            minimumAmount: Number(settings.minimumAmount),
            maximumAmount: Number(settings.maximumAmount),
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings/redemption', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = req.user!;
    const { isEnabled, startAt, endAt, minimumAmount, maximumAmount, message } = req.body;

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

    const prevSettings = await prisma.redemptionSettings.findUnique({ where: { id: 'default' } });

    const updated = await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
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
        id: 'default',
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
        entityId: 'default',
        oldValue: JSON.stringify(prevSettings),
        newValue: JSON.stringify(updated),
      },
    });

    res.json({
      success: true,
      message: 'Redemption window settings updated successfully.',
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
 * 8. Reward Rules Configuration
 */
router.get('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = await prisma.rewardRule.findMany({ where: { isActive: true } });
    const pool = await RewardService.getPoolAnalytics();

    res.json({
      success: true,
      rules: rules.map((r) => ({
        id: r.id,
        profession: r.profession,
        percentage: Number(r.percentage),
        monthlyPoolLimit: Number(r.monthlyPoolLimit),
        minRedemptionAmount: Number(r.minRedemptionAmount),
      })),
      pool,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { percentage, monthlyPoolLimit, minRedemptionAmount, profession } = req.body;
    const admin = req.user!;

    const updated = await RewardService.updateRewardRules(admin.id, {
      percentage: percentage ? parseFloat(percentage) : undefined,
      monthlyPoolLimit: monthlyPoolLimit ? parseFloat(monthlyPoolLimit) : undefined,
      minRedemptionAmount: minRedemptionAmount ? parseFloat(minRedemptionAmount) : undefined,
      profession: profession || undefined,
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: 'REWARD_RULES_UPDATED',
        entityType: 'REWARD_RULE',
        entityId: updated.id,
        newValue: JSON.stringify(updated),
      },
    });

    res.json({
      success: true,
      message: 'Reward rule settings updated successfully.',
      rule: updated,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 9. Audit Logs
 */
router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response) => {
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
