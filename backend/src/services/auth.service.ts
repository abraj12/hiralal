import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import {
  generateSecureOtp,
  sha256Hash,
  generateSecureToken,
  hmacHashOtp,
} from '../utils/crypto.utils';
import { validateStructuredName } from '../utils/name.utils';
import { UserRole, Profession } from '@prisma/client';
import { SmsService } from './sms';


export class AuthService {
  /**
   * Generates and dispatches cryptographically secure 6-digit OTP.
   * Enforces 60-second cooldown and 10-minute rate limiting.
   */
  static async requestOtp(params: {
    mobile: string;
    purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN';
    ipAddress?: string;
  }) {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();

    // 1. Business purpose validation
    if (params.purpose === 'REGISTRATION') {
      const existingUser = await prisma.user.findUnique({
        where: { mobile: cleanMobile },
      });
      if (existingUser) {
        throw new Error('This mobile number is already registered. Please proceed to login.');
      }
    } else if (params.purpose === 'FORGOT_PASSWORD') {
      const existingUser = await prisma.user.findUnique({
        where: { mobile: cleanMobile },
      });
      if (!existingUser) {
        // Privacy protection: do not reveal account non-existence
        return {
          message: 'If an account is associated with this mobile number, a verification code has been dispatched.',
          cooldownSeconds: 60,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        };
      }
    }

    // 2. Cooldown enforcement: prevent rapid resend within 60 seconds
    const activeCooldown = await prisma.otpRequest.findFirst({
      where: {
        mobile: cleanMobile,
        purpose: params.purpose,
        cooldownUntil: { gt: now },
      },
    });

    if (activeCooldown && activeCooldown.cooldownUntil) {
      const remainingSec = Math.ceil((activeCooldown.cooldownUntil.getTime() - now.getTime()) / 1000);
      throw new Error(`Please wait ${remainingSec} seconds before requesting a new verification code.`);
    }

    // 3. Rate-limiting: max 5 requests per 10 minutes per mobile
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const recentRequests = await prisma.otpRequest.count({
      where: {
        mobile: cleanMobile,
        createdAt: { gt: tenMinutesAgo },
      },
    });

    if (recentRequests >= 5) {
      throw new Error('Too many verification requests. Please try again after 10 minutes.');
    }

    // 4. Generate cryptographically secure OTP & Hash (server-secret-keyed HMAC)
    const otpCode = generateSecureOtp();
    const otpHash = hmacHashOtp(otpCode);
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
    const cooldownUntil = new Date(now.getTime() + 60 * 1000); // 60 seconds

    await prisma.otpRequest.create({
      data: {
        mobile: cleanMobile,
        otpHash,
        purpose: params.purpose,
        expiresAt,
        cooldownUntil,
      },
    });

    // 5. Secure SMS dispatch via configured provider (MSG91 in production)
    const smsResult = await SmsService.sendOtp({
      mobile: cleanMobile,
      otpCode,
    });

    if (!smsResult.success && config.isProduction) {
      throw new Error(`SMS delivery failed: ${smsResult.error || 'Gateway rejected dispatch'}`);
    }


    return {
      message: 'Verification code dispatched successfully to your mobile number.',
      cooldownSeconds: 60,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verifies OTP and returns a short-lived, single-use verificationToken.
   * Stores only the SHA-256 hash of the verification token in PostgreSQL.
   */
  static async verifyOtp(params: {
    mobile: string;
    otpCode: string;
    purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN';
  }) {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);
    const cleanOtp = params.otpCode.trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new Error('Please enter a valid 6-digit verification code.');
    }

    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      // Look up latest unused, non-expired OTP record
      const latest = await tx.otpRequest.findFirst({
        where: {
          mobile: cleanMobile,
          purpose: params.purpose,
          isUsed: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!latest) {
        return {
          success: false,
          message: 'Verification code has expired or is invalid. Please request a new code.',
        };
      }

      // Lock row FOR UPDATE to protect attempt limit against concurrent requests
      await tx.$queryRaw`SELECT "id" FROM "OtpRequest" WHERE "id" = ${latest.id} FOR UPDATE`;

      const record = await tx.otpRequest.findUnique({
        where: { id: latest.id },
      });

      if (!record || record.isUsed || record.expiresAt <= new Date()) {
        return {
          success: false,
          message: 'Verification code has expired or is invalid. Please request a new code.',
        };
      }

      if (record.attemptsCount >= 5) {
        await tx.otpRequest.update({
          where: { id: record.id },
          data: { isUsed: true },
        });
        return {
          success: false,
          message: 'Maximum verification attempts exceeded. Please request a new code.',
        };
      }

      // Verify cryptographic HMAC or SHA-256 hash (backward-compatible)
      const inputHmac = hmacHashOtp(cleanOtp);
      const inputSha = sha256Hash(cleanOtp);
      if (inputHmac !== record.otpHash && inputSha !== record.otpHash) {
        const updated = await tx.otpRequest.update({
          where: { id: record.id },
          data: { attemptsCount: { increment: 1 } },
        });
        if (updated.attemptsCount >= 5) {
          await tx.otpRequest.update({
            where: { id: record.id },
            data: { isUsed: true },
          });
          return {
            success: false,
            message: 'Maximum verification attempts exceeded. Please request a new code.',
          };
        }
        return {
          success: false,
          message: 'Invalid verification code. Please check and try again.',
        };
      }

      // Mark OTP as used atomically
      await tx.otpRequest.update({
        where: { id: record.id },
        data: { isUsed: true },
      });

      // Generate short-lived verificationToken (32 bytes hex)
      const verificationToken = generateSecureToken(32);
      const tokenHash = sha256Hash(verificationToken);
      const tokenExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins

      await tx.verificationToken.create({
        data: {
          mobile: cleanMobile,
          tokenHash,
          purpose: params.purpose,
          isUsed: false,
          expiresAt: tokenExpiresAt,
        },
      });

      return {
        success: true,
        message: 'Code verified successfully.',
        verificationToken,
        expiresAt: tokenExpiresAt.toISOString(),
      };
    });

    if (!txResult.success) {
      throw new Error(txResult.message);
    }

    return {
      message: txResult.message,
      verificationToken: txResult.verificationToken!,
      expiresAt: txResult.expiresAt!,
    };
  }

  /**
   * Consumes registrationVerificationToken and creates user account with structured names.
   * NEVER re-verifies original OTP.
   */
  static async registerUser(params: {
    mobile: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    fullName?: string;
    password: string;
    profession: Profession;
    verificationToken: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);

    const nameValidation = validateStructuredName(
      params.firstName,
      params.middleName,
      params.lastName,
      params.fullName
    );

    if (!nameValidation.isValid) {
      throw new Error(nameValidation.error || 'Please enter a valid first name.');
    }

    if (!params.password || params.password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    if (!['PLUMBER', 'TILE_INSTALLER'].includes(params.profession)) {
      throw new Error('Profession must be either PLUMBER or TILE_INSTALLER.');
    }

    if (!params.verificationToken) {
      throw new Error('Registration verification token is required.');
    }

    // 1. Consume verificationToken (atomic validation)
    const tokenHash = sha256Hash(params.verificationToken);
    const now = new Date();

    // 2. Hash password with bcrypt salt 12
    const passwordHash = await bcrypt.hash(params.password, 12);

    // 3. Create User, Wallet, and AuthSession in transaction with atomic token claim
    const refreshToken = generateSecureToken(40);
    const refreshTokenHash = sha256Hash(refreshToken);
    const sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // 30 days

    const { user, wallet } = await prisma.$transaction(async (tx) => {
      // Atomic single-use claim
      const claim = await tx.verificationToken.updateMany({
        where: {
          tokenHash,
          mobile: cleanMobile,
          purpose: 'REGISTRATION',
          isUsed: false,
          expiresAt: { gt: now },
        },
        data: { isUsed: true },
      });

      if (claim.count !== 1) {
        throw new Error('Invalid or expired registration verification token. Please verify OTP again.');
      }

      // Prevent duplicate user
      const existing = await tx.user.findUnique({
        where: { mobile: cleanMobile },
      });
      if (existing) {
        throw new Error('An account already exists for this mobile number.');
      }
      const newUser = await tx.user.create({
        data: {
          mobile: cleanMobile,
          fullName: nameValidation.fullName,
          firstName: nameValidation.firstName,
          middleName: nameValidation.middleName,
          lastName: nameValidation.lastName,
          isNameLocked: false,
          passwordHash,
          profession: params.profession,
          role: 'USER',
          status: 'ACTIVE',
          isVerified: true,
        },
      });

      const newWallet = await tx.wallet.create({
        data: {
          userId: newUser.id,
          availableBalance: 0.0,
          processingAmount: 0.0,
          totalRedeemed: 0.0,
        },
      });

      await tx.authSession.create({
        data: {
          userId: newUser.id,
          tokenHash: refreshTokenHash,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt: sessionExpiresAt,
        },
      });

      return { user: newUser, wallet: newWallet };
    });

    const accessToken = this.generateAccessToken(user.id, user.role, user.mobile);

    return {
      user: {
        id: user.id,
        mobile: user.mobile,
        fullName: user.fullName,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        isNameLocked: user.isNameLocked,
        profession: user.profession,
        role: user.role,
      },
      wallet: {
        availableBalance: Number(wallet.availableBalance),
        processingAmount: Number(wallet.processingAmount),
        totalRedeemed: Number(wallet.totalRedeemed),
      },
      accessToken,
      refreshToken,
      token: accessToken, // Backwards compatibility for existing clients
    };
  }

  /**
   * Authenticates user, creates rotating refresh session.
   */
  static async login(mobile: string, pass: string, userAgent?: string, ipAddress?: string) {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

    const user = await prisma.user.findUnique({
      where: { mobile: cleanMobile },
      include: { wallet: true },
    });

    if (!user) {
      throw new Error('Invalid mobile number or password.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Your account has been suspended. Please contact customer support.');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid mobile number or password.');
    }

    // Create session
    const refreshToken = generateSecureToken(40);
    const refreshTokenHash = sha256Hash(refreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        userAgent,
        ipAddress,
        expiresAt: sessionExpiresAt,
      },
    });

    const accessToken = this.generateAccessToken(user.id, user.role, user.mobile);

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'USER_LOGIN',
        entityType: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
      },
    });

    return {
      user: {
        id: user.id,
        mobile: user.mobile,
        fullName: user.fullName,
        profession: user.profession,
        role: user.role,
      },
      wallet: user.wallet
        ? {
            availableBalance: Number(user.wallet.availableBalance),
            processingAmount: Number(user.wallet.processingAmount),
            totalRedeemed: Number(user.wallet.totalRedeemed),
          }
        : { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 },
      accessToken,
      refreshToken,
      token: accessToken,
    };
  }

  /**
   * Rotates refresh token and issues new access token.
   * Detects replay attacks and revokes compromised session trees.
   */
  static async refreshToken(refreshTokenStr: string, userAgent?: string, ipAddress?: string) {
    if (!refreshTokenStr) {
      throw new Error('Refresh token is required.');
    }

    const tokenHash = sha256Hash(refreshTokenStr);
    const session = await prisma.authSession.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      throw new Error('Invalid refresh token.');
    }

    // Replay attack detection: if token is already revoked, revoke all user sessions!
    if (session.revokedAt) {
      await prisma.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new Error('Compromised or reused refresh token detected. All active sessions have been revoked.');
    }

    if (session.expiresAt < new Date()) {
      throw new Error('Refresh token has expired. Please login again.');
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user || user.status === 'SUSPENDED') {
      throw new Error('User account is invalid or suspended.');
    }

    // Token Rotation with atomic claim
    const newRefreshToken = generateSecureToken(40);
    const newRefreshTokenHash = sha256Hash(newRefreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    const rotatedSession = await prisma.$transaction(async (tx) => {
      // Conditionally claim the session only if it is still active
      const claim = await tx.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });

      if (claim.count !== 1) {
        return null;
      }

      return await tx.authSession.create({
        data: {
          userId: user.id,
          tokenHash: newRefreshTokenHash,
          userAgent,
          ipAddress,
          rotatedFrom: session.id,
          expiresAt: sessionExpiresAt,
        },
      });
    });

    if (!rotatedSession) {
      throw new Error('Refresh token has already been rotated or revoked.');
    }

    const newAccessToken = this.generateAccessToken(user.id, user.role, user.mobile);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: newAccessToken,
    };
  }

  /**
   * Revokes refresh token on user logout.
   */
  static async logout(refreshTokenStr: string) {
    if (!refreshTokenStr) return;
    const tokenHash = sha256Hash(refreshTokenStr);
    await prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Real backend password reset consuming verificationToken.
   * Revokes all active sessions for security.
   */
  static async completePasswordReset(params: {
    mobile: string;
    verificationToken: string;
    newPassword: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);

    if (!params.newPassword || params.newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long.');
    }

    const tokenHash = sha256Hash(params.verificationToken);
    const now = new Date();
    const newHash = await bcrypt.hash(params.newPassword, 12);

    await prisma.$transaction(async (tx) => {
      const claim = await tx.verificationToken.updateMany({
        where: {
          mobile: cleanMobile,
          tokenHash,
          purpose: 'FORGOT_PASSWORD',
          isUsed: false,
          expiresAt: { gt: now },
        },
        data: { isUsed: true },
      });

      if (claim.count !== 1) {
        throw new Error('Invalid or expired password reset token. Please verify OTP again.');
      }

      const user = await tx.user.findUnique({
        where: { mobile: cleanMobile },
      });

      if (!user) {
        throw new Error('User not found.');
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });

      // Revoke all active sessions
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          action: 'PASSWORD_RESET',
          entityType: 'User',
          entityId: user.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          newValue: 'Password reset via verified OTP token. All sessions revoked.',
        },
      });
    });

    return {
      message: 'Password reset successfully. Please log in with your new password.',
    };
  }

  /**
   * User updates their own name in Account Settings prior to PAN identity verification lock.
   */
  static async updateUserName(userId: string, params: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    fullName?: string;
  }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found.');

    if (user.isNameLocked) {
      throw new Error('Your name is locked following identity verification. Please contact an administrator for any corrections.');
    }

    const val = validateStructuredName(params.firstName, params.middleName, params.lastName, params.fullName);
    if (!val.isValid) {
      throw new Error(val.error || 'Please enter a valid first name.');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: val.firstName,
        middleName: val.middleName,
        lastName: val.lastName,
        fullName: val.fullName,
      },
    });

    return {
      id: updated.id,
      fullName: updated.fullName,
      firstName: updated.firstName,
      middleName: updated.middleName,
      lastName: updated.lastName,
      isNameLocked: updated.isNameLocked,
    };
  }

  /**
   * Privileged administrator updates user name with required reason and comprehensive audit trail.
   * Enforces re-verification policy by resetting KYC nameMatched flag.
   */
  static async adminUpdateUserName(params: {
    userId: string;
    adminId: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    fullName?: string;
    reason: string;
    ipAddress?: string;
  }) {
    if (!params.reason || !params.reason.trim()) {
      throw new Error('A specific justification reason is mandatory for administrator name correction.');
    }

    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { kycRecords: true },
    });
    if (!user) throw new Error('User not found.');

    const val = validateStructuredName(params.firstName, params.middleName, params.lastName, params.fullName);
    if (!val.isValid) {
      throw new Error(val.error || 'Please enter a valid first name.');
    }

    const oldFullName = user.fullName;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update user name and unlock for re-verification
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          firstName: val.firstName,
          middleName: val.middleName,
          lastName: val.lastName,
          fullName: val.fullName,
          isNameLocked: false,
          nameLockedAt: null,
        },
      });

      // 2. Reset KYC nameMatched flag to enforce re-match policy before next payout
      await tx.kycRecord.updateMany({
        where: { userId: user.id },
        data: { nameMatched: false },
      });

      // 3. Create comprehensive immutable Audit Log
      await tx.auditLog.create({
        data: {
          adminId: params.adminId,
          action: 'ADMIN_NAME_CORRECTION',
          entityType: 'User',
          entityId: user.id,
          oldValue: JSON.stringify({
            fullName: oldFullName,
            firstName: user.firstName,
            lastName: user.lastName,
          }),
          newValue: JSON.stringify({
            fullName: val.fullName,
            firstName: val.firstName,
            lastName: val.lastName,
            reason: params.reason.trim(),
          }),
          ipAddress: params.ipAddress,
        },
      });

      return updatedUser;
    });

    return {
      id: result.id,
      fullName: result.fullName,
      firstName: result.firstName,
      middleName: result.middleName,
      lastName: result.lastName,
      isNameLocked: result.isNameLocked,
    };
  }

  private static generateAccessToken(userId: string, role: UserRole, mobile: string): string {
    return jwt.sign(
      { userId, role, mobile },
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiresIn as any }
    );
  }
}
