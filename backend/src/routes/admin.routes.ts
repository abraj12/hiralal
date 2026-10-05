import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { dbStore, AuditLogRecord } from '../db/store';
import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';

const router = Router();

// Protect all admin routes
router.use(authenticate);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// 1. Dashboard Overview
router.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = Array.from(dbStore.users.values()).filter(u => u.role === 'USER');
    const bills = Array.from(dbStore.bills.values());
    const payouts = Array.from(dbStore.payouts.values());

    const pendingBills = bills.filter(b => b.status === 'PENDING' || b.status === 'UNDER_REVIEW');
    const pendingPayouts = payouts.filter(p => p.status === 'PENDING' || p.status === 'PROCESSING');

    // Rewards this month
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const thisMonthApproved = bills.filter(
      b =>
        b.status === 'APPROVED' &&
        b.createdAt.getMonth() === currentMonth &&
        b.createdAt.getFullYear() === currentYear
    );
    const rewardsThisMonth = thisMonthApproved.reduce((acc, b) => acc + b.calculatedReward, 0);

    const pool = RewardService.getPoolAnalytics();

    // Recent 10 bills
    const recentBills = BillService.getAllBills('ALL').slice(0, 10);

    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        plumbersCount: users.filter(u => u.profession === 'PLUMBER').length,
        tilesCount: users.filter(u => u.profession === 'TILE_INSTALLER').length,
        pendingBills: pendingBills.length,
        rewardsThisMonth: Math.round(rewardsThisMonth * 100) / 100,
        pendingPayouts: pendingPayouts.length,
        pool,
      },
      recentBills,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. User Management
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profession = (req.query.profession as string) || 'ALL';
    const status = (req.query.status as string) || 'ALL';
    const search = ((req.query.search as string) || '').toLowerCase();

    let users = Array.from(dbStore.users.values()).filter(u => u.role === 'USER');

    if (profession !== 'ALL') {
      users = users.filter(u => u.profession === profession);
    }

    if (status !== 'ALL') {
      users = users.filter(u => u.status === status);
    }

    if (search) {
      users = users.filter(
        u => u.fullName.toLowerCase().includes(search) || u.mobile.includes(search)
      );
    }

    const result = users.map(u => {
      const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === u.id);
      const kyc = Array.from(dbStore.kycRecords.values()).find(k => k.userId === u.id);
      const payment = Array.from(dbStore.paymentAccounts.values()).find(p => p.userId === u.id && p.isDefault);
      const billsCount = Array.from(dbStore.bills.values()).filter(b => b.userId === u.id).length;

      return {
        id: u.id,
        fullName: u.fullName,
        mobile: u.mobile,
        profession: u.profession,
        status: u.status,
        createdAt: u.createdAt,
        walletBalance: wallet ? wallet.availableBalance : 0,
        panStatus: kyc ? kyc.panStatus : 'PENDING',
        paymentStatus: payment ? (payment.isVerified ? 'VERIFIED' : 'PENDING') : 'NOT_ADDED',
        billsCount,
      };
    });

    res.json({ success: true, users: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. User Details
router.get('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = dbStore.users.get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);
    const kyc = Array.from(dbStore.kycRecords.values()).find(k => k.userId === user.id);
    const paymentAccounts = Array.from(dbStore.paymentAccounts.values()).filter(p => p.userId === user.id);
    const bills = BillService.getUserBills(user.id);
    const payouts = PayoutService.getUserPayouts(user.id);
    const ledger = Array.from(dbStore.walletTransactions.values())
      .filter(t => t.userId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json({
      success: true,
      user,
      wallet,
      kyc,
      paymentAccounts,
      bills,
      payouts,
      ledger,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Bills Management
router.get('/bills', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = (req.query.status as string) || 'ALL';
    const profession = (req.query.profession as string) || 'ALL';
    const bills = BillService.getAllBills(status, profession);
    res.json({ success: true, bills });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Bill Verification (Approve / Reject)
router.post('/bills/:id/verify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, rejectionReason } = req.body;
    const admin = req.user!;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    const bill = await BillService.verifyBill(req.params.id, action, admin.id, rejectionReason);
    res.json({
      success: true,
      message: action === 'APPROVE' ? 'Bill approved and reward credited to wallet.' : 'Bill rejected.',
      bill,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 6. Payouts Management
router.get('/payouts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = (req.query.status as string) || 'ALL';
    const payouts = PayoutService.getAllPayouts(status);
    res.json({ success: true, payouts });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payouts/:id/action', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, reason } = req.body; // action: 'COMPLETE' or 'FAIL'
    const isSuccess = action === 'COMPLETE';
    const payout = await PayoutService.completePayout(req.params.id, isSuccess, reason);

    // Audit Log
    const audit: AuditLogRecord = {
      id: `audit-${Date.now()}`,
      adminId: req.user!.id,
      action: isSuccess ? 'PAYOUT_COMPLETED' : 'PAYOUT_FAILED',
      entityType: 'PAYOUT',
      entityId: payout.id,
      newValue: JSON.stringify({ status: payout.status, reason }),
      createdAt: new Date(),
    };
    dbStore.auditLogs.set(audit.id, audit);

    res.json({ success: true, payout, message: `Payout marked as ${payout.status}` });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. Settings / Reward Rules
router.get('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = RewardService.getRewardRules();
    const pool = RewardService.getPoolAnalytics();
    res.json({ success: true, rules, pool });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings/reward-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { percentage, monthlyPoolLimit, minRedemptionAmount } = req.body;
    const admin = req.user!;

    const prevRule = { ...RewardService.getRewardRules() };
    const updatedRule = RewardService.updateRewardRules(admin.id, {
      percentage: percentage ? parseFloat(percentage) : undefined,
      monthlyPoolLimit: monthlyPoolLimit ? parseFloat(monthlyPoolLimit) : undefined,
      minRedemptionAmount: minRedemptionAmount ? parseFloat(minRedemptionAmount) : undefined,
    });

    // Audit log
    const audit: AuditLogRecord = {
      id: `audit-${Date.now()}`,
      adminId: admin.id,
      action: 'REWARD_RULES_UPDATED',
      entityType: 'REWARD_RULE',
      entityId: updatedRule.id,
      oldValue: JSON.stringify(prevRule),
      newValue: JSON.stringify(updatedRule),
      createdAt: new Date(),
    };
    dbStore.auditLogs.set(audit.id, audit);

    res.json({ success: true, message: 'Reward settings updated successfully.', rules: updatedRule });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 8. Audit Logs
router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = Array.from(dbStore.auditLogs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
