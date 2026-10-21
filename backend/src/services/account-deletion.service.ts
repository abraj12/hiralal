import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { AuthService } from './auth.service';
import { StorageService } from './storage';

export class AccountDeletionService {
  private static get COOLDOWN_DAYS(): number {
    const v = parseInt(process.env.ACCOUNT_DELETION_COOLDOWN_DAYS || '30', 10);
    return Number.isFinite(v) && v > 0 ? v : 30;
  }
  private static get GRACE_PERIOD_DAYS(): number {
    const v = parseInt(process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS || '7', 10);
    return Number.isFinite(v) && v > 0 ? v : 7;
  }

  /**
   * Step 1: User initiates account deletion while authenticated by providing their password.
   * Enforces 30-day cooldown between requests using database-derived time under row lock.
   * Dispatches OTP with purpose ACCOUNT_DELETION to the user's registered mobile number OUTSIDE transaction.
   */
  static async requestDeletion(userId: string, password: string, ipAddress?: string) {
    if (!password || !password.trim()) {
      throw new Error('Current password is required to request account deletion.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    if (user.role !== 'USER') {
      throw new Error('Account deletion is only available for standard user accounts.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Account is suspended. Please contact customer support.');
    }

    // Verify password first
    const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordCorrect) {
      throw new Error('Incorrect password. Password verification is required to initiate account deletion.');
    }

    // Authoritative state check and 30-day cooldown verification under row lock with database clock
    const verifiedUser = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        mobile: string;
        role: string;
        status: string;
        passwordHash: string;
        deletionScheduledAt: Date | null;
        lastDeletionRequestAt: Date | null;
        cooldownActive: boolean;
        remainingDays: number;
        hasActiveOp: boolean;
      }>>`
        WITH clock AS (
          SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
        )
        SELECT
          u."id",
          u."mobile",
          u."role",
          u."status",
          u."passwordHash",
          u."deletionScheduledAt",
          u."lastDeletionRequestAt",
          (
            u."lastDeletionRequestAt" IS NOT NULL
            AND clock.now < u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')
          ) AS "cooldownActive",
          CASE
            WHEN u."lastDeletionRequestAt" IS NULL THEN 0
            WHEN clock.now >= u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day') THEN 0
            ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')) - clock.now)) / 86400.0)::int)
          END AS "remainingDays",
          EXISTS (
            SELECT 1 FROM "AccountDeletionOperation" op
            WHERE op."userId" = u."id"
              AND op."status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
          ) AS "hasActiveOp"
        FROM "User" u, clock
        WHERE u."id" = ${userId}
        FOR UPDATE
      `;

      if (!rows || rows.length !== 1) {
        throw new Error('User not found.');
      }

      const locked = rows[0];

      if (locked.role !== 'USER') {
        throw new Error('Account deletion is only available for standard user accounts.');
      }

      if (locked.status === 'SUSPENDED') {
        throw new Error('Account is suspended. Please contact customer support.');
      }

      // Locked-hash verification principle: reject if password changed concurrently
      if (locked.passwordHash !== user.passwordHash) {
        throw new Error('Incorrect password. Password verification is required to initiate account deletion.');
      }

      if (locked.cooldownActive) {
        throw new Error(
          `Another deletion request cannot be submitted within 30 days of the previous request. Please try again in ${locked.remainingDays} day(s).`
        );
      }

      if (locked.hasActiveOp || locked.deletionScheduledAt) {
        throw new Error('An account deletion is already scheduled or processing.');
      }

      // Financial fencing: reject if pending bills or in-flight payouts exist
      const pendingBillsCount = await tx.bill.count({
        where: {
          userId,
          status: { in: ['PENDING', 'UNDER_REVIEW'] },
        },
      });
      if (pendingBillsCount > 0) {
        throw new Error(
          'Account deletion cannot be requested while you have bills pending review. Please wait until bill verification is complete.'
        );
      }

      const inFlightPayoutsCount = await tx.payout.count({
        where: {
          userId,
          status: { in: ['PENDING', 'APPROVED', 'PAYOUT_INITIATED', 'PROCESSING'] },
        },
      });
      if (inFlightPayoutsCount > 0) {
        throw new Error(
          'Account deletion cannot be requested while a payout is being processed. Please wait until payout processing is complete.'
        );
      }

      return {
        mobile: locked.mobile,
      };
    });

    // Request deletion OTP via SMS provider OUTSIDE database transaction
    await AuthService.requestAccountDeletionOtp({
      mobile: verifiedUser.mobile,
      ipAddress,
    });

    return {
      success: true,
      mobile: verifiedUser.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
      message: 'A deletion confirmation OTP has been sent to your registered mobile number.',
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
    };
  }

  /**
   * Step 2: User verifies OTP to confirm account deletion.
   * Atomically locks User row, then active AccountDeletionOperation row.
   * Derives authoritative now and scheduledAt together from PostgreSQL clock_timestamp().
   * Re-evaluates state, cooldown and existing operations under row locks.
   * Verifies and consumes deletion OTP within the transaction.
   * Creates exactly one PENDING operation and sets deletion lifecycle fields atomically.
   */
  static async confirmDeletion(userId: string, otpCode: string, ipAddress?: string) {
    if (!otpCode || !otpCode.trim()) {
      throw new Error('Verification OTP code is required to confirm account deletion.');
    }

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Lock the target User row with SELECT ... FOR UPDATE and derive PostgreSQL clock
      const lockedUsers = await tx.$queryRaw<Array<{
        id: string;
        mobile: string;
        role: string;
        status: string;
        lastDeletionRequestAt: Date | null;
        deletionScheduledAt: Date | null;
        now: Date;
        scheduledAt: Date;
        cooldownActive: boolean;
        remainingDays: number;
      }>>`
        WITH clock AS (
          SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
        )
        SELECT
          u."id",
          u."mobile",
          u."role",
          u."status",
          u."lastDeletionRequestAt",
          u."deletionScheduledAt",
          clock.now,
          clock.now + (${this.GRACE_PERIOD_DAYS} * INTERVAL '1 day') AS "scheduledAt",
          (
            u."lastDeletionRequestAt" IS NOT NULL
            AND clock.now < u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')
          ) AS "cooldownActive",
          CASE
            WHEN u."lastDeletionRequestAt" IS NULL THEN 0
            WHEN clock.now >= u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day') THEN 0
            ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')) - clock.now)) / 86400.0)::int)
          END AS "remainingDays"
        FROM "User" u, clock
        WHERE u."id" = ${userId}
        FOR UPDATE
      `;

      if (!lockedUsers || lockedUsers.length !== 1) {
        throw new Error('User not found.');
      }

      const lockedUser = lockedUsers[0];

      if (lockedUser.role !== 'USER') {
        throw new Error('Account deletion is only available for standard user accounts.');
      }

      if (lockedUser.status === 'SUSPENDED') {
        throw new Error('Account is suspended. Please contact customer support.');
      }

      // 2. Lock active AccountDeletionOperation row with SELECT ... FOR UPDATE
      const activeOperations = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        destructiveStartedAt: Date | null;
        scheduledFor: Date;
        leaseOwner: string | null;
        leaseVersion: number;
        leaseExpiresAt: Date | null;
      }>>`
        SELECT
          "id",
          "status",
          "destructiveStartedAt",
          "scheduledFor",
          "leaseOwner",
          "leaseVersion",
          "leaseExpiresAt"
        FROM "AccountDeletionOperation"
        WHERE "userId" = ${userId}
          AND "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      `;

      const activeOperation = activeOperations[0] ?? null;

      if (activeOperation?.destructiveStartedAt) {
        throw new Error(
          'Account deletion has entered the destructive processing stage and cannot be restarted or cancelled.'
        );
      }

      if (activeOperation) {
        throw new Error(
          'An account deletion operation is already scheduled or processing.'
        );
      }

      if (lockedUser.deletionScheduledAt) {
        throw new Error(
          'An account deletion is already scheduled for this account.'
        );
      }

      // Re-enforce 30-day cooldown check using database-derived time under row lock
      if (lockedUser.cooldownActive) {
        throw new Error(
          `Another deletion request cannot be submitted within 30 days of the previous request. Please try again in ${lockedUser.remainingDays} day(s).`
        );
      }

      // Re-enforce financial fencing under row lock
      const pendingBillsCount = await tx.bill.count({
        where: {
          userId: lockedUser.id,
          status: { in: ['PENDING', 'UNDER_REVIEW'] },
        },
      });
      if (pendingBillsCount > 0) {
        throw new Error(
          'Account deletion cannot be confirmed while you have bills pending review. Please wait until bill verification is complete.'
        );
      }

      const inFlightPayoutsCount = await tx.payout.count({
        where: {
          userId: lockedUser.id,
          status: { in: ['PENDING', 'APPROVED', 'PAYOUT_INITIATED', 'PROCESSING'] },
        },
      });
      if (inFlightPayoutsCount > 0) {
        throw new Error(
          'Account deletion cannot be confirmed while a payout is being processed. Please wait until payout processing is complete.'
        );
      }

      // 3. Verify OTP in transaction (recording failed attempts if invalid)
      const otpResult = await AuthService.verifyOtpInTransaction(
        tx,
        {
          mobile: lockedUser.mobile,
          otpCode: otpCode.trim(),
          purpose: 'ACCOUNT_DELETION' as any,
        },
        { createVerificationToken: false }
      );

      if (!otpResult.success) {
        return {
          success: false,
          error: otpResult.message,
        };
      }

      const now = lockedUser.now;
      const scheduledAt = lockedUser.scheduledAt;

      // 4. Update User deletion lifecycle fields using database-derived timestamps
      await tx.user.update({
        where: { id: lockedUser.id },
        data: {
          deletionRequestedAt: now,
          deletionScheduledAt: scheduledAt,
          lastDeletionRequestAt: now,
          activeSessionId: null,
        },
      });

      // 5. Invalidate all active sessions immediately
      await tx.authSession.updateMany({
        where: { userId: lockedUser.id, revokedAt: null },
        data: { revokedAt: now },
      });

      // 6. Deactivate all push device tokens
      await tx.pushDeviceToken.updateMany({
        where: { userId: lockedUser.id, isActive: true },
        data: { isActive: false },
      });

      // 7. Create exactly one new PENDING operation with database-derived scheduledAt
      await tx.accountDeletionOperation.create({
        data: {
          userId: lockedUser.id,
          status: 'PENDING',
          scheduledFor: scheduledAt,
        },
      });

      // 8. Audit Log
      await tx.auditLog.create({
        data: {
          action: 'ACCOUNT_DELETION_SCHEDULED',
          entityType: 'User',
          entityId: lockedUser.id,
          newValue: JSON.stringify({
            userId: lockedUser.id,
            requestedAt: now,
            scheduledAt,
            gracePeriodDays: this.GRACE_PERIOD_DAYS,
          }),
          ipAddress,
        },
      });

      return {
        success: true,
        scheduledAt,
      };
    });

    if (!txResult.success) {
      throw new Error(txResult.error);
    }

    return {
      success: true,
      deletionScheduledAt: txResult.scheduledAt!.toISOString(),
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
      message: `Your account deletion is scheduled for ${txResult.scheduledAt!.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}. Logging in during this ${this.GRACE_PERIOD_DAYS}-day grace period will automatically cancel the deletion.`,
    };
  }

  /**
   * Retrieves current deletion status for an authenticated user.
   * All pending status, cooldown, and remaining days calculations are derived from PostgreSQL clock.
   */
  static async getDeletionStatus(userId: string) {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      deletionRequestedAt: Date | null;
      deletionScheduledAt: Date | null;
      lastDeletionRequestAt: Date | null;
      isPendingDeletion: boolean;
      cooldownActive: boolean;
      cooldownRemainingDays: number;
    }>>`
      WITH clock AS (
        SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
      )
      SELECT
        u."id",
        u."deletionRequestedAt",
        u."deletionScheduledAt",
        u."lastDeletionRequestAt",
        (u."deletionScheduledAt" IS NOT NULL AND u."deletionScheduledAt" > clock.now) AS "isPendingDeletion",
        (
          u."lastDeletionRequestAt" IS NOT NULL
          AND clock.now < u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')
        ) AS "cooldownActive",
        CASE
          WHEN u."lastDeletionRequestAt" IS NULL THEN 0
          WHEN clock.now >= u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day') THEN 0
          ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((u."lastDeletionRequestAt" + (${this.COOLDOWN_DAYS} * INTERVAL '1 day')) - clock.now)) / 86400.0)::int)
        END AS "cooldownRemainingDays"
      FROM "User" u, clock
      WHERE u."id" = ${userId}
    `;

    if (!rows || rows.length !== 1) {
      throw new Error('User not found.');
    }

    const row = rows[0];
    const isPendingDeletion = Boolean(row.isPendingDeletion);
    const canRequestDeletion = !row.cooldownActive && !isPendingDeletion;

    return {
      isPendingDeletion,
      deletionRequestedAt: row.deletionRequestedAt ? new Date(row.deletionRequestedAt).toISOString() : null,
      deletionScheduledAt: row.deletionScheduledAt ? new Date(row.deletionScheduledAt).toISOString() : null,
      canRequestDeletion,
      cooldownRemainingDays: Number(row.cooldownRemainingDays) || 0,
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
    };
  }

  /**
   * Periodic Worker: Executes account deletions that have passed their 7-day grace period.
   * Safe Data Anonymization Policy:
   * - Personal identifying information (name, mobile, password, sessions, tokens) is irreversibly removed or scrambled.
   * - Unnecessary KYC data (PAN number, blind index, encrypted PAN) is purged.
   * - Saved bank/UPI details are purged.
   * - Private invoice files are removed from Cloudflare R2 storage.
   * - Financial records (Wallet, WalletTransaction ledger, Bill numbers, Payout records) are strictly RETAINED
   *   for tax and financial audit integrity, attached to the anonymized user record.
   * Idempotent: repeated calls safely skip already processed accounts.
   */
  static async processScheduledDeletions(
    prismaClient: any = prisma,
    assertLease?: () => void,
    workerInstanceId?: string
  ): Promise<{
    processedCount: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    const leaseOwner = workerInstanceId || `del-worker-${process.pid}-${crypto.randomUUID()}`;
    const dueUsers = await prismaClient.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT u."id"
      FROM "User" u
      LEFT JOIN "AccountDeletionOperation" op ON op."userId" = u."id" AND op."status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
      WHERE (
        (u."deletionScheduledAt" <= (clock_timestamp() AT TIME ZONE 'UTC') AND u."status" <> 'SUSPENDED')
        OR
        (u."status" = 'SUSPENDED' AND u."mobile" LIKE 'DEL_%' AND op."id" IS NOT NULL)
      )
      ORDER BY u."id" ASC
    `;

    let processedCount = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    for (const u of dueUsers) {
      try {
        // Step 1: Atomic Claim Transaction with PostgreSQL row-level locks
        const claimResult = await prismaClient.$transaction(async (tx: any) => {
          // 1. Lock the target User row with PostgreSQL SELECT ... FOR UPDATE
          const lockedUsers = await tx.$queryRaw<Array<{
            id: string;
            mobile: string;
            status: string;
            deletionScheduledAt: Date | null;
            deletionRequestedAt: Date | null;
          }>>`
            SELECT "id", "mobile", "status", "deletionScheduledAt", "deletionRequestedAt"
            FROM "User"
            WHERE "id" = ${u.id}
            FOR UPDATE
          `;

          if (!lockedUsers || lockedUsers.length === 0) {
            return { claimed: false, reason: 'USER_NOT_FOUND' };
          }

          const lockedUser = lockedUsers[0];
          const isAlreadyAnonymized = lockedUser.status === 'SUSPENDED' && lockedUser.mobile.startsWith('DEL_');

          // Re-evaluate eligibility against database clock under row lock
          const eligibilityCheck = await tx.$queryRaw<Array<{
            isDue: boolean;
            isCancelledOrSuspended: boolean;
          }>>`
            WITH clock AS (
              SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
            )
            SELECT
              ((${isAlreadyAnonymized}) OR ("deletionScheduledAt" IS NOT NULL AND "deletionScheduledAt" <= clock.now AND "status" <> 'SUSPENDED')) AS "isDue",
              (NOT (${isAlreadyAnonymized}) AND ("deletionScheduledAt" IS NULL OR "status" = 'SUSPENDED')) AS "isCancelledOrSuspended"
            FROM "User", clock
            WHERE "id" = ${u.id}
          `;

          const { isDue, isCancelledOrSuspended } = eligibilityCheck[0] || { isDue: false, isCancelledOrSuspended: true };

          if (!isDue) {
            if (isCancelledOrSuspended) {
              await tx.$queryRaw`
                UPDATE "AccountDeletionOperation"
                SET "status" = 'CANCELLED',
                    "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
                    "leaseExpiresAt" = NULL
                WHERE "userId" = ${u.id}
                  AND "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
              `;
            }
            return { claimed: false, reason: 'CANCELLED_OR_INACTIVE' };
          }

          // 2. Lock active operation row where it exists
          const lockedOps = await tx.$queryRaw<Array<{
            id: string;
            status: string;
            attemptCount: number;
            nextRetryAt: Date | null;
            leaseOwner: string | null;
            leaseVersion: number;
            leaseExpiresAt: Date | null;
            destructiveStartedAt: Date | null;
          }>>`
            SELECT "id", "status", "attemptCount", "nextRetryAt", "leaseOwner", "leaseVersion", "leaseExpiresAt", "destructiveStartedAt"
            FROM "AccountDeletionOperation"
            WHERE "userId" = ${u.id}
              AND "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
            ORDER BY "createdAt" DESC
            LIMIT 1
            FOR UPDATE
          `;

          let opId: string;
          let opVersion = 1;
          let attemptCount = 1;

          if (!lockedOps || lockedOps.length === 0) {
            // Initial operation creation under locked user using database-derived timestamps
            const initialId = crypto.randomUUID();
            const created = await tx.$queryRaw<Array<{
              id: string;
              leaseOwner: string | null;
              leaseVersion: number;
              attemptCount: number;
              leaseExpiresAt: Date | null;
            }>>`
              WITH clock AS (
                SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
              )
              INSERT INTO "AccountDeletionOperation" (
                "id", "userId", "status", "scheduledFor", "startedAt", "destructiveStartedAt",
                "attemptCount", "leaseOwner", "leaseVersion", "leaseExpiresAt", "createdAt", "updatedAt"
              )
              SELECT
                ${initialId},
                ${u.id},
                'IN_PROGRESS'::"DeletionOperationStatus",
                ${lockedUser.deletionScheduledAt},
                clock.now,
                clock.now,
                1,
                ${leaseOwner},
                1,
                clock.now + INTERVAL '60 seconds',
                clock.now,
                clock.now
              FROM clock
              RETURNING "id", "leaseOwner", "leaseVersion", "attemptCount", "leaseExpiresAt"
            `;

            if (!created || created.length !== 1) {
              return { claimed: false, reason: 'FAILED_INITIAL_CREATION' };
            }
            opId = created[0].id;
            opVersion = created[0].leaseVersion;
            attemptCount = created[0].attemptCount;
          } else {
            const op = lockedOps[0];

            // Atomic database-clock claim and fencing update
            const claimed = await tx.$queryRaw<Array<{
              id: string;
              leaseOwner: string | null;
              leaseVersion: number;
              attemptCount: number;
              leaseExpiresAt: Date | null;
            }>>`
              WITH clock AS (
                SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
              )
              UPDATE "AccountDeletionOperation" AS op
              SET
                "status" = 'IN_PROGRESS',
                "startedAt" = COALESCE(op."startedAt", clock.now),
                "destructiveStartedAt" = COALESCE(op."destructiveStartedAt", clock.now),
                "attemptCount" = op."attemptCount" + 1,
                "leaseOwner" = ${leaseOwner},
                "leaseVersion" = op."leaseVersion" + 1,
                "leaseExpiresAt" = clock.now + INTERVAL '60 seconds'
              FROM clock
              WHERE op."id" = ${op.id}
                AND op."status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
                AND (op."nextRetryAt" IS NULL OR op."nextRetryAt" <= clock.now)
                AND (op."leaseExpiresAt" IS NULL OR op."leaseExpiresAt" <= clock.now)
              RETURNING
                op."id",
                op."leaseOwner",
                op."leaseVersion",
                op."attemptCount",
                op."leaseExpiresAt"
            `;

            if (!claimed || claimed.length !== 1) {
              return { claimed: false, reason: 'LEASE_CONFLICT_OR_BACKOFF' };
            }

            opId = claimed[0].id;
            opVersion = claimed[0].leaseVersion;
            attemptCount = claimed[0].attemptCount;
          }

          // SEC-HIGH-07 (CGST Act Section 36 statutory retention compliance):
          // Approved tax invoices MUST be retained in storage for statutory 72 months to support GST tax audits.
          const shouldRetainApproved = config.retainApprovedBillsForAudit;
          const userBills = await tx.bill.findMany({
            where: {
              userId: u.id,
              ...(shouldRetainApproved ? { status: { not: 'APPROVED' } } : {}),
            },
            select: { id: true, fileKey: true },
          });

          return {
            claimed: true,
            operationId: opId,
            currentLeaseVersion: opVersion,
            attemptCount,
            bills: userBills,
          };
        });

        if (!claimResult.claimed) {
          continue;
        }

        const { operationId, currentLeaseVersion, attemptCount, bills } = claimResult as any;

        // Step 2: Delete private invoice files from Cloudflare R2 storage
        // Protected by distributed worker lease + DB CAS lease renewal before each file deletion
        const failedFileKeys: string[] = [];
        let deletedFilesCount = 0;
        let leaseLost = false;

        for (const bill of bills) {
          if (bill.fileKey) {
            // Distributed worker heartbeat verification
            assertLease?.();

            // CAS lease verification & renewal in DB before each external R2 deletion
            const renewed = await prismaClient.$queryRaw<Array<{ id: string }>>`
              UPDATE "AccountDeletionOperation"
              SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '60 seconds'
              WHERE "id" = ${operationId}
                AND "leaseOwner" = ${leaseOwner}
                AND "leaseVersion" = ${currentLeaseVersion}
                AND "status" = 'IN_PROGRESS'
                AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
              RETURNING "id"
            `;

            if (!renewed || renewed.length !== 1) {
              console.warn(
                `[ACCOUNT-DELETION] Lease lost for operation ${operationId} (worker: ${leaseOwner}, v${currentLeaseVersion}). Halting destructive R2 deletions.`
              );
              failedFileKeys.push(bill.fileKey);
              leaseLost = true;
              break;
            }

            try {
              await StorageService.getProvider().delete(bill.fileKey);
              deletedFilesCount++;
            } catch (storageErr: any) {
              console.warn(`[ACCOUNT-DELETION] Failed to delete file ${bill.fileKey} for bill ${bill.id}:`, storageErr.message);
              failedFileKeys.push(bill.fileKey);
            }
          }
        }

        if (leaseLost) {
          errors.push({
            userId: u.id,
            error: `Lease ownership lost during file deletion; processing aborted to prevent duplicate worker race.`,
          });
          continue;
        }

        // If any R2 delete fails: record failed file keys, increment attemptCount,
        // set status = 'FAILED_RETRYABLE' with exponential backoff, DO NOT anonymize user or mark complete.
        if (failedFileKeys.length > 0) {
          const backoffMs = Math.min(5 * 60 * 1000 * Math.pow(2, attemptCount - 1), 24 * 60 * 60 * 1000);

          const updated = await prismaClient.$queryRaw<Array<{ id: string; nextRetryAt: Date }>>`
            WITH clock AS (
              SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
            )
            UPDATE "AccountDeletionOperation" AS op
            SET "status" = 'FAILED_RETRYABLE',
                "nextRetryAt" = clock.now + (${backoffMs} * INTERVAL '1 millisecond'),
                "lastError" = ${`Failed to delete ${failedFileKeys.length} invoice file(s) from storage: ${failedFileKeys.join(', ')}`},
                "failedFileKeys" = ${JSON.stringify(failedFileKeys)}::jsonb,
                "deletedFilesCount" = ${deletedFilesCount},
                "leaseExpiresAt" = NULL
            FROM clock
            WHERE op."id" = ${operationId}
              AND op."leaseOwner" = ${leaseOwner}
              AND op."leaseVersion" = ${currentLeaseVersion}
              AND op."status" = 'IN_PROGRESS'
              AND op."leaseExpiresAt" > clock.now
            RETURNING op."id", op."nextRetryAt"
          `;

          if (!updated || updated.length !== 1) {
            console.warn(
              `[ACCOUNT-DELETION] CAS failed while setting FAILED_RETRYABLE for operation ${operationId}. Worker ${leaseOwner} lost ownership or lease expired.`
            );
            errors.push({
              userId: u.id,
              error: `Lease ownership lost before marking operation retryable.`,
            });
            continue;
          }

          errors.push({
            userId: u.id,
            error: `Storage file deletion failed for ${failedFileKeys.length} file(s); scheduled for retry at ${updated[0].nextRetryAt.toISOString()}`,
          });
          continue;
        }

        // Step 3: All files verified deleted. Verify distributed lease before irreversible anonymization.
        assertLease?.();

        // Step 4: Anonymize personal profile and purge credentials atomically under row locks and CAS fencing
        await prismaClient.$transaction(async (tx: any) => {
          // 1. Lock User row FOR UPDATE first (Global lock order: 1. User, 2. AccountDeletionOperation)
          const lockedUsers = await tx.$queryRaw<Array<{
            id: string;
            mobile: string;
            status: string;
            deletionScheduledAt: Date | null;
          }>>`
            SELECT "id", "mobile", "status", "deletionScheduledAt"
            FROM "User"
            WHERE "id" = ${u.id}
            FOR UPDATE
          `;

          if (!lockedUsers || lockedUsers.length !== 1) {
            throw new Error(`Account-deletion user was not found during finalization.`);
          }

          const lockedUser = lockedUsers[0];

          // Check if user remains due for deletion according to database time
          const finalEligibility = await tx.$queryRaw<Array<{
            isDue: boolean;
            isAlreadyAnonymized: boolean;
          }>>`
            WITH clock AS (
              SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
            )
            SELECT
              ("deletionScheduledAt" IS NOT NULL AND "deletionScheduledAt" <= clock.now) AS "isDue",
              ("status" = 'SUSPENDED' AND "mobile" LIKE 'DEL_%') AS "isAlreadyAnonymized"
            FROM "User", clock
            WHERE "id" = ${u.id}
          `;

          const { isDue, isAlreadyAnonymized } = finalEligibility[0] || { isDue: false, isAlreadyAnonymized: false };

          if (!isDue && !isAlreadyAnonymized) {
            throw new Error(`[ACCOUNT-DELETION] User ${u.id} deletion grace period has not expired or schedule is not set.`);
          }

          // Section 3.8: Explicit fenced idempotency path for already-anonymized accounts
          if (isAlreadyAnonymized) {
            // Lock operation row FOR UPDATE second and verify lease fencing with DB clock
            const lockedOps = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "AccountDeletionOperation"
              WHERE "id" = ${operationId}
                AND "leaseOwner" = ${leaseOwner}
                AND "leaseVersion" = ${currentLeaseVersion}
                AND "status" = 'IN_PROGRESS'
                AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
              FOR UPDATE
            `;

            if (!lockedOps || lockedOps.length !== 1) {
              throw new Error(
                `[ACCOUNT-DELETION] Lease fencing failed for already-anonymized account: ownership lost or lease expired for operation ${operationId}`
              );
            }

            // Transition operation to COMPLETED through CAS
            const completedOps = await tx.$queryRaw<Array<{ id: string }>>`
              UPDATE "AccountDeletionOperation"
              SET "status" = 'COMPLETED',
                  "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
                  "deletedFilesCount" = ${deletedFilesCount},
                  "failedFileKeys" = NULL,
                  "leaseExpiresAt" = NULL
              WHERE "id" = ${operationId}
                AND "leaseOwner" = ${leaseOwner}
                AND "leaseVersion" = ${currentLeaseVersion}
                AND "status" = 'IN_PROGRESS'
                AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
              RETURNING "id"
            `;

            if (!completedOps || completedOps.length !== 1) {
              throw new Error(
                `[ACCOUNT-DELETION] CAS completion failed for already-anonymized account: operation ${operationId}`
              );
            }

            await tx.auditLog.create({
              data: {
                action: 'ACCOUNT_DELETION_EXECUTED',
                entityType: 'User',
                entityId: u.id,
                newValue: JSON.stringify({
                  userId: u.id,
                  operationId,
                  executedAt: new Date(),
                  deletedFilesCount,
                  policy: 'ALREADY_ANONYMIZED_IDEMPOTENT_COMPLETION',
                }),
              },
            });

            return;
          }

          // 2. Lock operation row FOR UPDATE second and verify lease fencing with DB clock
          const lockedOps = await tx.$queryRaw<Array<{
            id: string;
            leaseOwner: string | null;
            leaseVersion: number;
            status: string;
            leaseExpiresAt: Date | null;
          }>>`
            SELECT "id", "leaseOwner", "leaseVersion", "status", "leaseExpiresAt"
            FROM "AccountDeletionOperation"
            WHERE "id" = ${operationId}
              AND "leaseOwner" = ${leaseOwner}
              AND "leaseVersion" = ${currentLeaseVersion}
              AND "status" = 'IN_PROGRESS'
              AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
            FOR UPDATE
          `;

          if (!lockedOps || lockedOps.length !== 1) {
            throw new Error(
              `[ACCOUNT-DELETION] Lease fencing failed: ownership lost or lease expired for operation ${operationId}`
            );
          }

          // 3. Purge active push tokens, notifications, redact AppInstallation, sessions, and OTP requests
          // E-04: Notifications containing PII must be purged upon account deletion
          await tx.notification.deleteMany({ where: { userId: u.id } });
          await tx.pushDeviceToken.deleteMany({ where: { userId: u.id } });
          await tx.appInstallation.updateMany({
            where: { userId: u.id },
            data: { userId: null, pushToken: null },
          });
          await tx.authSession.deleteMany({ where: { userId: u.id } });
          await tx.otpRequest.deleteMany({ where: { mobile: lockedUser.mobile } });
          await tx.verificationToken.deleteMany({ where: { mobile: lockedUser.mobile } });

          // 4. Statutory Financial Record Retention Check (Finding E-01: PMLA & Companies Act 8-year requirement)
          const hasFinancialPayouts = await tx.payout.findFirst({
            where: {
              userId: u.id,
              status: { in: ['SUCCESS', 'PROCESSING', 'PAYOUT_INITIATED', 'REVERSED'] },
            },
          });
          const hasApprovedInvoices = await tx.bill.findFirst({
            where: {
              userId: u.id,
              status: 'APPROVED',
            },
          });
          const requiresStatutoryRetention = Boolean(hasFinancialPayouts || hasApprovedInvoices);

          if (requiresStatutoryRetention) {
            // Statutory retention: anonymize display names and release unique blind indexes so returning users/re-registration
            // is not blocked, while retaining encrypted PAN/account and masked info for statutory audit compliance (PMLA/tax)
            await tx.kycRecord.updateMany({
              where: { userId: u.id },
              data: {
                panName: 'ANONYMIZED_STATUTORY_RETENTION',
                verifiedName: 'ANONYMIZED_STATUTORY_RETENTION',
                panBlindIndex: null,
                panNumber: null,
              },
            });
            // E-03: Scrub personal phone-number-based UPI IDs and release unique beneficiary blind index
            await tx.paymentAccount.updateMany({
              where: { userId: u.id },
              data: {
                upiId: null,
                upiIdEncrypted: null,
                accountHolderName: 'ANONYMIZED_STATUTORY_RETENTION',
                providerRegisteredName: 'ANONYMIZED_STATUTORY_RETENTION',
                beneficiaryBlindIndex: null,
                isVerified: false,
                isDefault: false,
              },
            });
          } else {
            // Non-financial users: full cryptographic purge
            await tx.kycRecord.updateMany({
              where: { userId: u.id },
              data: {
                panNumber: null,
                panName: 'ANONYMIZED',
                maskedPan: 'XXXXX0000X',
                panNumberEncrypted: null,
                panBlindIndex: null,
                verifiedName: 'ANONYMIZED',
              },
            });
            await tx.paymentAccount.updateMany({
              where: { userId: u.id },
              data: {
                upiId: null,
                upiIdEncrypted: null,
                accountHolderName: 'ANONYMIZED',
                providerRegisteredName: 'ANONYMIZED',
                accountNumber: null,
                accountNumberEncrypted: null,
                beneficiaryBlindIndex: null,
                ifscCode: null,
                bankName: null,
                maskedInfo: 'XXXX0000',
                isDefault: false,
              },
            });
          }

          // 5. Anonymize User record (retain ID for ledger foreign keys)
          const anonymizedMobile = `DEL_${u.id.replace(/-/g, '').slice(0, 8)}_${crypto.randomBytes(4).toString('hex')}`;
          const retentionExpiry = requiresStatutoryRetention
            ? new Date(Date.now() + 8 * 365.25 * 24 * 60 * 60 * 1000)
            : null;

          await tx.user.update({
            where: { id: u.id },
            data: {
              fullName: 'Deleted User',
              firstName: 'Deleted',
              middleName: null,
              lastName: 'User',
              mobile: anonymizedMobile,
              passwordHash: '$2a$10$ANONYMIZED_PASSWORD_HASH_PREVENTS_LOGIN',
              status: 'SUSPENDED',
              isVerified: false,
              isNameLocked: true,
              activeSessionId: null,
              deletionRequestedAt: null,
              deletionScheduledAt: null,
              statutoryRetentionExpiresAt: retentionExpiry,
            },
          });

          // 6. VULN-DEL-01: Scrub personal names, IP addresses, and user agents in AuditLog for deleted accounts
          await tx.auditLog.updateMany({
            where: {
              OR: [
                { entityId: u.id },
                { adminId: u.id },
              ],
            },
            data: {
              ipAddress: '0.0.0.0',
              userAgent: 'ANONYMIZED',
            },
          });

          // 7. Complete the tracking operation with CAS fencing using DB clock
          const completedOps = await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE "AccountDeletionOperation"
            SET "status" = 'COMPLETED',
                "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
                "deletedFilesCount" = ${deletedFilesCount},
                "failedFileKeys" = NULL,
                "leaseExpiresAt" = NULL
            WHERE "id" = ${operationId}
              AND "leaseOwner" = ${leaseOwner}
              AND "leaseVersion" = ${currentLeaseVersion}
              AND "status" = 'IN_PROGRESS'
              AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
            RETURNING "id"
          `;

          if (!completedOps || completedOps.length !== 1) {
            throw new Error(
              `[ACCOUNT-DELETION] Final CAS completion update affected 0 rows: lease expired or lost for operation ${operationId}. Rolling back entire transaction.`
            );
          }

          // 8. Audit Log
          await tx.auditLog.create({
            data: {
              action: 'ACCOUNT_DELETION_EXECUTED',
              entityType: 'User',
              entityId: u.id,
              newValue: JSON.stringify({
                userId: u.id,
                operationId,
                executedAt: new Date(),
                deletedFilesCount,
                policy: 'PERSONAL_DATA_ANONYMIZED_FINANCIAL_RECORDS_RETAINED',
              }),
            },
          });
        });

        processedCount++;
      } catch (err: any) {
        errors.push({ userId: u.id, error: err.message || 'Unknown deletion processing error' });
      }
    }

    return { processedCount, errors };
  }

  /**
   * Purges expired statutory retention records (older than 8 years)
   * where legalHold is false and user is SUSPENDED.
   */
  static async purgeExpiredStatutoryRecords(db: any = prisma): Promise<number> {
    const now = new Date();
    const expiredUsers = await db.user.findMany({
      where: {
        status: 'SUSPENDED',
        legalHold: false,
        statutoryRetentionExpiresAt: { lte: now },
      },
      select: { id: true },
      take: 50,
    });

    if (expiredUsers.length === 0) return 0;

    const userIds = expiredUsers.map((u: any) => u.id);

    await db.$transaction(async (tx: any) => {
      // Cryptographically scrub encrypted PAN and payment accounts
      await tx.kycRecord.updateMany({
        where: { userId: { in: userIds } },
        data: {
          panNumberEncrypted: null,
          maskedPan: 'ANONYMIZED_EXPIRED',
        },
      });

      await tx.paymentAccount.updateMany({
        where: { userId: { in: userIds } },
        data: {
          accountNumberEncrypted: null,
          maskedInfo: 'ANONYMIZED_EXPIRED',
        },
      });

      await tx.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          statutoryRetentionExpiresAt: null,
        },
      });
    });

    return userIds.length;
  }
}
