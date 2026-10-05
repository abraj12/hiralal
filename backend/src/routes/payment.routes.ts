import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { PaymentService } from '../services/payment.service';

const router = Router();

router.post('/upi/verify', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { upiId } = req.body;

    if (!upiId) {
      return res.status(400).json({ success: false, message: 'UPI ID is required.' });
    }

    const account = await PaymentService.verifyUpi(user.id, upiId);

    res.json({
      success: true,
      message: 'UPI ID verified successfully.',
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

router.post('/bank/verify', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { accountHolderName, accountNumber, ifscCode } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'Account holder name, account number, and IFSC code are required.',
      });
    }

    const account = await PaymentService.verifyBankAccount(
      user.id,
      accountHolderName,
      accountNumber,
      ifscCode
    );

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

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const accounts = PaymentService.getUserPaymentAccounts(user.id);

    res.json({
      success: true,
      paymentAccounts: accounts.map(a => ({
        id: a.id,
        accountType: a.accountType,
        bankName: a.bankName,
        maskedInfo: a.maskedInfo,
        isVerified: a.isVerified,
        isDefault: a.isDefault,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
