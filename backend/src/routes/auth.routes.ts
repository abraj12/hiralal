import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
import { generateSecureToken, sha256Hash } from '../utils/crypto.utils';

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
    const { mobile, firstName, middleName, lastName, fullName, password, profession, verificationToken, otpCode } = req.body;
    if (!mobile || (!firstName && !fullName) || !password) {
      return res.status(400).json({ success: false, message: 'Mobile, first name, and password are required.' });
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
      firstName,
      middleName,
      lastName,
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
    let userId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.decode(token) as any;
        if (decoded?.userId || decoded?.id) {
          userId = decoded.userId || decoded.id;
        }
      } catch {
        // ignore decoding errors
      }
    }
    await AuthService.logout(refreshToken, userId);
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
// 5. ADMIN AUTHENTICATION (OTP-First Flow)
// ==========================================

router.post('/admin/otp/request', otpRequestLimiter, async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.username;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Admin identifier is required.' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = await AuthService.requestAdminOtp({ identifier, ipAddress });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/admin/otp/verify', otpVerifyLimiter, async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.username;
    const { otpCode } = req.body;
    if (!identifier || !otpCode) {
      return res.status(400).json({ success: false, message: 'Admin identifier and OTP code are required.' });
    }
    const result = await AuthService.verifyAdminOtp({ identifier, otpCode });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(
  '/admin/login',
  adminLoginLimiter,
  adminAccountLoginLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = req.body.identifier || req.body.username;
      const { password, verificationToken } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Admin identifier and password are required.' });
      }

      if (!verificationToken) {
        return res.status(400).json({
          success: false,
          message: 'Admin verification challenge token is required. Please verify OTP first.',
        });
      }

      const ipAddress = req.ip || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await AuthService.loginAdmin({
        identifier,
        password,
        verificationToken,
        userAgent,
        ipAddress,
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(401).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/admin-login',
  adminLoginLimiter,
  adminAccountLoginLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = req.body.identifier || req.body.username;
      const { password, verificationToken } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Admin mobile/username and password are required.' });
      }

      if (verificationToken) {
        const ipAddress = req.ip || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const result = await AuthService.loginAdmin({
          identifier,
          password,
          verificationToken,
          userAgent,
          ipAddress,
        });
        return res.json({ success: true, ...result });
      }

      // Password-only admin authentication is strictly forbidden in production
      if (config.isProduction) {
        return res.status(403).json({
          success: false,
          message: 'Password-only admin login is deprecated and disabled for security in production. Admin authentication requires OTP verification (/api/auth/admin/otp/request -> /api/auth/admin/otp/verify -> /api/auth/admin/login).',
        });
      }

      const cleanMobile = identifier.replace(/\D/g, '').slice(-10);
      const admin = await prisma.user.findFirst({
        where: {
          mobile: cleanMobile,
          role: { in: ['ADMIN', 'BILL_ADMIN', 'OPERATIONS_ADMIN'] },
        },
      });

      if (!admin) {
        return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      }

      const isMatch = await bcrypt.compare(password, admin.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      }

      const sessionId = crypto.randomUUID();
      await prisma.authSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.user.update({
        where: { id: admin.id },
        data: { activeSessionId: sessionId },
      });

      const token = jwt.sign(
        { userId: admin.id, role: admin.role, mobile: admin.mobile, sessionId },
        config.admin.accessSecret || config.jwt.accessSecret,
        { expiresIn: config.jwt.accessExpiresIn as any }
      );

      const sessionToken = generateSecureToken(40);
      const sessionTokenHash = sha256Hash(sessionToken);
      const sessionExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);

      await prisma.authSession.create({
        data: {
          userId: admin.id,
          sessionId,
          tokenHash: sessionTokenHash,
          expiresAt: sessionExpiresAt,
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
        sessionId,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ==========================================
// 6. CURRENT USER PROFILE (/me) & NAME EDIT
// ==========================================

router.put('/profile/name', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { firstName, middleName, lastName, fullName } = req.body;
    const result = await AuthService.updateUserName(user.id, { firstName, middleName, lastName, fullName });
    res.json({ success: true, message: 'Name updated successfully.', user: result });
  } catch (err: any) {
    const isLockedError = err.message && err.message.includes('locked');
    res.status(isLockedError ? 403 : 400).json({ success: false, message: err.message });
  }
});

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
        firstName: freshUser.firstName,
        middleName: freshUser.middleName,
        lastName: freshUser.lastName,
        isNameLocked: freshUser.isNameLocked,
        nameLockedAt: freshUser.nameLockedAt,
        profession: freshUser.profession,
        role: freshUser.role,
        isKycVerified: freshUser.kycRecords.length > 0 && freshUser.kycRecords[0].nameMatched,
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
