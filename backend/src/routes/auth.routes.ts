import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { dbStore } from '../db/store';

const router = Router();

router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { mobile, purpose = 'REGISTRATION' } = req.body;
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }
    const result = await AuthService.sendOtp(mobile, purpose);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { mobile, otpCode, purpose = 'REGISTRATION' } = req.body;
    if (!mobile || !otpCode) {
      return res.status(400).json({ success: false, message: 'Mobile and OTP code are required' });
    }
    await AuthService.verifyOtp(mobile, otpCode, purpose);
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { mobile, fullName, password, profession, otpCode } = req.body;
    if (!mobile || !fullName || !password) {
      return res.status(400).json({ success: false, message: 'Mobile, name, and password are required' });
    }
    if (profession && !['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Profession must be either PLUMBER or TILE_INSTALLER' });
    }
    const result = await AuthService.register({ mobile, fullName, password, profession: profession || 'PLUMBER', otpCode });
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { mobile, password } = req.body;
    if (!mobile || !password) {
      return res.status(400).json({ success: false, message: 'Mobile and password are required' });
    }
    const result = await AuthService.login(mobile, password);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.post('/admin-login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Admin username and password are required' });
    }
    const result = await AuthService.adminLogin(username, password);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { mobile, otpCode, newPassword } = req.body;
    if (!mobile || !otpCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'Mobile, OTP, and new password are required' });
    }
    const result = await AuthService.resetPassword(mobile, otpCode, newPassword);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);
    const kyc = Array.from(dbStore.kycRecords.values()).find(k => k.userId === user.id);
    const paymentAccounts = Array.from(dbStore.paymentAccounts.values()).filter(p => p.userId === user.id);

    res.json({
      success: true,
      user: AuthService.sanitizeUser(user),
      wallet: wallet || { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 },
      kyc: kyc ? { panStatus: kyc.panStatus, maskedPan: kyc.maskedPan, panName: kyc.panName } : null,
      paymentAccounts: paymentAccounts.map(p => ({
        id: p.id,
        accountType: p.accountType,
        maskedInfo: p.maskedInfo,
        isVerified: p.isVerified,
        isDefault: p.isDefault,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { profession, fullName } = req.body;

    if (profession && ['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      user.profession = profession;
    }
    if (fullName && fullName.trim()) {
      user.fullName = fullName.trim();
    }

    user.updatedAt = new Date();
    dbStore.users.set(user.id, user);

    res.json({
      success: true,
      user: AuthService.sanitizeUser(user),
      message: 'Profile updated successfully',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
