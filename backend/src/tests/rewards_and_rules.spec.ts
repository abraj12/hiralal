import { RewardService } from '../services/reward.service';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { KycService } from '../services/kyc.service';
import { PaymentService } from '../services/payment.service';
import { AuthService } from '../services/auth.service';
import { dbStore } from '../db/store';

describe('Hiralal & Sons Rewards System - Business Logic & Financial Integrity Tests', () => {
  beforeEach(() => {
    // Reset rules to defaults
    RewardService.updateRewardRules('admin-test', {
      percentage: 0.5,
      monthlyPoolLimit: 50000,
      minRedemptionAmount: 500,
    });
  });

  describe('1. Reward Calculation Engine', () => {
    test('Calculates exact 0.5% reward for ₹100,000 bill = ₹500', () => {
      const billAmount = 100000;
      const reward = RewardService.calculateReward(billAmount, 0.5);
      expect(reward).toBe(500.0);
    });

    test('Calculates exact 0.5% reward for ₹25,000 bill = ₹125', () => {
      const billAmount = 25000;
      const reward = RewardService.calculateReward(billAmount, 0.5);
      expect(reward).toBe(125.0);
    });

    test('Calculates exact 0.5% reward for ₹12,500 bill = ₹62.5', () => {
      const billAmount = 12500;
      const reward = RewardService.calculateReward(billAmount, 0.5);
      expect(reward).toBe(62.5);
    });
  });

  describe('2. Monthly ₹50,000 Reward Pool Cap Enforcement', () => {
    test('Enforces monthly reward pool ceiling and prevents overflow', () => {
      const pool = RewardService.getCurrentMonthPool();
      pool.totalPoolCap = 50000.0;
      pool.usedAmount = 49800.0; // ₹200 remaining

      // Claiming ₹150 should succeed
      expect(() => RewardService.claimPoolAmount(150.0)).not.toThrow();
      expect(pool.usedAmount).toBe(49950.0);

      // Claiming ₹100 when only ₹50 left must throw
      expect(() => RewardService.claimPoolAmount(100.0)).toThrow(/Monthly reward pool limit/);
    });

    test('Computes correct pool analytics (e.g. 75.7% used)', () => {
      const pool = RewardService.getCurrentMonthPool();
      pool.totalPoolCap = 50000.0;
      pool.usedAmount = 37850.0;

      const analytics = RewardService.getPoolAnalytics();
      expect(analytics.totalPoolCap).toBe(50000);
      expect(analytics.usedAmount).toBe(37850);
      expect(analytics.remainingAmount).toBe(12150);
      expect(analytics.percentageUsed).toBe(75.7);
    });
  });

  describe('3. Bill Upload & Duplicate Invoice Prevention', () => {
    test('Rejects duplicate invoice number submission by same user', async () => {
      const testUser = Array.from(dbStore.users.values())[0];
      const uniqueInv = `INV-TEST-${Date.now()}`;

      // First submission
      await BillService.submitBill({
        userId: testUser.id,
        invoiceNumber: uniqueInv,
        invoiceDate: '2026-10-01',
        billAmount: 20000,
        fileBuffer: Buffer.from('test bill invoice content'),
        fileName: 'bill.pdf',
        mimeType: 'application/pdf',
      });

      // Second submission with exact same invoice number must throw
      await expect(
        BillService.submitBill({
          userId: testUser.id,
          invoiceNumber: uniqueInv,
          invoiceDate: '2026-10-01',
          billAmount: 20000,
          fileBuffer: Buffer.from('test bill invoice content'),
          fileName: 'bill.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/already been submitted/);
    });
  });

  describe('4. KYC & Sensitive Data Masking', () => {
    test('Validates Indian PAN format and correctly masks PAN', async () => {
      const testUser = Array.from(dbStore.users.values())[0];
      const record = await KycService.verifyPan(testUser.id, 'ABCDE9876Z', 'RAMESH SHARMA');

      expect(record.panStatus).toBe('VERIFIED');
      expect(record.maskedPan).toBe('ABCDE••••Z');
    });

    test('Rejects invalid PAN number format', async () => {
      const testUser = Array.from(dbStore.users.values())[0];
      await expect(KycService.verifyPan(testUser.id, '123INVALID', 'RAMESH SHARMA')).rejects.toThrow(
        /Invalid PAN format/
      );
    });

    test('Validates UPI format and masks UPI handle', async () => {
      const testUser = Array.from(dbStore.users.values())[0];
      const account = await PaymentService.verifyUpi(testUser.id, 'rameshsharma@okhdfcbank');

      expect(account.isVerified).toBe(true);
      expect(account.maskedInfo).toBe('ram****@okhdfcbank');
    });

    test('Validates Bank Account & IFSC and masks account number', async () => {
      const testUser = Array.from(dbStore.users.values())[0];
      const account = await PaymentService.verifyBankAccount(
        testUser.id,
        'Ramesh Sharma',
        '987654321234',
        'HDFC0001234'
      );

      expect(account.isVerified).toBe(true);
      expect(account.bankName).toBe('HDFC Bank');
      expect(account.maskedInfo).toBe('HDFC Bank ••••••1234');
    });
  });

  describe('5. Payout Workflow, Idempotency & Immutable Ledger', () => {
    test('Enforces PAN verification requirement at redemption time', async () => {
      // User without KYC
      const newUser = await AuthService.register({
        mobile: '9123456789',
        fullName: 'New Worker',
        password: 'Password@123',
        profession: 'PLUMBER',
      });

      await expect(
        PayoutService.requestRedemption({
          userId: newUser.user.id,
          amount: 500,
          idempotencyKey: 'idem-test-1',
        })
      ).rejects.toThrow(/PAN verification is required/);
    });

    test('Enforces Idempotency to prevent duplicate payout transactions', async () => {
      // Use seeded user Raj who has KYC and Payment Account
      const raj = Array.from(dbStore.users.values()).find(u => u.mobile === '9876543210')!;
      const rajWallet = dbStore.wallets.get('wallet-raj')!;
      rajWallet.availableBalance = 3000.0;

      const idempotencyKey = `idem-unique-${Date.now()}`;

      const payout1 = await PayoutService.requestRedemption({
        userId: raj.id,
        amount: 600,
        idempotencyKey,
      });

      const payout2 = await PayoutService.requestRedemption({
        userId: raj.id,
        amount: 600,
        idempotencyKey,
      });

      expect(payout1.id).toBe(payout2.id);
    });

    test('Executes Payout state machine with RazorpayX webhook confirmation', async () => {
      const raj = Array.from(dbStore.users.values()).find(u => u.mobile === '9876543210')!;
      const rajWallet = dbStore.wallets.get('wallet-raj')!;
      rajWallet.availableBalance = 2000.0;
      const initialTotalRedeemed = rajWallet.totalRedeemed;

      const payout = await PayoutService.requestRedemption({
        userId: raj.id,
        amount: 500,
        idempotencyKey: `idem-webhook-${Date.now()}`,
      });

      expect(payout.status).toBe('PROCESSING');

      // Simulate successful webhook
      await PayoutService.completePayout(payout.id, true);

      expect(payout.status).toBe('SUCCESS');
      expect(rajWallet.totalRedeemed).toBe(initialTotalRedeemed + 500);
    });

    test('Refunds available balance on Payout failure / reversal with ledger entry', async () => {
      const raj = Array.from(dbStore.users.values()).find(u => u.mobile === '9876543210')!;
      const rajWallet = dbStore.wallets.get('wallet-raj')!;
      rajWallet.availableBalance = 2000.0;

      const payout = await PayoutService.requestRedemption({
        userId: raj.id,
        amount: 500,
        idempotencyKey: `idem-reverse-${Date.now()}`,
      });

      const balanceAfterDebit = rajWallet.availableBalance;

      // Simulate failure webhook
      await PayoutService.completePayout(payout.id, false, 'Bank server downtime');

      expect(payout.status).toBe('FAILED');
      expect(rajWallet.availableBalance).toBe(balanceAfterDebit + 500);

      // Verify immutable ledger reversal record
      const reversalTx = Array.from(dbStore.walletTransactions.values()).find(
        t => t.referenceId === payout.id && t.type === 'PAYOUT_REVERSAL'
      );
      expect(reversalTx).toBeDefined();
    });
  });
});
