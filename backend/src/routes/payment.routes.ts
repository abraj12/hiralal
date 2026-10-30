import { Router, Response } from 'express';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireActionIntegrity } from '../middleware/integrity.middleware';
import { paymentVerifyLimiter } from '../middleware/rateLimit.middleware';
import { PaymentService } from '../services/payment.service';
import { ConsentService } from '../services/consent.service';

const router = Router();

router.post(
  '/upi/verify',
  authenticate,
  requireUser,
  paymentVerifyLimiter,
  requireActionIntegrity('BENEFICIARY_VERIFY'),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { upiId, accountHolderName } = req.body;

    if (!upiId) {
      return res.status(400).json({ success: false, message: 'UPI ID is required.' });
    }

    // HIR-M-08: bank/UPI details and name are shared with RazorpayX (₹1 validation) only with consent
    if (req.body?.consent !== true) {
      return res.status(400).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'Please agree to account verification with our payment partner before continuing.',
      });
    }
    await ConsentService.recordBeneficiaryConsent(user.id, {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    const account = await PaymentService.addUpiAccount(user.id, upiId, accountHolderName);

    res.json({
      success: true,
      message: 'UPI account verified successfully.',
      paymentAccount: {
        id: account.id,
        accountType: account.accountType,
        maskedInfo: account.maskedInfo,
        isVerified: account.isVerified,
        isDefault: account.isDefault,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(
  '/bank/verify',
  authenticate,
  requireUser,
  paymentVerifyLimiter,
  requireActionIntegrity('BENEFICIARY_VERIFY'),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { accountHolderName, accountNumber, ifscCode, bankName } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'Account holder name, account number, and IFSC code are required.',
      });
    }

    // HIR-M-08: bank/UPI details and name are shared with RazorpayX (₹1 validation) only with consent
    if (req.body?.consent !== true) {
      return res.status(400).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'Please agree to account verification with our payment partner before continuing.',
      });
    }
    await ConsentService.recordBeneficiaryConsent(user.id, {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    const account = await PaymentService.addBankAccount({
      userId: user.id,
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
    });

    res.json({
      success: true,
      message: 'Bank account verified successfully.',
      paymentAccount: {
        id: account.id,
        accountType: account.accountType,
        bankName: account.bankName,
        maskedInfo: account.maskedInfo,
        isVerified: account.isVerified,
        isDefault: account.isDefault,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const accounts = await PaymentService.getUserAccounts(user.id);

    res.json({
      success: true,
      paymentAccounts: accounts,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve payment accounts. Please retry.' });
  }
});

export default router;
