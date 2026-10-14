import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthService, normalizeStrictIndianMobile, requirePublicGenericOtpPurpose, requireGenericOtpPurpose, PASSWORD_RESET_INVALID_MESSAGE } from '../services/auth.service';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import {
  otpRequestLimiter,
  otpRequestIpLimiter,
  otpVerifyLimiter,
  otpVerifyIpLimiter,
  loginLimiter,
  loginIpLimiter,
  passwordResetLimiter,
  passwordResetCompleteLimiter,
  passwordResetCompleteIpLimiter,
  adminLoginLimiter,
  adminAccountLoginLimiter,
  integrityNonceLimiter,
  integrityVerifyLimiter,
} from '../middleware/rateLimit.middleware';
import { prisma } from '../db';
import { config } from '../config';
import { generateSecureToken, sha256Hash } from '../utils/crypto.utils';
import { PlayIntegrityService } from '../services/integrity/playIntegrity.service';
import { AccountDeletionService } from '../services/account-deletion.service';
import { requireActionIntegrity, requirePreAuthActionIntegrity } from '../middleware/integrity.middleware';
import { computeIntegrityRequestHash } from '../utils/integrityRequestHash';

const router = Router();

function setAdminCookie(res: Response, token?: string) {
  if (!token) return;
  res.cookie('admin_access_token', token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'strict' : 'lax',
    maxAge: 24 * 3600 * 1000,
    path: '/',
  });
  const csrfToken = generateSecureToken(32);
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'strict' : 'lax',
    maxAge: 24 * 3600 * 1000,
    path: '/',
  });
}

// ==========================================
// 0. PUBLIC ADMIN PREFIXES DISCOVERY
// ==========================================

router.get('/admin-prefixes', (_req: Request, res: Response) => {
  res.json({
    success: true,
    prefixes: {
      billAdmin: config.admin.billAdminPrefix,
      operationsAdmin: config.admin.operationsAdminPrefix,
    },
  });
});

// ==========================================
// 1. OTP REQUEST & VERIFICATION
// ==========================================

const handleOtpRequest = async (req: Request, res: Response) => {
  try {
    const { mobile, purpose } = req.body;
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }
    const validatedPurpose = requirePublicGenericOtpPurpose(purpose);
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = await AuthService.requestOtp({ mobile, purpose: validatedPurpose, ipAddress });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

router.post('/otp/request', otpRequestIpLimiter, otpRequestLimiter, handleOtpRequest);
router.post('/send-otp', otpRequestIpLimiter, otpRequestLimiter, handleOtpRequest); // Backwards compatibility alias

const handleOtpVerify = async (req: Request, res: Response) => {
  try {
    const { mobile, otpCode, purpose } = req.body;
    if (!mobile || !otpCode) {
      return res.status(400).json({ success: false, message: 'Mobile and 6-digit OTP code are required.' });
    }
    const validatedPurpose = requirePublicGenericOtpPurpose(purpose);
    const result = await AuthService.verifyOtp({ mobile, otpCode, purpose: validatedPurpose });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

router.post('/otp/verify', otpVerifyIpLimiter, otpVerifyLimiter, handleOtpVerify);
router.post('/verify-otp', otpVerifyIpLimiter, otpVerifyLimiter, handleOtpVerify); // Backwards compatibility alias

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

    // Pre-auth integrity check for mobile registration
    const isEnforcing = PlayIntegrityService.isEnforcingActions();
    const integrityToken = (req.headers['x-integrity-token'] as string) || (req.body?.integrityToken as string);
    const integrityNonce = (req.headers['x-integrity-nonce'] as string) || (req.body?.integrityNonce as string);

    if (integrityToken && integrityNonce) {
      const requestHash = computeIntegrityRequestHash('REGISTRATION', req);
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: integrityNonce,
        integrityToken,
        expectedContext: {
          action: 'REGISTRATION',
          requestHash,
        },
      });

      if (!verdict.success) {
        return res.status(403).json({
          success: false,
          code: 'INTEGRITY_FAILED',
          message: verdict.error || 'Device integrity verification failed.',
          verdict,
        });
      }
    } else if (isEnforcing) {
      return res.status(403).json({
        success: false,
        code: 'INTEGRITY_REQUIRED',
        message: 'Device integrity attestation is required for mobile registration.',
      });
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

router.post('/login', loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const rawIdentifier = String(req.body?.identifier || req.body?.mobile || '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!rawIdentifier || !password) {
    return res.status(400).json({ success: false, message: 'Mobile number and password are required.' });
  }

  // Pre-auth integrity check for craftsman mobile logins (non-admin candidates only)
  const isEnforcing = PlayIntegrityService.isEnforcingActions();
  const isAdminCandidate = AuthService.isConfiguredAdminPrefix(rawIdentifier);

  const integrityToken = (req.headers['x-integrity-token'] as string) || (req.body?.integrityToken as string);
  const integrityNonce = (req.headers['x-integrity-nonce'] as string) || (req.body?.integrityNonce as string);

  if (!isAdminCandidate) {
    if (integrityToken && integrityNonce) {
      const requestHash = computeIntegrityRequestHash('AUTH', req);
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: integrityNonce,
        integrityToken,
        expectedContext: {
          action: 'AUTH',
          requestHash,
        },
      });

      if (!verdict.success) {
        return res.status(403).json({
          success: false,
          code: 'INTEGRITY_FAILED',
          message: verdict.error || 'Device integrity verification failed.',
          verdict,
        });
      }
    } else if (isEnforcing) {
      return res.status(403).json({
        success: false,
        code: 'INTEGRITY_REQUIRED',
        message: 'Device integrity attestation is required for mobile login.',
      });
    }
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    const result = await AuthService.authenticatePasswordFirst({
      identifier: rawIdentifier,
      password,
      ipAddress,
      userAgent,
    });

    if (result.kind === 'USER_AUTHENTICATED') {
      return res.status(200).json({
        success: true,
        type: 'USER_AUTHENTICATED',
        ...result.session,
      });
    }

    if (result.kind === 'ADMIN_OTP_REQUIRED') {
      return res.status(200).json({
        success: true,
        type: 'ADMIN_OTP_REQUIRED',
        requiresOtp: true,
        challengeId: result.challengeId,
        challengeToken: result.challengeToken,
        role: result.role,
        mobileMasked: result.mobileMasked,
        message: result.message,
        cooldownSeconds: result.cooldownSeconds,
        expiresAt: result.expiresAt,
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid login credentials. Please check your details and try again.',
    });
  } catch (err: any) {
    const isCredentials =
      err.message.includes('credentials') ||
      err.message.includes('password') ||
      err.message.includes('mobile') ||
      err.message.includes('prefix') ||
      err.message.includes('format') ||
      err.message.includes('not found') ||
      err.message.includes('suspended');
    res.status(isCredentials ? 401 : 400).json({
      success: false,
      message: isCredentials ? 'Invalid login credentials. Please check your details and try again.' : err.message,
    });
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
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, config.jwt.accessSecret) as any;
        if (decoded?.userId || decoded?.id) {
          userId = decoded.userId || decoded.id;
        }
      } catch {
        try {
          const decodedAdmin = jwt.verify(token, config.admin.accessSecret) as any;
          if (decodedAdmin?.userId || decodedAdmin?.id) {
            userId = decodedAdmin.userId || decodedAdmin.id;
          }
        } catch {
          // Token is invalid/unverified - do not trust userId from unverified token
        }
      }
    }

    const cookies = (req as any).cookies || { admin_access_token: req.headers.cookie?.match(/admin_access_token=([^;]+)/)?.[1] };
    const cookieToken = cookies?.admin_access_token;
    if (!userId && cookieToken) {
      try {
        const decodedAdmin = jwt.verify(cookieToken, config.admin.accessSecret) as any;
        if (decodedAdmin?.userId || decodedAdmin?.id) {
          userId = decodedAdmin.userId || decodedAdmin.id;
        }
      } catch {
        // Token is invalid/unverified
      }
    }

    if (!refreshToken && !userId) {
      return res.status(400).json({
        success: false,
        message: 'A valid session token (Authorization header) or refresh token is required for logout.',
      });
    }

    await AuthService.logout(refreshToken, userId);

    const cookieOpts = {
      path: '/',
      secure: config.isProduction,
      sameSite: (config.isProduction ? 'strict' : 'lax') as 'strict' | 'lax',
    };
    res.clearCookie('admin_access_token', { ...cookieOpts, httpOnly: true });
    res.clearCookie('csrf_token', { ...cookieOpts, httpOnly: false });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 4. REAL BACKEND PASSWORD RESET FLOW
// ==========================================

router.post(
  '/password-reset/request',
  passwordResetLimiter,
  requirePreAuthActionIntegrity('FORGOT_PASSWORD_REQUEST'),
  async (req: Request, res: Response) => {
    try {
      const { mobile } = req.body;
      if (!mobile) {
        return res.status(400).json({ success: false, message: 'Mobile number is required.' });
      }
      const ipAddress = req.ip || req.socket.remoteAddress;
      const result = await AuthService.requestPasswordResetOtp({ mobile, ipAddress });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/password-reset/verify',
  otpVerifyLimiter,
  requirePreAuthActionIntegrity('FORGOT_PASSWORD_VERIFY'),
  async (req: Request, res: Response) => {
    try {
      const { mobile, otpCode } = req.body;
      if (!mobile || !otpCode) {
        return res.status(400).json({ success: false, message: 'Mobile and OTP code are required.' });
      }
      const result = await AuthService.verifyPasswordResetOtp({ mobile, otpCode });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/password-reset/complete',
  passwordResetCompleteIpLimiter,
  passwordResetCompleteLimiter,
  requirePreAuthActionIntegrity('FORGOT_PASSWORD_COMPLETE'),
  async (req: Request, res: Response) => {
    try {
      const { mobile, verificationToken, newPassword } = req.body;
      if (!mobile || !verificationToken || !newPassword) {
        return res.status(400).json({ success: false, message: 'Mobile, verification token, and new password are required.' });
      }

      if (typeof newPassword !== 'string') {
        return res.status(400).json({ success: false, message: 'Password must be a valid string.' });
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
      const isKnownFailure =
        err.message === PASSWORD_RESET_INVALID_MESSAGE ||
        err.message.includes('password') ||
        err.message.includes('Password') ||
        err.message.includes('invalid') ||
        err.message.includes('expired');

      if (isKnownFailure) {
        return res.status(400).json({ success: false, message: err.message });
      }

      console.error('[AuthRoutes] Unexpected error in /password-reset/complete:', err);
      return res.status(500).json({ success: false, message: 'An internal error occurred. Please try again later.' });
    }
  }
);

// ==========================================
// 5. ADMIN AUTHENTICATION (OTP-First Flow)
// ==========================================

router.post('/admin/otp/request', otpRequestIpLimiter, otpRequestLimiter, async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.username;
    const { password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Invalid login credentials. Please check your details and try again.' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await AuthService.requestAdminOtp({ identifier, password, ipAddress, userAgent });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const isCredentials =
      err.message.includes('credentials') ||
      err.message.includes('password') ||
      err.message.includes('prefix') ||
      err.message.includes('format') ||
      err.message.includes('not found') ||
      err.message.includes('suspended');
    res.status(isCredentials ? 401 : 400).json({
      success: false,
      message: isCredentials ? 'Invalid login credentials. Please check your details and try again.' : err.message,
    });
  }
});

router.post('/admin/otp/verify', otpVerifyIpLimiter, otpVerifyLimiter, async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.username;
    const { otpCode, challengeToken, verificationToken } = req.body;
    const activeChallenge = challengeToken || verificationToken;
    if (!identifier || !otpCode || !activeChallenge) {
      return res.status(400).json({
        success: false,
        message: 'Admin identifier, OTP code, and verification challenge token are required.',
      });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await AuthService.verifyAdminOtp({
      identifier,
      otpCode,
      challengeToken: activeChallenge,
      userAgent,
      ipAddress,
    });
    if (result.accessToken || result.token) {
      setAdminCookie(res, result.accessToken || result.token);
    }
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

function rejectLegacyAdminLogin(_req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    code: 'LEGACY_ADMIN_LOGIN_DISABLED',
    message:
      'This administrator login endpoint is disabled. ' +
      'Use the password and verified OTP authentication flow.',
  });
}

router.post(
  '/admin/login',
  adminLoginLimiter,
  adminAccountLoginLimiter,
  rejectLegacyAdminLogin
);

router.post(
  '/admin-login',
  adminLoginLimiter,
  adminAccountLoginLimiter,
  rejectLegacyAdminLogin
);

// ==========================================
// 6. CURRENT USER PROFILE (/me) & NAME EDIT
// ==========================================

router.put('/profile/name', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
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

router.get('/me', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
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

router.patch('/me', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { fullName, profession } = req.body;

    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        kycRecords: { where: { panStatus: 'VERIFIED' } },
      },
    });

    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isLocked = currentUser.isNameLocked || (currentUser.kycRecords.length > 0 && currentUser.kycRecords[0].nameMatched);

    const dataToUpdate: any = {};

    if (profession !== undefined) {
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Profile is locked following KYC verification. Profession cannot be altered.',
        });
      }
      if (!['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
        return res.status(400).json({ success: false, message: 'Invalid profession. Must be PLUMBER or TILE_INSTALLER.' });
      }
      dataToUpdate.profession = profession;
    }

    if (fullName !== undefined) {
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Profile is locked following identity verification. Contact Operations Admin for corrections.',
        });
      }
      await AuthService.updateUserName(user.id, { fullName });
    }

    if (Object.keys(dataToUpdate).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: dataToUpdate,
      });
    }

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
      message: 'Profile updated successfully.',
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
    });
  } catch (err: any) {
    const isLockedError = err.message && err.message.includes('locked');
    res.status(isLockedError ? 403 : 400).json({ success: false, message: err.message });
  }
});

// ==========================================
// 8. PLAY INTEGRITY NONCE & VERIFICATION
// ==========================================

router.post(
  '/integrity/nonce',
  authenticate,
  requireUser,
  integrityNonceLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { action, requestHash } = req.body ?? {};

      const allowedActions = [
        'BILL_UPLOAD',
        'KYC_SUBMIT',
        'PAYOUT_REDEEM',
        'BENEFICIARY_VERIFY',
        'ACCOUNT_DELETION',
        'ACCOUNT_DELETION_REQUEST',
        'ACCOUNT_DELETION_CONFIRM',
      ] as const;

      if (!action || !allowedActions.includes(action)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTION',
          message: 'A valid protected integrity action is required (BILL_UPLOAD, KYC_SUBMIT, PAYOUT_REDEEM, BENEFICIARY_VERIFY, ACCOUNT_DELETION, ACCOUNT_DELETION_REQUEST, ACCOUNT_DELETION_CONFIRM).',
        });
      }

      if (
        typeof requestHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(requestHash)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST_HASH',
          message: 'A valid SHA-256 request hash is required.',
        });
      }

      const user = req.user!;

      const result = await PlayIntegrityService.generateNonce({
        userId: user.id,
        sessionId: user.activeSessionId ?? undefined,
        action,
        requestHash: requestHash.toLowerCase(),
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/integrity/pre-auth/nonce',
  integrityNonceLimiter,
  async (req: Request, res: Response) => {
    try {
      const { action = 'AUTH', requestHash } = req.body ?? {};
      const allowedPreAuthActions = [
        'AUTH',
        'REGISTRATION',
        'FORGOT_PASSWORD',
        'FORGOT_PASSWORD_REQUEST',
        'FORGOT_PASSWORD_VERIFY',
        'FORGOT_PASSWORD_COMPLETE',
        'GENERAL',
      ] as const;

      if (!action || !allowedPreAuthActions.includes(action)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTION',
          message: 'Pre-auth integrity action must be AUTH, REGISTRATION, FORGOT_PASSWORD, FORGOT_PASSWORD_REQUEST, FORGOT_PASSWORD_VERIFY, FORGOT_PASSWORD_COMPLETE, or GENERAL.',
        });
      }

      if (
        typeof requestHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(requestHash)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST_HASH',
          message: 'A valid SHA-256 request hash is required.',
        });
      }

      const result = await PlayIntegrityService.generateNonce({
        action,
        requestHash: requestHash.toLowerCase(),
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/integrity/verify',
  authenticate,
  requireUser,
  integrityVerifyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { nonce, integrityToken, action, requestHash } = req.body ?? {};
      if (!nonce || !integrityToken) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_PARAMETERS',
          message: 'Both nonce and integrityToken are required.',
        });
      }

      const allowedActions = [
        'BILL_UPLOAD',
        'KYC_SUBMIT',
        'PAYOUT_REDEEM',
        'BENEFICIARY_VERIFY',
        'ACCOUNT_DELETION',
        'ACCOUNT_DELETION_REQUEST',
        'ACCOUNT_DELETION_CONFIRM',
      ] as const;

      if (!action || !allowedActions.includes(action)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTION',
          message: 'A valid protected integrity action is required.',
        });
      }

      if (
        typeof requestHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(requestHash)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST_HASH',
          message: 'A valid SHA-256 request hash is required.',
        });
      }

      const user = req.user!;

      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce,
        integrityToken,
        expectedContext: {
          userId: user.id,
          sessionId: user.activeSessionId ?? undefined,
          action,
          requestHash: requestHash.toLowerCase(),
        },
      });

      if (!verdict.success) {
        return res.status(400).json({
          success: false,
          code: 'VERIFICATION_FAILED',
          message: verdict.error || 'Integrity verification failed.',
          verdict,
        });
      }

      return res.json({ success: true, verdict });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ==========================================
// 9. ACCOUNT DELETION LIFECYCLE (Password + OTP + 7-Day Grace Period)
// ==========================================

router.post(
  '/account-deletion/request',
  authenticate,
  requireUser,
  requireActionIntegrity('ACCOUNT_DELETION_REQUEST'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress;

      const result = await AccountDeletionService.requestDeletion(user.id, password, ipAddress);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

router.post(
  '/account-deletion/confirm',
  authenticate,
  requireUser,
  requireActionIntegrity('ACCOUNT_DELETION_CONFIRM'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { otpCode } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress;

      const result = await AccountDeletionService.confirmDeletion(user.id, otpCode, ipAddress);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

router.get(
  '/account-deletion/status',
  authenticate,
  requireUser,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const result = await AccountDeletionService.getDeletionStatus(user.id);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

export default router;
