import bcrypt from 'bcryptjs';
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
   * Atomically sets deletionRequestedAt, deletionScheduledAt (+7 days), and lastDeletionRequestAt.
   * Revokes all active user sessions immediately.
   */
  static async confirmDeletion(userId: string, otpCode: string, ipAddress?: string) {
    if (!otpCode || !otpCode.trim()) {
      throw new Error('Verification OTP code is required to confirm account deletion.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    // Re-enforce 30-day cooldown check
    if (user.lastDeletionRequestAt && !user.deletionScheduledAt) {
      const cooldownMs = this.COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const elapsedMs = Date.now() - user.lastDeletionRequestAt.getTime();
      if (elapsedMs < cooldownMs) {
        const remainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
        throw new Error(
          `Another deletion request cannot be submitted within 30 days of the previous request. Please try again in ${remainingDays} day(s).`
        );
      }
    }

    // Verify OTP atomically
    await AuthService.verifyOtp({
      mobile: user.mobile,
      otpCode: otpCode.trim(),
      purpose: 'ACCOUNT_DELETION' as any,
    });

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      // 1. Update User deletion lifecycle fields
      await tx.user.update({
        where: { id: user.id },
        data: {
          deletionRequestedAt: now,
          deletionScheduledAt: scheduledAt,
          lastDeletionRequestAt: now,
          activeSessionId: null,
        },
      });

      // 2. Invalidate all active sessions immediately
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      // 3. Deactivate all push device tokens
      await tx.pushDeviceToken.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });

      // 4. Record AccountDeletionOperation
      await tx.accountDeletionOperation.create({
        data: {
          userId: user.id,
          status: 'PENDING',
          scheduledFor: scheduledAt,
        },
      });

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          action: 'ACCOUNT_DELETION_SCHEDULED',
          entityType: 'User',
          entityId: user.id,
          newValue: JSON.stringify({
            userId: user.id,
            requestedAt: now,
            scheduledAt,
            gracePeriodDays: this.GRACE_PERIOD_DAYS,
          }),
          ipAddress,
        },
      });
    });

    return {
      success: true,
      deletionScheduledAt: scheduledAt.toISOString(),
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
      message: `Your account deletion is scheduled for ${scheduledAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}. Logging in during this 7-day grace period will automatically cancel the deletion.`,
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
  static async processScheduledDeletions(prismaClient: any = prisma, assertLease?: () => void): Promise<{
    processedCount: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    const now = new Date();
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
        // 1. Claim or retrieve AccountDeletionOperation
        let operation = await prismaClient.accountDeletionOperation.findFirst({
          where: { userId: u.id, status: { in: ['PENDING', 'FAILED_RETRYABLE', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'desc' },
        });

        if (!operation) {
          operation = await prismaClient.accountDeletionOperation.create({
            data: {
              userId: u.id,
              status: 'IN_PROGRESS',
              scheduledFor: u.deletionScheduledAt || now,
              startedAt: now,
            },
          });
        } else {
          // If in retry backoff window, skip until nextRetryAt
          if (operation.nextRetryAt && operation.nextRetryAt > now) {
            continue;
          }
          operation = await prismaClient.accountDeletionOperation.update({
            where: { id: operation.id },
            data: { status: 'IN_PROGRESS', startedAt: now },
          });
        }

        // 2. Delete private invoice files from Cloudflare R2 storage
        const failedFileKeys: string[] = [];
        let deletedFilesCount = 0;

        for (const bill of u.bills) {
          if (bill.fileKey) {
            try {
              await StorageService.getProvider().delete(bill.fileKey);
              deletedFilesCount++;
            } catch (storageErr: any) {
              console.warn(`[ACCOUNT-DELETION] Failed to delete file ${bill.fileKey} for bill ${bill.id}:`, storageErr.message);
              failedFileKeys.push(bill.fileKey);
            }
          }
        }

        // If any R2 delete fails: record failed file keys, increment attemptCount,
        // set status = 'FAILED_RETRYABLE' with exponential backoff, DO NOT anonymize user or mark complete.
        if (failedFileKeys.length > 0) {
          const attemptCount = (operation.attemptCount || 0) + 1;
          const backoffMs = Math.min(5 * 60 * 1000 * Math.pow(2, attemptCount - 1), 24 * 60 * 60 * 1000);
          const nextRetryAt = new Date(now.getTime() + backoffMs);

          await prismaClient.accountDeletionOperation.update({
            where: { id: operation.id },
            data: {
              status: 'FAILED_RETRYABLE',
              attemptCount,
              nextRetryAt,
              lastError: `Failed to delete ${failedFileKeys.length} invoice file(s) from storage: ${failedFileKeys.join(', ')}`,
              failedFileKeys: failedFileKeys,
              deletedFilesCount,
            },
          });

          errors.push({
            userId: u.id,
            error: `Storage file deletion failed for ${failedFileKeys.length} file(s); scheduled for retry at ${nextRetryAt.toISOString()}`,
          });
          continue;
        }

        // 3. All files verified deleted. Verify lease ownership before irreversible anonymization.
        assertLease?.();

        // Re-validate: cancellation check - user may have logged in during processing
        const freshUser = await prismaClient.user.findUnique({ where: { id: u.id } });
        if (!freshUser || !freshUser.deletionScheduledAt) {
          // Deletion was cancelled (user logged in during grace period)
          await prismaClient.accountDeletionOperation.updateMany({
            where: { id: operation.id, status: { in: ['IN_PROGRESS', 'PENDING'] } },
            data: { status: 'CANCELLED', completedAt: new Date() },
          });
          continue;
        }

        // Anonymize personal profile and purge credentials atomically
        await prismaClient.$transaction(async (tx: any) => {
          // Delete active tokens and sessions
          await tx.pushDeviceToken.deleteMany({ where: { userId: u.id } });
          // Redact AppInstallation records: remove userId link and stored push token
          await tx.appInstallation.updateMany({
            where: { userId: u.id },
            data: { userId: null, pushToken: null },
          });
          await tx.authSession.deleteMany({ where: { userId: u.id } });
          await tx.otpRequest.deleteMany({ where: { mobile: u.mobile } });

          // Purge sensitive KYC records while retaining anonymous status
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

          // Purge sensitive payout account details
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

          // Anonymize User record (retain ID for ledger foreign keys)
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

          // Complete the tracking operation
          await tx.accountDeletionOperation.update({
            where: { id: operation.id },
            data: {
              status: 'COMPLETED',
              completedAt: now,
              deletedFilesCount,
              failedFileKeys: null,
            },
          });

          // Audit Log
          await tx.auditLog.create({
            data: {
              action: 'ACCOUNT_DELETION_EXECUTED',
              entityType: 'User',
              entityId: u.id,
              newValue: JSON.stringify({
                userId: u.id,
                operationId: operation.id,
                executedAt: now,
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
