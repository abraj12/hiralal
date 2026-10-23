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
import { validateStructuredName, compareNames } from '../utils/name.utils';
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

export const PUBLIC_GENERIC_OTP_PURPOSES = new Set<string>([
  'REGISTRATION',
  'LOGIN',
]);

export type PublicGenericOtpPurpose = 'REGISTRATION' | 'LOGIN';

export function requirePublicGenericOtpPurpose(purpose: unknown): PublicGenericOtpPurpose {
  if (
    typeof purpose !== 'string' ||
    !PUBLIC_GENERIC_OTP_PURPOSES.has(purpose)
  ) {
    throw new Error('Unsupported OTP purpose for this endpoint.');
  }

  return purpose as PublicGenericOtpPurpose;
}

// Backwards-compatible aliases
export const GENERIC_OTP_PURPOSES = PUBLIC_GENERIC_OTP_PURPOSES;
export type GenericOtpPurpose = PublicGenericOtpPurpose;
export const requireGenericOtpPurpose = requirePublicGenericOtpPurpose;

export const PASSWORD_RESET_INVALID_MESSAGE =
  'The verification request is invalid or expired. Please restart password recovery.';

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

    // VULN-HIGH-07: Match longest prefix first to prevent prefix shadowing
    const prefixes = [
      { prefix: billPrefix },
      { prefix: opsPrefix },
    ].filter((p): p is { prefix: string } => Boolean(p.prefix))
     .sort((a, b) => b.prefix.length - a.prefix.length);

    for (const { prefix } of prefixes) {
      if (cleanRaw.startsWith(prefix)) {
        const remainder = cleanRaw.slice(prefix.length);
        if (/^[6-9]\d{9}$/.test(remainder)) return true;
      }
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
        "failedPasswordAttempts" = CASE
          WHEN u."updatedAt" < clock.now - INTERVAL '15 minutes' THEN 1
          ELSE u."failedPasswordAttempts" + 1
        END,
        "lockedUntil" = CASE
          WHEN (
            CASE
              WHEN u."updatedAt" < clock.now - INTERVAL '15 minutes' THEN 1
              ELSE u."failedPasswordAttempts" + 1
            END
          ) >= ${maxFailedAttempts}
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
  static resolveAdminIdentifier(identifier: string): { role: UserRole; mobile: string; prefix: string } {
    if (!identifier || typeof identifier !== 'string') {
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    const cleanRaw = identifier.trim().toUpperCase();
    const billPrefix = normalizeAdminPrefix(config.admin.billAdminPrefix);
    const opsPrefix = normalizeAdminPrefix(config.admin.operationsAdminPrefix);

    // VULN-HIGH-07: Match longest prefix first to prevent prefix shadowing
    const prefixes: Array<{ prefix: string; role: UserRole }> = [
      { prefix: billPrefix, role: 'BILL_ADMIN' },
      { prefix: opsPrefix, role: 'OPERATIONS_ADMIN' },
    ].filter((p): p is { prefix: string; role: UserRole } => Boolean(p.prefix))
     .sort((a, b) => b.prefix.length - a.prefix.length);

    for (const { prefix, role } of prefixes) {
      if (cleanRaw.startsWith(prefix)) {
        const remainder = cleanRaw.slice(prefix.length);
        if (!/^[6-9]\d{9}$/.test(remainder)) {
          throw new Error(`Invalid ${role === 'BILL_ADMIN' ? 'Bill' : 'Operations'} Admin identifier format. Must be prefix followed by 10-digit mobile.`);
        }
        return { role, mobile: remainder, prefix };
      }
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
      // ADV-04: Execute constant-time dummy hash comparison to eliminate prefix timing oracle
      const DUMMY_HASH = '$2a$12$jHE.gfGaFakB2NGhVAW/sOFtME3Z60H5Npbm8HoygCnjfg35SS4Zi';
      await bcrypt.compare(password, DUMMY_HASH);
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

    // VULN-CRYPTO-01: Cost 12 dummy hash to match real password hashing cost factor and eliminate timing oracles
    const DUMMY_HASH = '$2a$12$jHE.gfGaFakB2NGhVAW/sOFtME3Z60H5Npbm8HoygCnjfg35SS4Zi';
    if (!admin || admin.status !== 'ACTIVE') {
      await bcrypt.compare(params.password, DUMMY_HASH);
      throw new Error('Invalid login credentials. Please check your details and try again.');
    }

    if (admin.lockedUntil && new Date(admin.lockedUntil).getTime() > Date.now()) {
      await bcrypt.compare(params.password, DUMMY_HASH);
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
    let smsResult;
    try {
      smsResult = await SmsService.sendOtp({
        mobile,
        otpCode: txResult.otpCode,
      });
    } catch (smsErr: any) {
      smsResult = { success: false, error: smsErr?.message || 'Gateway dispatch exception' };
    }

    if (!smsResult.success && config.isProduction) {
      // Clear cooldown so admin is not deadlocked on SMS gateway failure
      await prisma.otpRequest.updateMany({
        where: { mobile, purpose: 'ADMIN_LOGIN', cooldownUntil: { gt: new Date() } },
        data: { cooldownUntil: null, isUsed: true },
      });
      await prisma.verificationToken.updateMany({
        where: { mobile, purpose: 'ADMIN_LOGIN', isUsed: false },
        data: { isUsed: true },
      });
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
      const inputBuf = Buffer.from(inputHmac, 'hex');
      const recordBuf = Buffer.from(record.otpHash, 'hex');
      const isOtpMatch = inputBuf.length === recordBuf.length && crypto.timingSafeEqual(inputBuf, recordBuf);
      if (!isOtpMatch) {
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
      {
        algorithm: 'HS256',
        expiresIn: (config.admin.accessTokenExpiresIn || '1d') as any,
      }
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
   * Defensive synthetic delay to equalize timing with real SMS gateway network latency (AUTH-03).
   * In test environment, uses minimal simulated delay to maintain parity without slowing test execution.
   * In production/staging, targets expected external gateway latency with randomized jitter.
   */
  private static async equalizeSmsLatency(startTimeMs: number): Promise<void> {
    const elapsed = Date.now() - startTimeMs;
    if (config.nodeEnv === 'test') {
      const targetMs = 15;
      const remaining = targetMs - elapsed;
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      return;
    }

    const targetMs = 450 + Math.floor(Math.random() * 150);
    const remaining = targetMs - elapsed;
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  /**
   * Generates and dispatches cryptographically secure 6-digit OTP.
   * Enforces 60-second cooldown, 10-minute rate limiting, and OTP TTL <= 300s.
   * Serializes concurrent requests per mobile number using PostgreSQL transaction advisory locks.
   */
  static async requestOtp(params: {
    mobile: string;
    purpose?: unknown;
    ipAddress?: string;
  }) {
    const startTimeMs = Date.now();
    const validatedPurpose = requireGenericOtpPurpose(params.purpose);
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();
    const ttlMs = config.otp.ttlSeconds * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const cooldownUntil = new Date(now.getTime() + 60 * 1000);
    const otpCode = generateSecureOtp();
    const otpHash = hmacHashOtp(otpCode);

    let shouldSendSms = true;

    const txResult = await prisma.$transaction(async (tx) => {
      // Advisory xact lock per mobile number: (7212027, hashtext(cleanMobile))
      await tx.$executeRaw`SELECT 1::int AS lock_acquired FROM (SELECT pg_advisory_xact_lock(7212027, hashtext(${cleanMobile})::integer)) AS lock_result`;

      // 1. Business purpose validation & Anti-Enumeration / Toll-Fraud Guards (AUTH-002, AUTH-003)
      if (validatedPurpose === 'REGISTRATION') {
        const existingUser = await tx.user.findUnique({
          where: { mobile: cleanMobile },
        });
        if (existingUser) {
          throw new Error('This mobile number is already registered. Please proceed to login.');
        }
      }

      if (validatedPurpose === 'LOGIN') {
        const user = await tx.user.findUnique({
          where: { mobile: cleanMobile },
        });
        if (!user || user.role !== 'USER' || user.status !== 'ACTIVE') {
          shouldSendSms = false;
        }
      }

      // 2. Cooldown enforcement: prevent rapid resend within 60 seconds
      const activeCooldown = await tx.otpRequest.findFirst({
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

      // 3. Rate-limiting: max 5 requests per 10 minutes per mobile per purpose (F-12)
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const recentRequests = await tx.otpRequest.count({
        where: {
          mobile: cleanMobile,
          purpose: validatedPurpose as OtpPurpose,
          createdAt: { gt: tenMinutesAgo },
        },
      });

      if (recentRequests >= 5) {
        throw new Error('Too many verification requests. Please try again after 10 minutes.');
      }

      // 4. Record OTP Request (Uniformly created to enforce 60s cooldown and 10-min rate limits, preventing enumeration)
      const recordedOtpHash = shouldSendSms ? otpHash : hmacHashOtp(`SUPPRESSED_${Date.now()}_${cleanMobile}`);
      const createdRecord = await tx.otpRequest.create({
        data: {
          mobile: cleanMobile,
          otpHash: recordedOtpHash,
          purpose: validatedPurpose as OtpPurpose,
          expiresAt,
          cooldownUntil,
        },
      });

      return { shouldSendSms, otpRequestId: createdRecord.id };
    });

    // 5. Secure SMS dispatch outside transaction via configured provider (MSG91 in production)
    if (txResult.shouldSendSms) {
      const smsResult = await SmsService.sendOtp({
        mobile: cleanMobile,
        otpCode,
      });

      if (!smsResult.success) {
        console.error(`[AuthService] SMS delivery failed: ${smsResult.error || 'Gateway rejected dispatch'}`);
        // Invalidate ONLY this exact OTP record so it cannot be used if delivery failed.
        // Retain cooldownUntil so both existing and non-existent accounts maintain identical
        // 60-second cooldown behavior, eliminating account-enumeration oracles (AUTH-03).
        // Targeting exact id prevents delayed SMS failure from invalidating newer OTPs.
        if (txResult.otpRequestId) {
          try {
            await prisma.otpRequest.updateMany({
              where: {
                id: txResult.otpRequestId,
                isUsed: false,
              },
              data: {
                isUsed: true,
              },
            });
          } catch (cleanupErr) {
            console.error('[AuthService] Failed to invalidate OTP after SMS delivery failure:', cleanupErr);
          }
        }
      }
    }

    // Synthetic defensive delay to equalize timing with real SMS gateway network latency across BOTH paths (AUTH-03)
    await this.equalizeSmsLatency(startTimeMs);

    return {
      message: 'Verification code dispatched successfully to your mobile number.',
      cooldownSeconds: 60,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Dedicated OTP request for worker password recovery.
   * Enforces worker (USER) role requirement and true anti-enumeration:
   * non-existent users, non-USER accounts, inactive accounts, or cooldown/rate limits
   * receive the identical uniform message without OTP dispatch or database writes.
   * Serializes concurrent requests per mobile using PostgreSQL transaction advisory locks.
   * On SMS delivery failure, safely cleans up the exact created OTP and clears cooldown.
   */
  static async requestPasswordResetOtp(params: {
    mobile: string;
    ipAddress?: string;
  }) {
    const startTimeMs = Date.now();
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();
    const ttlMs = config.otp.ttlSeconds * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const cooldownUntil = new Date(now.getTime() + 60 * 1000);
    const antiEnumerationResponse = {
      message: 'If an eligible account exists, a verification code will be sent.',
      cooldownSeconds: 60,
      expiresAt: expiresAt.toISOString(),
    };

    const otpCode = generateSecureOtp();
    const otpHash = hmacHashOtp(otpCode);

    const txResult = await prisma.$transaction(async (tx) => {
      // Advisory xact lock per mobile number: (7212027, hashtext(cleanMobile))
      await tx.$executeRaw`SELECT 1::int AS lock_acquired FROM (SELECT pg_advisory_xact_lock(7212027, hashtext(${cleanMobile})::integer)) AS lock_result`;

      // Check account existence and role
      const existingUser = await tx.user.findUnique({
        where: { mobile: cleanMobile },
      });

      // Anti-enumeration: If user does not exist, is not role 'USER', or is not ACTIVE,
      // silently return synthetic response without generating OTP, writing DB records, or sending SMS.
      if (!existingUser || existingUser.role !== 'USER' || existingUser.status !== 'ACTIVE') {
        return { shouldSendSms: false };
      }

      // 1. Cooldown enforcement: prevent rapid resend within 60 seconds
      const activeCooldown = await tx.otpRequest.findFirst({
        where: {
          mobile: cleanMobile,
          purpose: 'FORGOT_PASSWORD',
          cooldownUntil: { gt: now },
        },
      });

      if (activeCooldown && activeCooldown.cooldownUntil) {
        return { shouldSendSms: false };
      }

      // 2. Rate-limiting: max 5 requests per 10 minutes per mobile per purpose (F-12)
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const recentRequests = await tx.otpRequest.count({
        where: {
          mobile: cleanMobile,
          purpose: 'FORGOT_PASSWORD',
          createdAt: { gt: tenMinutesAgo },
        },
      });

      if (recentRequests >= 5) {
        return { shouldSendSms: false };
      }

      // 3. Record OTP Request
      const createdRecord = await tx.otpRequest.create({
        data: {
          mobile: cleanMobile,
          otpHash,
          purpose: 'FORGOT_PASSWORD',
          expiresAt,
          cooldownUntil,
        },
      });

      return { shouldSendSms: true, otpRequestId: createdRecord.id };
    });

    // 4. Secure SMS dispatch outside transaction
    if (txResult.shouldSendSms) {
      const smsResult = await SmsService.sendOtp({
        mobile: cleanMobile,
        otpCode,
      });

      if (!smsResult.success) {
        console.error('[AuthService] Password recovery SMS delivery failed:', smsResult.error || 'Gateway rejected dispatch');
        if (txResult.otpRequestId) {
          try {
            await prisma.otpRequest.updateMany({
              where: {
                id: txResult.otpRequestId,
                mobile: cleanMobile,
                purpose: 'FORGOT_PASSWORD',
                isUsed: false,
              },
              data: {
                isUsed: true,
                cooldownUntil: null,
              },
            });
          } catch (cleanupErr) {
            console.error('[AuthService] Failed to invalidate OTP after SMS failure:', cleanupErr);
          }
        }
      }
    }

    // Synthetic defensive delay to equalize timing with real SMS gateway network latency across BOTH paths (AUTH-03)
    await this.equalizeSmsLatency(startTimeMs);

    return antiEnumerationResponse;
  }

  /**
   * Dedicated OTP request for authenticated worker account deletion.
   * Enforces 60-second cooldown and 10-minute rate limiting.
   * Serializes concurrent requests per mobile using PostgreSQL transaction advisory locks.
   */
  static async requestAccountDeletionOtp(params: {
    mobile: string;
    ipAddress?: string;
  }) {
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();
    const ttlMs = config.otp.ttlSeconds * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const cooldownUntil = new Date(now.getTime() + 60 * 1000);
    const otpCode = generateSecureOtp();
    const otpHash = hmacHashOtp(otpCode);

    const txResult = await prisma.$transaction(async (tx) => {
      // Advisory xact lock per mobile number: (7212027, hashtext(cleanMobile))
      await tx.$executeRaw`SELECT 1::int AS lock_acquired FROM (SELECT pg_advisory_xact_lock(7212027, hashtext(${cleanMobile})::integer)) AS lock_result`;

      // 1. Cooldown enforcement: prevent rapid resend within 60 seconds
      const activeCooldown = await tx.otpRequest.findFirst({
        where: {
          mobile: cleanMobile,
          purpose: 'ACCOUNT_DELETION',
          cooldownUntil: { gt: now },
        },
      });

      if (activeCooldown && activeCooldown.cooldownUntil) {
        const remainingSec = Math.ceil((activeCooldown.cooldownUntil.getTime() - now.getTime()) / 1000);
        throw new Error(`Please wait ${remainingSec} seconds before requesting a new verification code.`);
      }

      // 2. Rate-limiting: max 5 requests per 10 minutes per mobile per purpose (F-12)
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const recentRequests = await tx.otpRequest.count({
        where: {
          mobile: cleanMobile,
          purpose: 'ACCOUNT_DELETION',
          createdAt: { gt: tenMinutesAgo },
        },
      });

      if (recentRequests >= 5) {
        throw new Error('Too many verification requests. Please try again after 10 minutes.');
      }

      // 3. Create OtpRequest record
      const createdRecord = await tx.otpRequest.create({
        data: {
          mobile: cleanMobile,
          otpHash,
          purpose: 'ACCOUNT_DELETION',
          expiresAt,
          cooldownUntil,
        },
      });

      return { otpRequestId: createdRecord.id };
    });

    // 4. Secure SMS dispatch outside transaction
    const smsResult = await SmsService.sendOtp({
      mobile: cleanMobile,
      otpCode,
    });

    if (!smsResult.success) {
      console.error('[AuthService] Account deletion OTP SMS delivery failed:', smsResult.error || 'Gateway rejected dispatch');
      if (txResult.otpRequestId) {
        try {
          await prisma.otpRequest.updateMany({
            where: {
              id: txResult.otpRequestId,
              mobile: cleanMobile,
              purpose: 'ACCOUNT_DELETION',
              isUsed: false,
            },
            data: {
              isUsed: true,
              cooldownUntil: null,
            },
          });
        } catch (cleanupErr) {
          console.error('[AuthService] Failed to cleanup account deletion OTP after SMS failure:', cleanupErr);
        }
      }
      throw new Error('Unable to send verification code at this time. Please try again later.');
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
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }
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

    // Verify cryptographic HMAC hash (F-03: legacy SHA-256 backward-compat path removed)
    const inputHmac = hmacHashOtp(cleanOtp);
    const inputBuf = Buffer.from(inputHmac, 'hex');
    const recordBuf = Buffer.from(record.otpHash, 'hex');
    const isOtpMatch = inputBuf.length === recordBuf.length && crypto.timingSafeEqual(inputBuf, recordBuf);
    if (!isOtpMatch) {
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
   * Dedicated OTP verification for worker password recovery.
   * Atomically verifies the OTP and returns a single-use verification token inside a single transaction.
   * Enforces strict lock hierarchy: User row (FOR UPDATE) -> OTP rows (FOR UPDATE) -> VerificationToken.
   * Fails closed with uniform anti-enumeration message on any failure.
   */
  static async verifyPasswordResetOtp(params: {
    mobile: string;
    otpCode: string;
  }) {
    const genericFailure = PASSWORD_RESET_INVALID_MESSAGE;
    const cleanOtp = (params.otpCode || '').trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new Error(genericFailure);
    }

    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }
    if (cleanMobile.length !== 10) {
      throw new Error(genericFailure);
    }

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Lock user row FOR UPDATE first to eliminate race conditions and establish strict lock hierarchy
      const userRows = await tx.$queryRaw<Array<{
        id: string;
        role: string;
        status: string;
      }>>`
        SELECT "id", "role", "status"
        FROM "User"
        WHERE "mobile" = ${cleanMobile}
        LIMIT 1
        FOR UPDATE
      `;

      if (!userRows || userRows.length === 0) {
        return { success: false, message: genericFailure };
      }

      const lockedUser = userRows[0];
      if (lockedUser.role !== 'USER' || lockedUser.status !== 'ACTIVE') {
        return { success: false, message: genericFailure };
      }

      // 2. Lock and verify latest OTP row FOR UPDATE inside the same transaction
      const otpResult = await this.verifyOtpInTransaction(
        tx,
        {
          mobile: cleanMobile,
          otpCode: cleanOtp,
          purpose: 'FORGOT_PASSWORD',
        },
        { createVerificationToken: true }
      );

      if (!otpResult.success) {
        return { success: false, message: genericFailure };
      }

      return otpResult;
    });

    if (!txResult.success) {
      throw new Error(txResult.message || genericFailure);
    }

    return {
      message: 'Code verified successfully.',
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
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }

    const nameValidation = validateStructuredName(
      params.firstName,
      params.middleName,
      params.lastName,
      params.fullName
    );

    if (!nameValidation.isValid) {
      throw new Error(nameValidation.error || 'Please enter a valid first name.');
    }

    AuthService.validatePassword(params.password, 'Password');

    if (!['PLUMBER', 'TILE_INSTALLER'].includes(params.profession)) {
      throw new Error('Profession must be either PLUMBER or TILE_INSTALLER.');
    }

    if (!params.verificationToken) {
      throw new Error('Registration verification token is required.');
    }

    // 1. Pre-validate verification token prior to expensive bcrypt password hashing
    const tokenHash = sha256Hash(params.verificationToken);
    const existingToken = await prisma.verificationToken.findFirst({
      where: {
        tokenHash,
        mobile: cleanMobile,
        purpose: 'REGISTRATION',
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!existingToken) {
      throw new Error('Invalid or expired registration verification token. Please verify OTP again.');
    }

    // 2. Hash password with bcrypt salt 12 only after token is confirmed valid
    const passwordHash = await bcrypt.hash(params.password, 12);

    // 3. Single active session ID
    const sessionId = crypto.randomUUID();
    const refreshToken = generateSecureToken(40);
    const refreshTokenHash = sha256Hash(refreshToken);
    const now = new Date();
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

    // VULN-CRYPTO-01: Cost 12 dummy hash to match real password hashing cost factor and eliminate timing oracles
    const DUMMY_HASH = '$2a$12$jHE.gfGaFakB2NGhVAW/sOFtME3Z60H5Npbm8HoygCnjfg35SS4Zi';
    if (!user) {
      await bcrypt.compare(pass, DUMMY_HASH);
      throw new Error('Invalid mobile number or password.');
    }

    if (user.role !== 'USER') {
      await bcrypt.compare(pass, DUMMY_HASH);
      throw new Error('Administrator accounts must authenticate using designated role prefix and two-factor authentication.');
    }

    if (user.status === 'SUSPENDED') {
      await bcrypt.compare(pass, DUMMY_HASH);
      throw new Error('Your account has been suspended. Please contact customer support.');
    }

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      await bcrypt.compare(pass, DUMMY_HASH);
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

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    // Replay attack detection vs displaced session differentiation (Finding C-01)
    if (session.revokedAt) {
      // If this session is displaced by a newer login on another device, reject gracefully without terminating the active session
      if (user.activeSessionId && session.sessionId && session.sessionId !== user.activeSessionId) {
        throw new Error('Session has been invalidated by a newer login. Please log in again.');
      }

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
   * Bound to the caller's specific session ID to prevent stale access tokens from
   * revoking newer active sessions created on other devices (Finding 1).
   */
  static async logout(refreshTokenStr?: string, userId?: string, sessionId?: string) {
    if (refreshTokenStr) {
      const tokenHash = sha256Hash(refreshTokenStr);
      // Task 3.6: Prevent Session DoS - only active unrevoked and non-expired sessions may trigger logout
      const session = await prisma.authSession.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (session) {
        await prisma.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Clear activeSessionId on user ONLY IF this session was the user's active session
        await prisma.user.updateMany({
          where: { id: session.userId, activeSessionId: session.sessionId },
          data: { activeSessionId: null },
        });
        return;
      }
      // If refresh token is expired or revoked, do not wipe user activeSessionId
      if (!userId) {
        return;
      }
    }

    if (userId) {
      if (sessionId) {
        // Stale session protection: verify session is active and matches user's activeSessionId
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { activeSessionId: true },
        });

        // If the user's activeSessionId does not match this token's sessionId,
        // it means this token is STALE (superseded by a newer login on another device).
        // It must NOT revoke the newer session!
        if (!user || user.activeSessionId !== sessionId) {
          return;
        }

        const activeAuthSession = await prisma.authSession.findFirst({
          where: {
            userId,
            sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        });

        if (!activeAuthSession) {
          return;
        }

        await prisma.authSession.updateMany({
          where: { userId, sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await prisma.user.updateMany({
          where: { id: userId, activeSessionId: sessionId },
          data: { activeSessionId: null },
        });
      }
      // AUTH-01: Sessionless access tokens cannot identify a specific session and are strictly
      // rejected from revoking arbitrary or newer user sessions.
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
    if (typeof params.mobile !== 'string' || !/^\d{10}$/.test(params.mobile.replace(/\D/g, '').slice(-10))) {
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }
    const cleanMobile = String(params.mobile || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    }

    if (typeof params.verificationToken !== 'string' || !/^[0-9a-f]{64}$/i.test(params.verificationToken.trim())) {
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }

    AuthService.validatePassword(params.newPassword, 'New password');

    const tokenHash = sha256Hash(params.verificationToken);

    await prisma.$transaction(async (tx) => {
      // 1. Lock user row FOR UPDATE first to establish strict lock hierarchy
      const userRows = await tx.$queryRaw<Array<{
        id: string;
        role: string;
        status: string;
      }>>`
        SELECT "id", "role", "status"
        FROM "User"
        WHERE "mobile" = ${cleanMobile}
        LIMIT 1
        FOR UPDATE
      `;

      if (!userRows || userRows.length !== 1) {
        throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
      }

      const user = userRows[0];
      if (user.role !== 'USER') {
        throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
      }

      if (user.status !== 'ACTIVE') {
        throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
      }

      // 2. Lock and verify verification token FOR UPDATE
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
        throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
      }

      await tx.verificationToken.update({
        where: { id: targetRows[0].id },
        data: { isUsed: true },
      });

      const newHash = await bcrypt.hash(params.newPassword, 12);

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

    const hasVerifiedKyc = await prisma.kycRecord.findFirst({
      where: { userId, panStatus: 'VERIFIED', nameMatched: true },
    });

    if (user.isNameLocked || hasVerifiedKyc) {
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

      // 2. Re-evaluate or reset KYC nameMatched flag and prevent KYC re-verification deadlock (SEC-C-03)
      const userKycRecords = await tx.kycRecord.findMany({
        where: { userId: user.id },
      });
      for (const kyc of userKycRecords) {
        let isMatched = false;
        // The provider-returned verified name is authoritative. panName may be the
        // applicant-entered value and must not override the provider's identity result.
        const authoritativePanName = kyc.verifiedName || kyc.panName;
        if (authoritativePanName) {
          isMatched = compareNames(val.fullName, authoritativePanName);
        }
        await tx.kycRecord.update({
          where: { id: kyc.id },
          data: {
            nameMatched: isMatched,
            mononymousApproved: false,
            panStatus: isMatched ? kyc.panStatus : 'PENDING',
          },
        });
      }

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

  public static validatePassword(password: unknown, fieldName = 'Password'): void {
    if (typeof password !== 'string') {
      throw new Error('Password must be a valid string.');
    }
    if (password.length < 8) {
      throw new Error(`${fieldName} must be at least 8 characters long.`);
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('Password exceeds the maximum supported length.');
    }
  }

  private static generateAccessToken(userId: string, role: UserRole, mobile: string, sessionId?: string): string {
    const payload: any = { userId, role, mobile };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return jwt.sign(
      payload,
      config.jwt.accessSecret,
      {
        algorithm: 'HS256',
        expiresIn: config.jwt.accessExpiresIn as any,
      }
    );
  }
}
