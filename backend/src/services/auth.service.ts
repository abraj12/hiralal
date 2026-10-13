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
import { UserRole, Profession, OtpPurpose, Prisma } from '@prisma/client';
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

export const GENERIC_OTP_PURPOSES = new Set<string>([
  'REGISTRATION',
  'LOGIN',
  'FORGOT_PASSWORD',
  'ACCOUNT_DELETION',
]);

export type GenericOtpPurpose = 'REGISTRATION' | 'LOGIN' | 'FORGOT_PASSWORD' | 'ACCOUNT_DELETION';

export function requireGenericOtpPurpose(value: unknown): GenericOtpPurpose {
  if (typeof value !== 'string' || !GENERIC_OTP_PURPOSES.has(value)) {
    throw new Error('Invalid OTP purpose. Purpose is required and must be an authorized worker purpose.');
  }
  return value as GenericOtpPurpose;
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
   * Concurrency-safe atomic recording of failed password attempt using PostgreSQL UPDATE expression.
   * Atomically increments failedPasswordAttempts and sets lockedUntil if threshold is reached.
   */
  static async recordFailedPasswordAttempt(userId: string, tx: any = prisma): Promise<{
    failedPasswordAttempts: number;
    lockedUntil: Date | null;
    isLocked: boolean;
  }> {
    const maxFailedAttempts = config.auth?.maxFailedAttempts || 10;
    const lockoutSeconds = config.authLockoutSeconds || config.auth?.lockoutSeconds || 900;

    const updatedRows = await tx.$queryRaw<
      Array<{
        failedPasswordAttempts: number;
        lockedUntil: Date | null;
        isLocked: boolean;
      }>
    >`
      WITH clock AS (
        SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
      )
      UPDATE "User" u
      SET
        "failedPasswordAttempts" = u."failedPasswordAttempts" + 1,
        "lockedUntil" = CASE
          WHEN u."failedPasswordAttempts" + 1 >= ${maxFailedAttempts}
            AND (u."lockedUntil" IS NULL OR u."lockedUntil" <= clock.now)
          THEN clock.now + (${lockoutSeconds} * INTERVAL '1 second')
          ELSE u."lockedUntil"
        END,
        "updatedAt" = clock.now
      FROM clock
      WHERE u."id" = ${userId}
      RETURNING
        u."failedPasswordAttempts",
        u."lockedUntil",
        (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > clock.now) AS "isLocked"
    `;

    if (!updatedRows || updatedRows.length !== 1) {
      throw new Error('Failed to record authentication failure safely.');
    }

    const { failedPasswordAttempts, lockedUntil, isLocked } = updatedRows[0];
    return { failedPasswordAttempts, lockedUntil, isLocked: Boolean(isLocked) };
  }

  /**
   * Concurrency-safe atomic reset of failed password attempts after successful authentication.
   */
  static async resetFailedPasswordAttempts(userId: string, tx: any = prisma): Promise<void> {
    await tx.$executeRaw`
      UPDATE "User"
      SET
        "failedPasswordAttempts" = 0,
        "lockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${userId}
    `;
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

    if (admin.lockedUntil && new Date(admin.lockedUntil).getTime() > Date.now()) {
      throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
    }

    const isMatch = await bcrypt.compare(params.password, admin.passwordHash);
    if (!isMatch) {
      const lockResult = await AuthService.recordFailedPasswordAttempt(admin.id);
      if (lockResult.isLocked || lockResult.failedPasswordAttempts >= (config.auth?.maxFailedAttempts || 10)) {
        throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
      }
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const txResult = await prisma.$transaction(async (tx) => {
      // Lock admin user row FOR UPDATE using database clock
      const lockedRows = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        passwordHash: string;
        failedPasswordAttempts: number;
        lockedUntil: Date | null;
        isLocked: boolean;
        now: Date;
      }>>`
        WITH clock AS (
          SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
        )
        SELECT
          u."id",
          u."status",
          u."passwordHash",
          u."failedPasswordAttempts",
          u."lockedUntil",
          (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > clock.now) AS "isLocked",
          clock.now AS "now"
        FROM "User" u, clock
        WHERE u."id" = ${admin.id}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('Invalid login credentials. Please check your details and try again.');
      }
      const lockedAdmin = lockedRows[0];
      const now = lockedAdmin.now;

      // Stale password / credentials recheck under row lock
      if (lockedAdmin.passwordHash !== admin.passwordHash || lockedAdmin.status !== 'ACTIVE') {
        throw new Error('Invalid login credentials. Please check your details and try again.');
      }

      // Recheck lockout state under row lock: racing failed attempts establish lockout!
      if (lockedAdmin.isLocked) {
        throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
      }

      // 1. Cooldown enforcement (60 seconds)
      const activeCooldown = await tx.otpRequest.findFirst({
        where: {
          mobile,
          purpose: 'ADMIN_LOGIN',
          cooldownUntil: { gt: new Date() },
        },
      });

      if (activeCooldown && activeCooldown.cooldownUntil) {
        const remainingSec = Math.max(
          1,
          Math.ceil((activeCooldown.cooldownUntil.getTime() - Date.now()) / 1000)
        );
        throw new Error(`Please wait ${remainingSec} seconds before requesting a new admin verification code.`);
      }

      // 2. Rate-limiting: max 5 requests per 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentRequests = await tx.otpRequest.count({
        where: {
          mobile,
          purpose: 'ADMIN_LOGIN',
          createdAt: { gt: tenMinutesAgo },
        },
      });

      if (recentRequests >= 5) {
        throw new Error('Too many verification requests. Please try again after 10 minutes.');
      }

      // 3. Reset failed attempts under row lock since password matched and account is not locked
      if (lockedAdmin.failedPasswordAttempts > 0 || lockedAdmin.lockedUntil) {
        await tx.$executeRaw`
          UPDATE "User"
          SET
            "failedPasswordAttempts" = 0,
            "lockedUntil" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${admin.id}
        `;
      }

      // 4. Invalidate earlier unused ADMIN_LOGIN OTPs and VerificationTokens for this mobile
      await tx.otpRequest.updateMany({
        where: {
          mobile,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
        },
        data: { isUsed: true },
      });

      await tx.verificationToken.updateMany({
        where: {
          mobile,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
        },
        data: { isUsed: true },
      });

      // 5. Generate cryptographically secure OTP & Hash
      const otpCode = generateSecureOtp();
      const otpHash = hmacHashOtp(otpCode);
      const ttlMs = config.otp.ttlSeconds * 1000;
      const nowJs = new Date();
      const expiresAt = new Date(nowJs.getTime() + ttlMs);
      const cooldownUntil = new Date(nowJs.getTime() + 60 * 1000);

      await tx.otpRequest.create({
        data: {
          mobile,
          otpHash,
          purpose: 'ADMIN_LOGIN',
          expiresAt,
          cooldownUntil,
        },
      });

      // 6. Generate and store pre-auth challenge token
      const challengeToken = generateSecureToken(32);
      const challengeTokenHash = sha256Hash(challengeToken);
      const challengeExpiresAt = new Date(new Date(now).getTime() + 10 * 60 * 1000); // 10 minutes

      await tx.verificationToken.create({
        data: {
          mobile,
          tokenHash: challengeTokenHash,
          purpose: 'ADMIN_LOGIN',
          isUsed: false,
          expiresAt: challengeExpiresAt,
        },
      });

      return {
        otpCode,
        challengeToken,
        expiresAt: expiresAt.toISOString(),
      };
    });

    // 7. Dispatch SMS outside transaction
    const smsResult = await SmsService.sendOtp({
      mobile,
      otpCode: txResult.otpCode,
    });

    if (!smsResult.success && config.isProduction) {
      throw new Error(`SMS delivery failed: ${smsResult.error || 'Gateway rejected dispatch'}`);
    }

    return {
      message: 'Admin verification code dispatched successfully to your registered mobile number.',
      cooldownSeconds: 60,
      expiresAt: txResult.expiresAt,
      role,
      requireOtp: true,
      challengeToken: txResult.challengeToken,
      verificationToken: txResult.challengeToken,
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

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Acquire PostgreSQL row lock on administrator User account first (enforcing consistent lock order)
      const lockedAdmins = await tx.$queryRaw<Array<{
        id: string;
        mobile: string;
        fullName: string;
        role: string;
        status: string;
        failedPasswordAttempts: number;
        lockedUntil: Date | null;
        isLocked: boolean;
      }>>`
        WITH clock AS (
          SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
        )
        SELECT
          u."id",
          u."mobile",
          u."fullName",
          u."role",
          u."status",
          u."failedPasswordAttempts",
          u."lockedUntil",
          (
            u."lockedUntil" IS NOT NULL
            AND u."lockedUntil" > clock.now
          ) AS "isLocked"
        FROM "User" u
        CROSS JOIN clock
        WHERE u."mobile" = ${mobile}
          AND u."role" = ${role}::"UserRole"
        FOR UPDATE OF u
      `;

      if (!lockedAdmins || lockedAdmins.length !== 1) {
        return {
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        };
      }

      const lockedAdmin = lockedAdmins[0];

      if (lockedAdmin.status !== 'ACTIVE') {
        return {
          success: false,
          message: 'Administrator account is unavailable.',
        };
      }

      // Check current lockout state under row lock: racing failed attempts establish lockout!
      if (lockedAdmin.isLocked) {
        // Deny authentication. Invalidate outstanding unused ADMIN_LOGIN OTP/challenge records
        await tx.otpRequest.updateMany({
          where: { mobile, purpose: 'ADMIN_LOGIN', isUsed: false },
          data: { isUsed: true },
        });
        await tx.verificationToken.updateMany({
          where: { mobile, purpose: 'ADMIN_LOGIN', isUsed: false },
          data: { isUsed: true },
        });

        return {
          success: false,
          message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.',
        };
      }

      // 2. Verify and lock the challenge token using database clock
      const cHash = sha256Hash(activeChallenge);
      const challengeRows = await tx.$queryRaw<Array<{
        id: string;
        tokenHash: string;
        isUsed: boolean;
        expiresAt: Date;
      }>>`
        SELECT "id", "tokenHash", "isUsed", "expiresAt"
        FROM "VerificationToken"
        WHERE "tokenHash" = ${cHash}
          AND "mobile" = ${mobile}
          AND "purpose" = 'ADMIN_LOGIN'
          AND "isUsed" = false
          AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        LIMIT 1
        FOR UPDATE
      `;

      if (!challengeRows || challengeRows.length === 0) {
        return {
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        };
      }
      const challengeRecord = challengeRows[0];

      // 3. Fetch and lock latest active OTP request using database clock
      const latestRows = await tx.$queryRaw<Array<{
        id: string;
        otpHash: string;
        attemptsCount: number;
        isUsed: boolean;
        expiresAt: Date;
      }>>`
        SELECT "id", "otpHash", "attemptsCount", "isUsed", "expiresAt"
        FROM "OtpRequest"
        WHERE "mobile" = ${mobile}
          AND "purpose" = 'ADMIN_LOGIN'::"OtpPurpose"
          AND "isUsed" = false
          AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `;

      if (!latestRows || latestRows.length === 0) {
        return {
          success: false,
          message: 'Admin verification code has expired or is invalid. Please request a new code.',
        };
      }

      const record = latestRows[0];

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

      // OTP is verified! Atomically consume both the OTP and the pre-auth challenge
      await tx.otpRequest.update({
        where: { id: record.id },
        data: { isUsed: true },
      });

      const claimRows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "VerificationToken"
        SET "isUsed" = true
        WHERE "id" = ${challengeRecord.id}
          AND "isUsed" = false
        RETURNING "id"
      `;

      if (!claimRows || claimRows.length !== 1) {
        return {
          success: false,
          message: 'Invalid or expired login challenge. Please sign in again.',
        };
      }

      const sessionId = crypto.randomUUID();

      await tx.authSession.updateMany({
        where: { userId: lockedAdmin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.user.update({
        where: { id: lockedAdmin.id },
        data: {
          activeSessionId: sessionId,
          failedPasswordAttempts: 0,
          lockedUntil: null,
        },
      });

      const sessionToken = generateSecureToken(40);
      const sessionTokenHash = sha256Hash(sessionToken);
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

      await tx.authSession.create({
        data: {
          userId: lockedAdmin.id,
          sessionId,
          tokenHash: sessionTokenHash,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId: lockedAdmin.id,
          action: 'ADMIN_LOGIN',
          entityType: 'User',
          entityId: lockedAdmin.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          newValue: `Administrator authenticated via verified OTP challenge for role ${lockedAdmin.role}.`,
        },
      });

      return {
        success: true,
        message: 'Admin verification code verified successfully.',
        adminUser: lockedAdmin,
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
   * Generates and dispatches cryptographically secure 6-digit OTP.
   * Enforces 60-second cooldown, 10-minute rate limiting, and OTP TTL <= 300s.
   */
  static async requestOtp(params: {
    mobile: string;
    purpose?: unknown;
    ipAddress?: string;
  }) {
    const validatedPurpose = requireGenericOtpPurpose(params.purpose);
    const cleanMobile = (params.mobile || '').replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();

    // 1. Business purpose validation
    if (validatedPurpose === 'REGISTRATION') {
      const existingUser = await prisma.user.findUnique({
        where: { mobile: cleanMobile },
      });
      if (existingUser) {
        throw new Error('This mobile number is already registered. Please proceed to login.');
      }
    } else if (validatedPurpose === 'FORGOT_PASSWORD') {
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
        purpose: validatedPurpose as OtpPurpose,
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
        purpose: validatedPurpose as OtpPurpose,
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
   * Transaction-aware OTP verification helper.
   * Locks OTP row FOR UPDATE, checks expiry, counts failed attempts, enforces attempt limit,
   * marks successful OTPs as used, and optionally creates a verification token.
   * Returns { success: boolean, message: string, ... } without throwing so failed attempt increments commit.
   */
  static async verifyOtpInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      mobile: string;
      otpCode: string;
      purpose: OtpPurpose | 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN' | 'ADMIN_LOGIN' | 'ACCOUNT_DELETION';
    },
    options?: {
      createVerificationToken?: boolean;
    }
  ): Promise<{
    success: boolean;
    message: string;
    verificationToken?: string;
    expiresAt?: string;
  }> {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);
    const cleanOtp = (params.otpCode || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      return {
        success: false,
        message: 'Please enter a valid 6-digit verification code.',
      };
    }

    if ((params.purpose as string) === 'ADMIN_LOGIN') {
      return {
        success: false,
        message: 'Invalid OTP purpose for worker verification.',
      };
    }

    // Look up latest unused, non-expired OTP record using database clock with row-level lock
    const latestRows = await tx.$queryRaw<Array<{
      id: string;
      otpHash: string;
      attemptsCount: number;
      isUsed: boolean;
      expiresAt: Date;
    }>>`
      SELECT "id", "otpHash", "attemptsCount", "isUsed", "expiresAt"
      FROM "OtpRequest"
      WHERE "mobile" = ${cleanMobile}
        AND "purpose" = ${params.purpose}::"OtpPurpose"
        AND "isUsed" = false
        AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    if (!latestRows || latestRows.length === 0) {
      return {
        success: false,
        message: 'Verification code has expired or is invalid. Please request a new code.',
      };
    }

    const record = latestRows[0];

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

    const shouldCreateToken = options?.createVerificationToken !== false;
    if (!shouldCreateToken) {
      return {
        success: true,
        message: 'Code verified successfully.',
      };
    }

    // Generate short-lived verificationToken (32 bytes hex)
    const verificationToken = generateSecureToken(32);
    const tokenHash = sha256Hash(verificationToken);
    const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

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
  }

  /**
   * Verifies OTP and returns a short-lived, single-use verificationToken.
   * Stores only the SHA-256 hash of the verification token in PostgreSQL.
   */
  static async verifyOtp(params: {
    mobile: string;
    otpCode: string;
    purpose?: unknown;
  }) {
    const validatedPurpose = requireGenericOtpPurpose(params.purpose);
    const cleanOtp = (params.otpCode || '').trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new Error('Please enter a valid 6-digit verification code.');
    }

    const txResult = await prisma.$transaction(async (tx) => {
      return this.verifyOtpInTransaction(
        tx,
        {
          mobile: params.mobile,
          otpCode: cleanOtp,
          purpose: validatedPurpose as OtpPurpose,
        },
        { createVerificationToken: true }
      );
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
      // Atomic single-use claim using database clock and row lock
      const targetRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "VerificationToken"
        WHERE "tokenHash" = ${tokenHash}
          AND "mobile" = ${cleanMobile}
          AND "purpose" = 'REGISTRATION'
          AND "isUsed" = false
          AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        LIMIT 1
        FOR UPDATE
      `;

      if (!targetRows || targetRows.length !== 1) {
        throw new Error('Invalid or expired registration verification token. Please verify OTP again.');
      }

      await tx.verificationToken.update({
        where: { id: targetRows[0].id },
        data: { isUsed: true },
      });

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

    const user = await prisma.user.findUnique({
      where: { mobile: cleanMobile },
      include: { wallet: true },
    });

    if (!user) {
      throw new Error('Invalid mobile number or password.');
    }

    if (user.role !== 'USER') {
      throw new Error('Administrator accounts must authenticate using designated role prefix and two-factor authentication.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Your account has been suspended. Please contact customer support.');
    }

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      const lockResult = await AuthService.recordFailedPasswordAttempt(user.id);
      if (lockResult.isLocked || lockResult.failedPasswordAttempts >= (config.auth?.maxFailedAttempts || 10)) {
        throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
      }
      throw new Error('Invalid mobile number or password.');
    }

    // Single active session: generate new sessionId and invalidate previous sessions
    const sessionId = crypto.randomUUID();
    const refreshToken = generateSecureToken(40);
    const refreshTokenHash = sha256Hash(refreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    let deletionCancelled = false;

    await prisma.$transaction(async (tx) => {
      // 1. Lock user row FOR UPDATE to prevent race with deletion worker, lockout, and stale credentials
      const lockedUsers = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        passwordHash: string;
        failedPasswordAttempts: number;
        lockedUntil: Date | null;
        isLocked: boolean;
        deletionScheduledAt: Date | null;
        deletionRequestedAt: Date | null;
        gracePeriodExpired: boolean;
        now: Date;
      }>>`
        WITH clock AS (
          SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
        )
        SELECT
          u."id",
          u."status",
          u."passwordHash",
          u."failedPasswordAttempts",
          u."lockedUntil",
          (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > clock.now) AS "isLocked",
          u."deletionScheduledAt",
          u."deletionRequestedAt",
          (u."deletionScheduledAt" IS NOT NULL AND u."deletionScheduledAt" <= clock.now) AS "gracePeriodExpired",
          clock.now AS "now"
        FROM "User" u, clock
        WHERE u."id" = ${user.id}
        FOR UPDATE
      `;

      if (!lockedUsers || lockedUsers.length === 0) {
        throw new Error('User not found.');
      }
      const lockedUser = lockedUsers[0];
      const now = lockedUser.now;

      // Optimistic credential-version verification under row lock
      if (lockedUser.passwordHash !== user.passwordHash) {
        throw new Error('Invalid mobile number or password.');
      }

      if (lockedUser.status === 'SUSPENDED') {
        throw new Error('Your account has been suspended. Please contact customer support.');
      }

      // Recheck lockout state under row lock: racing failed password attempts establish lockout!
      if (lockedUser.isLocked) {
        throw new Error('Account is temporarily locked due to too many failed login attempts. Please try again later.');
      }

      // 2. Lock active AccountDeletionOperation row FOR UPDATE if one exists
      const lockedOps = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        destructiveStartedAt: Date | null;
        leaseExpiresAt: Date | null;
      }>>`
        SELECT "id", "status", "destructiveStartedAt", "leaseExpiresAt"
        FROM "AccountDeletionOperation"
        WHERE "userId" = ${user.id}
          AND "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `;

      const activeOp = lockedOps && lockedOps.length > 0 ? lockedOps[0] : null;

      // If worker has claimed and entered destructive phase, or is in progress/retryable, login cannot cancel deletion!
      // Fail closed when destructive status is ambiguous or active work is underway.
      if (activeOp && (activeOp.destructiveStartedAt || activeOp.status === 'IN_PROGRESS' || activeOp.status === 'FAILED_RETRYABLE')) {
        throw new Error('Your account deletion is in progress and cannot be cancelled.');
      }

      if (lockedUser.deletionScheduledAt) {
        if (lockedUser.gracePeriodExpired) {
          throw new Error('Account deletion grace period has expired.');
        }

        // Within grace period and not destructive: cancel deletion atomically
        deletionCancelled = true;
        await tx.user.update({
          where: { id: user.id },
          data: {
            activeSessionId: sessionId,
            deletionRequestedAt: null,
            deletionScheduledAt: null,
            status: 'ACTIVE',
            failedPasswordAttempts: 0,
            lockedUntil: null,
          },
        });

        if (activeOp && activeOp.status === 'PENDING') {
          await tx.$executeRaw`
            UPDATE "AccountDeletionOperation"
            SET "status" = 'CANCELLED',
                "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
                "leaseExpiresAt" = NULL
            WHERE "id" = ${activeOp.id}
          `;
        }

        await tx.auditLog.create({
          data: {
            action: 'ACCOUNT_DELETION_CANCELLED_BY_LOGIN',
            entityType: 'User',
            entityId: user.id,
            newValue: JSON.stringify({
              reason: 'User authenticated during 7-day grace period',
              cancelledAt: now,
            }),
            ipAddress,
            userAgent,
          },
        });
      } else {
        await tx.user.update({
          where: { id: user.id },
          data: {
            activeSessionId: sessionId,
            failedPasswordAttempts: 0,
            lockedUntil: null,
          },
        });
      }

      // Invalidate all existing sessions for this user
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
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

      // Audit log for login
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
      deletionCancelled,
      message: deletionCancelled ? 'Your scheduled account deletion has been cancelled.' : undefined,
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
    const newHash = await bcrypt.hash(params.newPassword, 12);

    await prisma.$transaction(async (tx) => {
      const targetRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "VerificationToken"
        WHERE "mobile" = ${cleanMobile}
          AND "tokenHash" = ${tokenHash}
          AND "purpose" = 'FORGOT_PASSWORD'
          AND "isUsed" = false
          AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        LIMIT 1
        FOR UPDATE
      `;

      if (!targetRows || targetRows.length !== 1) {
        throw new Error('Invalid or expired password reset token. Please verify OTP again.');
      }

      await tx.verificationToken.update({
        where: { id: targetRows[0].id },
        data: { isUsed: true },
      });

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
