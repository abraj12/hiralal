import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/auth.service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../db';
import { config } from '../config';

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
    if (!mobile || !fullName || !password || !otpCode) {
      return res.status(400).json({ success: false, message: 'Mobile, name, password, and OTP code are required' });
    }
    if (!['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Profession must be either PLUMBER or TILE_INSTALLER' });
    }
    const result = await AuthService.registerUser({ mobile, fullName, password, profession, otpCode });
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
      return res.status(400).json({ success: false, message: 'Admin username (mobile) and password are required' });
    }

    const cleanMobile = username.replace(/\D/g, '').slice(-10);
    const admin = await prisma.user.findFirst({
      where: {
        mobile: cleanMobile,
        role: 'ADMIN',
      },
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const token = jwt.sign(
      { userId: admin.id, role: admin.role, mobile: admin.mobile },
      config.jwt.secret,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      user: {
        id: admin.id,
        fullName: admin.fullName,
        mobile: admin.mobile,
        role: admin.role,
      },
      token,
    });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }
    const result = await AuthService.refreshSession(refreshToken);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        wallet: true,
        kycRecords: { orderBy: { createdAt: 'desc' }, take: 1 },
        paymentAccounts: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!fullUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const kyc = fullUser.kycRecords[0] || null;

    res.json({
      success: true,
      user: {
        id: fullUser.id,
        mobile: fullUser.mobile,
        fullName: fullUser.fullName,
        profession: fullUser.profession,
        role: fullUser.role,
        isVerified: fullUser.isVerified,
      },
      wallet: fullUser.wallet
        ? {
            availableBalance: Number(fullUser.wallet.availableBalance),
            processingAmount: Number(fullUser.wallet.processingAmount),
            totalRedeemed: Number(fullUser.wallet.totalRedeemed),
          }
        : { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 },
      kyc: kyc
        ? { panStatus: kyc.panStatus, maskedPan: kyc.maskedPan, panName: kyc.panName }
        : null,
      paymentAccounts: fullUser.paymentAccounts.map((p) => ({
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

export default router;
