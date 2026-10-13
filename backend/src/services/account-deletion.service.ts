import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AuthService } from './auth.service';
import { StorageService } from './storage';

export class AccountDeletionService {
  private static COOLDOWN_DAYS = 30;
  private static GRACE_PERIOD_DAYS = 7;

  /**
   * Step 1: User initiates account deletion while authenticated by providing their password.
   * Enforces 30-day cooldown between requests.
   * Dispatches OTP with purpose ACCOUNT_DELETION to the user's registered mobile number.
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

    // Verify password
    const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordCorrect) {
      throw new Error('Incorrect password. Password verification is required to initiate account deletion.');
    }

    // Check 30-day cooldown from previous deletion request
    if (user.lastDeletionRequestAt) {
      const cooldownMs = this.COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const elapsedMs = Date.now() - user.lastDeletionRequestAt.getTime();
      if (elapsedMs < cooldownMs) {
        const remainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
        throw new Error(
          `Another deletion request cannot be submitted within 30 days of the previous request. Please try again in ${remainingDays} day(s).`
        );
      }
    }

    // Request deletion OTP via SMS provider
    await AuthService.requestOtp({
      mobile: user.mobile,
      purpose: 'ACCOUNT_DELETION' as any,
      ipAddress,
    });

    return {
      success: true,
      mobile: user.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
      message: 'A deletion confirmation OTP has been sent to your registered mobile number.',
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
    };
  }

  /**
   * Step 2: User verifies OTP to confirm account deletion.
   * Atomically locks User row, then active AccountDeletionOperation row.
   * Re-evaluates state from locked rows.
   * Verifies and consumes deletion OTP within the transaction.
   * If destructive processing has started, rejects.
   * If operation or deletion is already scheduled, rejects without duplicate.
   * Creates exactly one PENDING operation and sets deletion lifecycle fields atomically.
   */
  static async confirmDeletion(userId: string, otpCode: string, ipAddress?: string) {
    if (!otpCode || !otpCode.trim()) {
      throw new Error('Verification OTP code is required to confirm account deletion.');
    }

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Lock the target User row with SELECT ... FOR UPDATE
      const lockedUsers = await tx.$queryRaw<Array<{
        id: string;
        mobile: string;
        role: string;
        status: string;
        lastDeletionRequestAt: Date | null;
        deletionScheduledAt: Date | null;
      }>>`
        SELECT
          "id",
          "mobile",
          "role",
          "status",
          "lastDeletionRequestAt",
          "deletionScheduledAt"
        FROM "User"
        WHERE "id" = ${userId}
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

      // Re-enforce 30-day cooldown check using locked user data
      if (lockedUser.lastDeletionRequestAt) {
        const cooldownMs = this.COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        const elapsedMs = now.getTime() - new Date(lockedUser.lastDeletionRequestAt).getTime();
        if (elapsedMs < cooldownMs) {
          const remainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
          throw new Error(
            `Another deletion request cannot be submitted within 30 days of the previous request. Please try again in ${remainingDays} day(s).`
          );
        }
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

      // 4. Update User deletion lifecycle fields
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

      // 7. Create exactly one new PENDING operation
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
      message: `Your account deletion is scheduled for ${txResult.scheduledAt!.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}. Logging in during this 7-day grace period will automatically cancel the deletion.`,
    };
  }

  /**
   * Retrieves current deletion status for an authenticated user.
   */
  static async getDeletionStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        lastDeletionRequestAt: true,
      },
    });

    if (!user) throw new Error('User not found.');

    const now = new Date();
    const isPendingDeletion = Boolean(user.deletionScheduledAt && user.deletionScheduledAt > now);

    let canRequestDeletion = true;
    let cooldownRemainingDays = 0;

    if (user.lastDeletionRequestAt) {
      const cooldownMs = this.COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const elapsedMs = now.getTime() - user.lastDeletionRequestAt.getTime();
      if (elapsedMs < cooldownMs) {
        canRequestDeletion = false;
        cooldownRemainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
      }
    }

    return {
      isPendingDeletion,
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() || null,
      deletionScheduledAt: user.deletionScheduledAt?.toISOString() || null,
      canRequestDeletion: canRequestDeletion && !isPendingDeletion,
      cooldownRemainingDays,
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
    const now = new Date();
    const leaseOwner = workerInstanceId || `del-worker-${process.pid}-${Date.now()}`;
    const dueUsers = await prismaClient.user.findMany({
      where: {
        deletionScheduledAt: { lte: now },
        status: { not: 'SUSPENDED' },
      },
      include: {
        bills: { select: { id: true, fileKey: true } },
      },
    });

    let processedCount = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    for (const u of dueUsers) {
      try {
        // Step 1: Atomic Claim Transaction with PostgreSQL row-level locks
        const claimResult = await prismaClient.$transaction(async (tx: any) => {
          // 1. Lock the target User row with PostgreSQL SELECT ... FOR UPDATE
          const lockedUsers = await tx.$queryRaw`
            SELECT "id", "mobile", "status", "deletionScheduledAt", "deletionRequestedAt"
            FROM "User"
            WHERE "id" = ${u.id}
            FOR UPDATE
          `;

          if (!lockedUsers || (lockedUsers as any[]).length === 0) {
            return { claimed: false, reason: 'USER_NOT_FOUND' };
          }

          const lockedUser = (lockedUsers as any[])[0];

          // Check if cancelled, grace period still active, or already suspended
          if (
            !lockedUser.deletionScheduledAt ||
            new Date(lockedUser.deletionScheduledAt) > now ||
            lockedUser.status === 'SUSPENDED'
          ) {
            if (!lockedUser.deletionScheduledAt || lockedUser.status === 'SUSPENDED') {
              await tx.accountDeletionOperation.updateMany({
                where: { userId: u.id, status: { in: ['PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE'] } },
                data: { status: 'CANCELLED', completedAt: now, leaseExpiresAt: null },
              });
            }
            return { claimed: false, reason: 'CANCELLED_OR_INACTIVE' };
          }

          // 2. Lock the operation row where it exists
          const lockedOps = await tx.$queryRaw`
            SELECT "id", "status", "attemptCount", "nextRetryAt", "leaseOwner", "leaseVersion", "leaseExpiresAt", "destructiveStartedAt"
            FROM "AccountDeletionOperation"
            WHERE "userId" = ${u.id}
              AND "status" IN ('PENDING', 'IN_PROGRESS', 'FAILED_RETRYABLE')
            ORDER BY "createdAt" DESC
            LIMIT 1
            FOR UPDATE
          `;

          const leaseExpiry = new Date(now.getTime() + 60000); // 60-second claim lease
          let opId: string;
          let opVersion = 1;
          let attemptCount = 1;

          if (!lockedOps || (lockedOps as any[]).length === 0) {
            // Create initial operation record atomically
            const newOp = await tx.accountDeletionOperation.create({
              data: {
                userId: u.id,
                status: 'IN_PROGRESS',
                scheduledFor: lockedUser.deletionScheduledAt,
                startedAt: now,
                destructiveStartedAt: now,
                attemptCount: 1,
                leaseOwner,
                leaseVersion: 1,
                leaseExpiresAt: leaseExpiry,
              },
            });
            opId = newOp.id;
            opVersion = 1;
            attemptCount = 1;
          } else {
            const op = (lockedOps as any[])[0];

            // If in retry backoff window, skip
            if (op.nextRetryAt && new Date(op.nextRetryAt) > now) {
              return { claimed: false, reason: 'RETRY_BACKOFF' };
            }

            // Check lease ownership / expiry
            const isExpired = !op.leaseExpiresAt || new Date(op.leaseExpiresAt) <= now;
            const isOwner = op.leaseOwner === leaseOwner;

            if (!isExpired && !isOwner) {
              // Active unexpired lease held by another worker
              return { claimed: false, reason: 'LEASE_CONFLICT' };
            }

            opVersion = (op.leaseVersion || 0) + 1;
            attemptCount = (op.attemptCount || 0) + 1;
            await tx.accountDeletionOperation.update({
              where: { id: op.id },
              data: {
                status: 'IN_PROGRESS',
                startedAt: now,
                destructiveStartedAt: op.destructiveStartedAt || now,
                attemptCount,
                leaseOwner,
                leaseVersion: opVersion,
                leaseExpiresAt: leaseExpiry,
              },
            });
            opId = op.id;
          }

          // Fetch bills to delete
          const userBills = await tx.bill.findMany({
            where: { userId: u.id },
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
          const nextRetryAt = new Date(Date.now() + backoffMs);

          const updated = await prismaClient.$queryRaw<Array<{ id: string }>>`
            UPDATE "AccountDeletionOperation"
            SET "status" = 'FAILED_RETRYABLE',
                "nextRetryAt" = ${nextRetryAt},
                "lastError" = ${`Failed to delete ${failedFileKeys.length} invoice file(s) from storage: ${failedFileKeys.join(', ')}`},
                "failedFileKeys" = ${JSON.stringify(failedFileKeys)}::jsonb,
                "deletedFilesCount" = ${deletedFilesCount},
                "leaseExpiresAt" = NULL
            WHERE "id" = ${operationId}
              AND "leaseOwner" = ${leaseOwner}
              AND "leaseVersion" = ${currentLeaseVersion}
              AND "status" = 'IN_PROGRESS'
              AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
            RETURNING "id"
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
            error: `Storage file deletion failed for ${failedFileKeys.length} file(s); scheduled for retry at ${nextRetryAt.toISOString()}`,
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

          // Check if user remains due for deletion and not already cancelled
          if (!lockedUser.deletionScheduledAt) {
            throw new Error(`[ACCOUNT-DELETION] User ${u.id} deletion schedule is not set or was cancelled.`);
          }

          if (new Date(lockedUser.deletionScheduledAt) > new Date()) {
            throw new Error(`[ACCOUNT-DELETION] User ${u.id} deletion grace period has not expired.`);
          }

          if (lockedUser.status === 'SUSPENDED' && lockedUser.mobile.startsWith('DEL_')) {
            // Already anonymized
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

          // 3. Purge active push tokens, redact AppInstallation, sessions, and OTP requests
          await tx.pushDeviceToken.deleteMany({ where: { userId: u.id } });
          await tx.appInstallation.updateMany({
            where: { userId: u.id },
            data: { userId: null, pushToken: null },
          });
          await tx.authSession.deleteMany({ where: { userId: u.id } });
          await tx.otpRequest.deleteMany({ where: { mobile: lockedUser.mobile } });

          // 4. Purge sensitive KYC records while retaining anonymous status
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

          // 5. Purge sensitive payout account details
          await tx.paymentAccount.updateMany({
            where: { userId: u.id },
            data: {
              upiId: null,
              accountHolderName: 'ANONYMIZED',
              providerRegisteredName: 'ANONYMIZED',
              accountNumber: null,
              accountNumberEncrypted: null,
              ifscCode: null,
              bankName: null,
              maskedInfo: 'XXXX0000',
            },
          });

          // 6. Anonymize User record (retain ID for ledger foreign keys)
          const anonymizedMobile = `DEL_${u.id.replace(/-/g, '').slice(0, 8)}_${Date.now()}`;
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
}
