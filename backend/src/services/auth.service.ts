import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config, normalizeAdminPrefix } from '../config';
import {
  generateSecureOtp,
  sha256Hash,
  generateSecureToken,
  hmacHashOtp,
} from '../utils/crypto.utils';
import { validateStructuredName } from '../utils/name.utils';
import { UserRole, Profession, OtpPurpose } from '@prisma/client';
import { SmsService } from './sms';

export function normalizeStrictIndianMobile(identifier: string): string | null {
  if (!identifier || typeof identifier !== 'string') return null;
  const trimmed = identifier.trim();
  if (/^[6-9]\d{9}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\+91[6-9]\d{9}$/.test(trimmed)) {
    return trimmed.slice(3);
  }
  if (/^91[6-9]\d{9}$/.test(trimmed)) {
    return trimmed.slice(2);
  }
  if (/^0[6-9]\d{9}$/.test(trimmed)) {
    return trimmed.slice(1);
  }
  return null;
}

export class AuthService {
  /**
   * Checks whether an identifier matches any server-configured administrator prefix
   * followed by an exact 10-digit mobile number.
   */
  static isConfiguredAdminPrefix(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') return false;
    const cleanRaw = identifier.trim().toUpperCase();
    const billPrefix = normalizeAdminPrefix(config.admin.billAdminPrefix);
    const opsPrefix = normalizeAdminPrefix(config.admin.operationsAdminPrefix);

    if (billPrefix && cleanRaw.startsWith(billPrefix)) {
      const remainder = cleanRaw.slice(billPrefix.length);
      return /^[6-9]\d{9}$/.test(remainder);
    }
    if (opsPrefix && cleanRaw.startsWith(opsPrefix)) {
      const remainder = cleanRaw.slice(opsPrefix.length);
      return /^[6-9]\d{9}$/.test(remainder);
    }
    return false;
  }

  /**
   * Resolves an admin identifier with prefix (e.g. XYZ9876543210 or ABC9876543210)
   * to designated role ('BILL_ADMIN' or 'OPERATIONS_ADMIN') and 10-digit mobile number.
   */
  static resolveAdminIdentifier(identifier: string): { role: UserRole; mobile: string } {
    if (!identifier || typeof identifier !== 'string') {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const cleanRaw = identifier.trim().toUpperCase();
    const billPrefix = normalizeAdminPrefix(config.admin.billAdminPrefix);
    const opsPrefix = normalizeAdminPrefix(config.admin.operationsAdminPrefix);

    if (billPrefix && cleanRaw.startsWith(billPrefix)) {
      const remainder = cleanRaw.slice(billPrefix.length);
      if (!/^[6-9]\d{9}$/.test(remainder)) {
        throw new Error('Invalid Bill Admin identifier format. Must be prefix followed by 10-digit mobile.');
      }
      return { role: 'BILL_ADMIN', mobile: remainder };
    }

    if (opsPrefix && cleanRaw.startsWith(opsPrefix)) {
      const remainder = cleanRaw.slice(opsPrefix.length);
      if (!/^[6-9]\d{9}$/.test(remainder)) {
        throw new Error('Invalid Operations Admin identifier format. Must be prefix followed by 10-digit mobile.');
      }
      return { role: 'OPERATIONS_ADMIN', mobile: remainder };
    }

    throw new Error('Invalid login credentials. Please check your details and try again.');
  }

  /**
   * Universal password-first authentication handler.
   * - Validates credentials against password hash BEFORE generating challenges or dispatching OTPs.
   * - Craftsman (USER) credentials return immediate authenticated session.
   * - Configured Admin credentials create and dispatch single-purpose OTP challenge.
   * - Invalid formats, prefixes, or credentials fail closed with generic error (no role enumeration).
   */
  static async authenticatePasswordFirst(params: {
    identifier: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const rawIdentifier = (params.identifier || '').trim();
    const password = params.password || '';

    if (!rawIdentifier || !password) {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    // 1. Silent backend classification: check if identifier matches configured admin prefix
    if (this.isConfiguredAdminPrefix(rawIdentifier)) {
      // Flow B: Valid administrator candidate.
      // Sequence: Validate administrator password FIRST before generating OTP challenge.
      const result = await this.requestAdminOtp({
        identifier: rawIdentifier,
        password,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });

      const { role, mobile } = this.resolveAdminIdentifier(rawIdentifier);
      const maskedMobile = `***${mobile.slice(-4)}`;

      return {
        kind: 'ADMIN_OTP_REQUIRED' as const,
        challengeId: result.challengeToken,
        challengeToken: result.challengeToken,
        requiresOtp: true as const,
        role,
        mobileMasked: maskedMobile,
        message: result.message,
        cooldownSeconds: result.cooldownSeconds,
        expiresAt: result.expiresAt,
      };
    }

    // 2. Reject arbitrary words or unrecognized prefixes without role enumeration
    if (/[a-zA-Z]/.test(rawIdentifier)) {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    // 3. Flow A: Ordinary 10-digit mobile number craftsman user login
    const cleanMobile = normalizeStrictIndianMobile(rawIdentifier);
    if (!cleanMobile) {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const session = await this.login(cleanMobile, password, params.userAgent, params.ipAddress);

    return {
      kind: 'USER_AUTHENTICATED' as const,
      session,
    };
  }

  /**
   * Requests an admin OTP for prefix-based identifier.
   * Requires administrator password. Verifies credentials FIRST before issuing challenge/OTP.
   * Ensures account exists with the designated role, enforces cooldown & rate limits,
   * invalidates prior unused ADMIN_LOGIN OTPs, and uses configured OTP TTL (<= 300s).
   */
  static async requestAdminOtp(params: {
    identifier: string;
    password?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (!params.password || typeof params.password !== 'string' || !params.password.trim()) {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const { role, mobile } = this.resolveAdminIdentifier(params.identifier);

    const admin = await prisma.user.findFirst({
      where: { mobile, role: role as UserRole },
    });

    if (!admin || admin.status !== 'ACTIVE') {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const isMatch = await bcrypt.compare(params.password, admin.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const now = new Date();

    // 1. Cooldown enforcement (60 seconds)
    const activeCooldown = await prisma.otpRequest.findFirst({
      where: {
        mobile,
        purpose: 'ADMIN_LOGIN',
        cooldownUntil: { gt: now },
      },
    });

    if (activeCooldown && activeCooldown.cooldownUntil) {
      const remainingSec = Math.ceil((activeCooldown.cooldownUntil.getTime() - now.getTime()) / 1000);
      throw new Error(`Please wait ${remainingSec} seconds before requesting a new admin verification code.`);
    }

    // 2. Rate-limiting: max 5 requests per 10 minutes
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const recentRequests = await prisma.otpRequest.count({
      where: {
        mobile,
        purpose: 'ADMIN_LOGIN',
        createdAt: { gt: tenMinutesAgo },
      },
    });

    if (recentRequests >= 5) {
      throw new Error('Too many verification requests. Please try again after 10 minutes.');
    }

    // 3. Invalidate earlier unused ADMIN_LOGIN OTPs for this mobile
    await prisma.otpRequest.updateMany({
      where: {
        mobile,
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
      },
      data: { isUsed: true },
    });

    // 4. Generate cryptographically secure OTP & Hash
    const otpCode = generateSecureOtp();
    const otpHash = hmacHashOtp(otpCode);
    const ttlMs = config.otp.ttlSeconds * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const cooldownUntil = new Date(now.getTime() + 60 * 1000);

    await prisma.otpRequest.create({
      data: {
        mobile,
        otpHash,
        purpose: 'ADMIN_LOGIN',
        expiresAt,
        cooldownUntil,
      },
    });

    // 5. Generate and store pre-auth challenge token
    const challengeToken = generateSecureToken(32);
    const challengeTokenHash = sha256Hash(challengeToken);
    const challengeExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

    await prisma.verificationToken.updateMany({
      where: {
        mobile,
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
      },
      data: { isUsed: true },
    });

    await prisma.verificationToken.create({
      data: {
        mobile,
        tokenHash: challengeTokenHash,
        purpose: 'ADMIN_LOGIN',
        isUsed: false,
        expiresAt: challengeExpiresAt,
      },
    });

    // 6. Dispatch SMS
    const smsResult = await SmsService.sendOtp({
      mobile,
      otpCode,
    });

    if (!smsResult.success && config.isProduction) {
      throw new Error(`SMS delivery failed: ${smsResult.error || 'Gateway rejected dispatch'}`);
    }

    return {
      message: 'Admin verification code dispatched successfully to your registered mobile number.',
      cooldownSeconds: 60,
      expiresAt: expiresAt.toISOString(),
      role,
      requireOtp: true,
      challengeToken,
      verificationToken: challengeToken,
    };
  }

  /**
   * Verifies an admin OTP and pre-auth challengeToken.
   * Atomically consumes both OTP and challenge, enforces SINGLE ACTIVE SESSION,
   * invalidates prior sessions, and issues role-specific JWT.
   */
  static async verifyAdminOtp(params: {
    identifier: string;
    otpCode: string;
    challengeToken?: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const { role, mobile } = this.resolveAdminIdentifier(params.identifier);
    const cleanOtp = (params.otpCode || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new Error('Please enter a valid 6-digit verification code.');
    }

    const activeChallenge = params.challengeToken;
    if (!activeChallenge || typeof activeChallenge !== 'string' || !activeChallenge.trim()) {
      throw new Error('Invalid or expired login challenge. Please sign in again.');
    }

    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Verify that the challenge token is valid and unexpired without prematurely consuming it
      const cHash = sha256Hash(activeChallenge);
      const challengeRecord = await tx.verificationToken.findFirst({
        where: {
          tokenHash: cHash,
          mobile,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: { gt: now },
        },
      });

      if (!challengeRecord) {
        return {
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        };
      }

      const latest = await tx.otpRequest.findFirst({
        where: {
          mobile,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!latest) {
        return {
          success: false,
          message: 'Admin verification code has expired or is invalid. Please request a new code.',
        };
      }

      await tx.$queryRaw`SELECT "id" FROM "OtpRequest" WHERE "id" = ${latest.id} FOR UPDATE`;

      const record = await tx.otpRequest.findUnique({
        where: { id: latest.id },
      });

      if (!record || record.isUsed || record.expiresAt <= new Date()) {
        return {
          success: false,
          message: 'Admin verification code has expired or is invalid. Please request a new code.',
        };
      }

      if (record.attemptsCount >= 5) {
        await tx.otpRequest.update({
          where: { id: record.id },
          data: { isUsed: true },
        });
        await tx.verificationToken.updateMany({
          where: { id: challengeRecord.id },
          data: { isUsed: true },
        });
        return {
          success: false,
          message: 'Maximum verification attempts exceeded. Please request a new code.',
        };
      }

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
          await tx.verificationToken.updateMany({
            where: { id: challengeRecord.id },
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

      // 2. OTP is verified! Atomically consume both the OTP and the pre-auth challenge
      await tx.otpRequest.update({
        where: { id: record.id },
        data: { isUsed: true },
      });

      const claim = await tx.verificationToken.updateMany({
        where: {
          id: challengeRecord.id,
          isUsed: false,
        },
        data: { isUsed: true },
      });

      if (claim.count !== 1) {
        return {
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        };
      }

      const adminUser = await tx.user.findFirst({
        where: { mobile, role: role as UserRole },
      });

      if (!adminUser || adminUser.status !== 'ACTIVE') {
        return {
          success: false,
          message: 'Admin account is suspended or not found.',
        };
      }

      const sessionId = crypto.randomUUID();

      await tx.authSession.updateMany({
        where: { userId: adminUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.user.update({
        where: { id: adminUser.id },
        data: { activeSessionId: sessionId },
      });

      const sessionToken = generateSecureToken(40);
      const sessionTokenHash = sha256Hash(sessionToken);
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

      await tx.authSession.create({
        data: {
          userId: adminUser.id,
          sessionId,
          tokenHash: sessionTokenHash,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId: adminUser.id,
          action: 'ADMIN_LOGIN',
          entityType: 'User',
          entityId: adminUser.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          newValue: `Administrator authenticated via verified OTP challenge for role ${adminUser.role}.`,
        },
      });

      return {
        success: true,
        message: 'Admin verification code verified successfully.',
        adminUser,
        sessionId,
      };
    });

    if (!txResult.success) {
      throw new Error(txResult.message);
    }

    const accessToken = jwt.sign(
      {
        userId: txResult.adminUser!.id,
        role: txResult.adminUser!.role,
        mobile: txResult.adminUser!.mobile,
        sessionId: txResult.sessionId,
      },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: (config.admin.accessTokenExpiresIn || '1d') as any }
    );

    return {
      success: true,
      message: txResult.message,
      verificationToken: activeChallenge,
      token: accessToken,
      accessToken,
      user: {
        id: txResult.adminUser!.id,
        mobile: txResult.adminUser!.mobile,
        fullName: txResult.adminUser!.fullName,
        role: txResult.adminUser!.role,
      },
      sessionId: txResult.sessionId,
      role,
    };
  }

  /**
   * Completes Admin Login with identifier, challenge verificationToken, and password.
   * Atomically consumes challenge token, verifies password, enforces SINGLE ACTIVE SESSION,
   * invalidates prior sessions, and issues role-specific JWT.
   */
  static async loginAdmin(params: {
    identifier: string;
    password: string;
    verificationToken: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const { role, mobile } = this.resolveAdminIdentifier(params.identifier);

    if (!params.password) {
      throw new Error('Admin password is required.');
    }

    if (!params.verificationToken) {
      throw new Error('Admin verification challenge token is required. Please verify OTP first.');
    }

    const tokenHash = sha256Hash(params.verificationToken);
    const now = new Date();

    const admin = await prisma.$transaction(async (tx) => {
      // 1. Atomically consume verification challenge
      const claim = await tx.verificationToken.updateMany({
        where: {
          tokenHash,
          mobile,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: { gt: now },
        },
        data: { isUsed: true },
      });

      if (claim.count !== 1) {
        throw new Error('Invalid or expired admin verification challenge token. Please verify OTP again.');
      }

      // 2. Fetch admin user
      const adminUser = await tx.user.findFirst({
        where: { mobile, role: role as UserRole },
      });

      if (!adminUser) {
        throw new Error('Admin account not found for this identifier.');
      }

      if (adminUser.status !== 'ACTIVE') {
        throw new Error('Admin account is suspended. Please contact system support.');
      }

      const isMatch = await bcrypt.compare(params.password, adminUser.passwordHash);
      if (!isMatch) {
        throw new Error('Invalid admin credentials.');
      }

      // 3. Single active session: generate new sessionId and invalidate previous sessions
      const sessionId = crypto.randomUUID();

      await tx.authSession.updateMany({
        where: { userId: adminUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.user.update({
        where: { id: adminUser.id },
        data: { activeSessionId: sessionId },
      });

      const sessionToken = generateSecureToken(40);
      const sessionTokenHash = sha256Hash(sessionToken);
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000); // 1 day

      await tx.authSession.create({
        data: {
          userId: adminUser.id,
          sessionId,
          tokenHash: sessionTokenHash,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId: adminUser.id,
          action: 'ADMIN_LOGIN',
          entityType: 'User',
          entityId: adminUser.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          newValue: `Administrator authenticated via verified OTP challenge for role ${adminUser.role}.`,
        },
      });

      return { adminUser, sessionId };
    });

    const accessToken = jwt.sign(
      {
        userId: admin.adminUser.id,
        role: admin.adminUser.role,
        mobile: admin.adminUser.mobile,
        sessionId: admin.sessionId,
      },
      config.admin.accessSecret,
      { expiresIn: config.admin.accessTokenExpiresIn as any }
    );

    return {
      user: {
        id: admin.adminUser.id,
        mobile: admin.adminUser.mobile,
        fullName: admin.adminUser.fullName,
        role: admin.adminUser.role,
      },
      accessToken,
      token: accessToken,
      sessionId: admin.sessionId,
    };
  }

  /**
   * Generates and dispatches cryptographically secure 6-digit OTP.
   * Enforces 60-second cooldown, 10-minute rate limiting, and OTP TTL <= 300s.
   */
  static async requestOtp(params: {
    mobile: string;
    purpose: OtpPurpose | 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN' | 'ADMIN_LOGIN';
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
        const ttlMs = config.otp.ttlSeconds * 1000;
        return {
          message: 'If an account is associated with this mobile number, a verification code has been dispatched.',
          cooldownSeconds: 60,
          expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        };
      }
    }

    // 2. Cooldown enforcement: prevent rapid resend within 60 seconds
    const activeCooldown = await prisma.otpRequest.findFirst({
      where: {
        mobile: cleanMobile,
        purpose: params.purpose as OtpPurpose,
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
    const ttlMs = config.otp.ttlSeconds * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const cooldownUntil = new Date(now.getTime() + 60 * 1000);

    await prisma.otpRequest.create({
      data: {
        mobile: cleanMobile,
        otpHash,
        purpose: params.purpose as OtpPurpose,
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
    purpose: OtpPurpose | 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN' | 'ADMIN_LOGIN';
  }) {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);
    const cleanOtp = (params.otpCode || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new Error('Please enter a valid 6-digit verification code.');
    }

    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      // Look up latest unused, non-expired OTP record
      const latest = await tx.otpRequest.findFirst({
        where: {
          mobile: cleanMobile,
          purpose: params.purpose as OtpPurpose,
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
          purpose: params.purpose as OtpPurpose,
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
   * Enforces SINGLE ACTIVE SESSION upon registration.
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

    // 3. Single active session ID
    const sessionId = crypto.randomUUID();
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
          activeSessionId: sessionId,
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
          sessionId,
          tokenHash: refreshTokenHash,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt: sessionExpiresAt,
        },
      });

      return { user: newUser, wallet: newWallet };
    });

    const accessToken = this.generateAccessToken(user.id, user.role, user.mobile, sessionId);

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
      sessionId,
    };
  }

  /**
   * Authenticates user, creates rotating refresh session, and enforces SINGLE ACTIVE SESSION.
   * Subsequent login replaces and invalidates previous session immediately.
   */
  static async login(mobile: string, pass: string, userAgent?: string, ipAddress?: string) {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

    const user = await prisma.user.findFirst({
      where: { mobile: cleanMobile, role: 'USER' },
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

    // Single active session: generate new sessionId and invalidate previous sessions
    const sessionId = crypto.randomUUID();
    const refreshToken = generateSecureToken(40);
    const refreshTokenHash = sha256Hash(refreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await prisma.$transaction(async (tx) => {
      // Invalidate all existing sessions for this user
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Update activeSessionId on user
      await tx.user.update({
        where: { id: user.id },
        data: { activeSessionId: sessionId },
      });

      // Create new session
      await tx.authSession.create({
        data: {
          userId: user.id,
          sessionId,
          tokenHash: refreshTokenHash,
          userAgent,
          ipAddress,
          expiresAt: sessionExpiresAt,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'USER_LOGIN',
          entityType: 'User',
          entityId: user.id,
          ipAddress,
          userAgent,
        },
      });
    });

    const accessToken = this.generateAccessToken(user.id, user.role, user.mobile, sessionId);

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
      sessionId,
    };
  }

  /**
   * Rotates refresh token and issues new access token.
   * Enforces single active session continuity and detects replay attacks.
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
      await prisma.user.update({
        where: { id: session.userId },
        data: { activeSessionId: null },
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

    if (user.role !== 'USER') {
      throw new Error('Administrator sessions cannot be refreshed via public user token refresh.');
    }

    // Single active session enforcement: check if session matches user.activeSessionId
    if (user.activeSessionId && session.sessionId && session.sessionId !== user.activeSessionId) {
      throw new Error('Session has been invalidated by a newer login. Please log in again.');
    }

    // Token Rotation with atomic claim
    const newRefreshToken = generateSecureToken(40);
    const newRefreshTokenHash = sha256Hash(newRefreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const currentSessionId = session.sessionId || user.activeSessionId || crypto.randomUUID();

    const rotatedSession = await prisma.$transaction(async (tx) => {
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
          sessionId: currentSessionId,
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

    const newAccessToken = this.generateAccessToken(user.id, user.role, user.mobile, currentSessionId);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: newAccessToken,
      sessionId: currentSessionId,
    };
  }

  /**
   * Revokes user session(s) on logout, clearing activeSessionId immediately.
   */
  static async logout(refreshTokenStr?: string, userId?: string) {
    if (refreshTokenStr) {
      const tokenHash = sha256Hash(refreshTokenStr);
      const session = await prisma.authSession.findUnique({
        where: { tokenHash },
      });
      if (session) {
        await prisma.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await prisma.user.update({
          where: { id: session.userId },
          data: { activeSessionId: null },
        });
        return;
      }
    }

    if (userId) {
      await prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { activeSessionId: null },
      });
    }
  }

  /**
   * Real backend password reset consuming verificationToken.
   * Revokes all active sessions and clears activeSessionId for security.
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
        data: { passwordHash: newHash, activeSessionId: null },
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

  private static generateAccessToken(userId: string, role: UserRole, mobile: string, sessionId?: string): string {
    const payload: any = { userId, role, mobile };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return jwt.sign(
      payload,
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiresIn as any }
    );
  }
}
