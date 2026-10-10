import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/auth.service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import {
  otpRequestLimiter,
  otpVerifyLimiter,
  loginLimiter,
  passwordResetLimiter,
  adminLoginLimiter,
  adminAccountLoginLimiter,
} from '../middleware/rateLimit.middleware';
import { prisma } from '../db';
import { config } from '../config';

const router = Router();

// ==========================================
// 1. OTP REQUEST & VERIFICATION
// ==========================================

const handleOtpRequest = async (req: Request, res: Response) => {
  try {
    const { mobile, purpose = 'REGISTRATION' } = req.body;
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = await AuthService.requestOtp({ mobile, purpose, ipAddress });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

router.post('/otp/request', otpRequestLimiter, handleOtpRequest);
router.post('/send-otp', otpRequestLimiter, handleOtpRequest); // Backwards compatibility alias

const handleOtpVerify = async (req: Request, res: Response) => {
  try {
    const { mobile, otpCode, purpose = 'REGISTRATION' } = req.body;
    if (!mobile || !otpCode) {
      return res.status(400).json({ success: false, message: 'Mobile and 6-digit OTP code are required.' });
    }
    const result = await AuthService.verifyOtp({ mobile, otpCode, purpose });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

router.post('/otp/verify', otpVerifyLimiter, handleOtpVerify);
router.post('/verify-otp', otpVerifyLimiter, handleOtpVerify); // Backwards compatibility alias

// ==========================================
// 2. REGISTRATION (Consumes verificationToken)
// ==========================================

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { mobile, fullName, password, profession, verificationToken, otpCode } = req.body;
    if (!mobile || !fullName || !password) {
      return res.status(400).json({ success: false, message: 'Mobile, full name, and password are required.' });
    }

    if (!['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      return res.status(400).json({ success: false, message: 'Profession must be either PLUMBER or TILE_INSTALLER.' });
    }

    let tokenToConsume = verificationToken;

    // Graceful adapter: if older client provided otpCode directly, verify OTP first to acquire token
    if (!tokenToConsume && otpCode) {
      const verifyRes = await AuthService.verifyOtp({ mobile, otpCode, purpose: 'REGISTRATION' });
      tokenToConsume = verifyRes.verificationToken;
    }

    if (!tokenToConsume) {
      return res.status(400).json({ success: false, message: 'Verification token is required. Please verify OTP first.' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.registerUser({
      mobile,
      fullName,
      password,
      profession,
      verificationToken: tokenToConsume,
      ipAddress,
      userAgent,
    });

    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. LOGIN & SESSIONS
// ==========================================

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { mobile, password } = req.body;
    if (!mobile || !password) {
      return res.status(400).json({ success: false, message: 'Mobile number and password are required.' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.login(mobile, password, userAgent, ipAddress);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required.' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.refreshToken(refreshToken, userAgent, ipAddress);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await AuthService.logout(refreshToken);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 4. REAL BACKEND PASSWORD RESET FLOW
// ==========================================

router.post('/password-reset/request', passwordResetLimiter, async (req: Request, res: Response) => {
  try {
    const { mobile } = req.body;
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = await AuthService.requestOtp({ mobile, purpose: 'FORGOT_PASSWORD', ipAddress });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/password-reset/verify', otpVerifyLimiter, async (req: Request, res: Response) => {
  try {
    const { mobile, otpCode } = req.body;
    if (!mobile || !otpCode) {
      return res.status(400).json({ success: false, message: 'Mobile and OTP code are required.' });
    }
    const result = await AuthService.verifyOtp({ mobile, otpCode, purpose: 'FORGOT_PASSWORD' });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/password-reset/complete', async (req: Request, res: Response) => {
  try {
    const { mobile, verificationToken, newPassword } = req.body;
    if (!mobile || !verificationToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Mobile, verification token, and new password are required.' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await AuthService.completePasswordReset({
      mobile,
      verificationToken,
      newPassword,
      ipAddress,
      userAgent,
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ==========================================
// 5. ADMIN AUTHENTICATION
// ==========================================

router.post(
  '/admin-login',
  adminLoginLimiter,
  adminAccountLoginLimiter,
  async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Admin mobile/username and password are required.' });
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
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiresIn as any }
    );

    const ipAddress = req.ip || req.socket.remoteAddress;
    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: 'ADMIN_LOGIN',
        entityType: 'User',
        entityId: admin.id,
        ipAddress,
        newValue: 'Administrator session authenticated.',
      },
    });

    res.json({
      success: true,
      user: {
        id: admin.id,
        fullName: admin.fullName,
        mobile: admin.mobile,
        role: admin.role,
      },
      token,
      accessToken: token,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 6. CURRENT USER PROFILE (/me)
// ==========================================

router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const freshUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        wallet: true,
        kycRecords: { where: { panStatus: 'VERIFIED' } },
        paymentAccounts: { where: { isVerified: true, isDefault: true } },
      },
    });

    if (!freshUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      user: {
        id: freshUser.id,
        mobile: freshUser.mobile,
        fullName: freshUser.fullName,
        profession: freshUser.profession,
        role: freshUser.role,
        isKycVerified: freshUser.kycRecords.length > 0,
        isPaymentVerified: freshUser.paymentAccounts.length > 0,
        createdAt: freshUser.createdAt,
      },
      wallet: freshUser.wallet
        ? {
            availableBalance: Number(freshUser.wallet.availableBalance),
            processingAmount: Number(freshUser.wallet.processingAmount),
            totalRedeemed: Number(freshUser.wallet.totalRedeemed),
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
