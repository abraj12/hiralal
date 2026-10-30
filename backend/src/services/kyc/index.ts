import { prisma } from '../../db';
import { config } from '../../config';
import { KycProvider } from './kyc.interface';
import { SignCareKycProvider } from './signcare.provider';
import { MockKycProvider } from './mock.provider';
import { encryptSensitive, generateBlindIndex } from '../../utils/crypto.utils';
import { compareNames } from '../../utils/name.utils';

function maskNameForAudit(name: string): string {
  if (!name) return '***';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2) return part[0] + '*';
      return part[0] + '*'.repeat(Math.min(part.length - 2, 4)) + part.slice(-1);
    })
    .join(' ');
}

export class KycService {
  private static provider: KycProvider | null = null;

  static getProvider(): KycProvider {
    if (this.provider) return this.provider;

    if (config.nodeEnv === 'test') {
      this.provider = new MockKycProvider();
      return this.provider;
    }

    this.provider = new SignCareKycProvider();
    return this.provider;
  }

  static setProvider(customProvider: KycProvider) {
    this.provider = customProvider;
  }

  static maskPan(panNumber: string): string {
    const clean = panNumber.trim().toUpperCase();
    if (clean.length !== 10) return clean;
    return `${clean.substring(0, 5)}••••${clean.substring(9)}`;
  }

  /**
   * Submits PAN for identity verification during first redemption:
   * 1. Validates explicit user consent.
   * 2. Checks Indian PAN syntax.
   * 3. Checks cross-user duplicate blind index.
   * 4. Queries verified KYC provider.
   * 5. Validates authoritative provider name and compares against account name.
   * 6. Atomically locks user name only after successful name match.
   */
  static async submitPan(
    userIdOrParams:
      | string
      | {
          userId: string;
          panNumber: string;
          panName: string;
          consent?: boolean;
          consentText?: string;
          requestId?: string;
        },
    panNumberArg?: string,
    panNameArg?: string,
    consentArg?: boolean,
    consentTextArg?: string,
    requestIdArg?: string
  ) {
    let userId: string;
    let panNumber: string;
    let panName: string;
    let consent: boolean;
    let consentText: string | undefined;
    let requestId: string | undefined;

    if (typeof userIdOrParams === 'object') {
      userId = userIdOrParams.userId;
      panNumber = userIdOrParams.panNumber;
      panName = userIdOrParams.panName;
      consent = userIdOrParams.consent === true;
      consentText = userIdOrParams.consentText;
      requestId = userIdOrParams.requestId;
    } else {
      userId = userIdOrParams;
      panNumber = panNumberArg!;
      panName = panNameArg!;
      consent = consentArg === true || (consentArg === undefined && config.nodeEnv === 'test');
      consentText = consentTextArg;
      requestId = requestIdArg;
    }

    // 1. Enforce explicit user informed consent
    if (consent !== true) {
      throw new Error('User informed consent is mandatory before submitting PAN identity for verification.');
    }

    const cleanPan = (panNumber || '').trim().toUpperCase();
    const cleanName = (panName || '').trim();

    // 2. Strict Indian Income Tax PAN syntax format: 5 letters, 4 numbers, 1 letter
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(cleanPan)) {
      throw new Error('Invalid PAN format. Please enter a valid 10-character Indian PAN (e.g. ABCDE1234F).');
    }

    if (!cleanName) {
      throw new Error('Full Name as registered on PAN card is required.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new Error('User not found.');
    }
    if (user.role !== 'USER') {
      throw new Error('Only registered users can complete KYC verification.');
    }
    if (user.status !== 'ACTIVE') {
      throw new Error('User account is suspended or inactive.');
    }

    // 3. Check cross-user uniqueness using keyed blind index
    const panBlindIndex = generateBlindIndex(cleanPan);

    // Prevent overwriting existing verified PAN identity without administrative approval
    const existingUserKyc = await prisma.kycRecord.findFirst({
      where: { userId, panStatus: 'VERIFIED' },
    });
    if (existingUserKyc) {
      if (existingUserKyc.panBlindIndex && existingUserKyc.panBlindIndex !== panBlindIndex) {
        throw new Error(
          'Your PAN identity is already verified. Changing a verified PAN requires administrative review and approval.'
        );
      }
      return existingUserKyc;
    }

    // HIR-M-01: Only a VERIFIED record proves ownership of a PAN. Unverified or mononymous-review
    // records from another account must not be able to block the genuine PAN holder.
    const existingOther = await prisma.kycRecord.findFirst({
      where: {
        OR: [{ panBlindIndex }, { panNumber: cleanPan }],
        userId: { not: userId },
        panStatus: 'VERIFIED',
      },
    });

    if (existingOther) {
      throw new Error('This PAN number is already verified with another user account.');
    }

    // 4. Dispatch to KYC Provider
    const provider = this.getProvider();
    const result = await provider.verifyPan({
      panNumber: cleanPan,
      panName: cleanName,
      userId,
      consent: true,
      consentText,
      requestId,
    });

    if (!result.isValid || !result.panName) {
      await prisma.auditLog.create({
        data: {
          action: 'KYC_FAILED',
          entityType: 'KycRecord',
          entityId: userId,
          newValue: `PAN ${this.maskPan(cleanPan)} failed: ${result.rejectionReason || 'Provider verification rejected'}`,
        },
      });

      throw new Error(result.rejectionReason || 'PAN verification failed with tax records.');
    }

    // 5. Compare authoritative provider name with User account name
    const verifiedPanName = result.panName.trim();
    const isNameMatched = compareNames(user.fullName, verifiedPanName);

    if (!isNameMatched) {
      const userTokens = user.fullName.trim().split(/\s+/);
      const panTokens = verifiedPanName.split(/\s+/);
      const isMononymousCandidate = userTokens.length === 1 || panTokens.length === 1;

      // VULN-MED-19: Minimize PII in immutable audit logs by masking names
      await prisma.auditLog.create({
        data: {
          action: isMononymousCandidate ? 'KYC_MONONYMOUS_REVIEW_REQUIRED' : 'KYC_NAME_MISMATCH',
          entityType: 'KycRecord',
          entityId: userId,
          newValue: isMononymousCandidate
            ? `Single-token mononymous name flagged for manual review: User "${maskNameForAudit(user.fullName)}" vs PAN "${maskNameForAudit(verifiedPanName)}"`
            : `Account name "${maskNameForAudit(user.fullName)}" did not match PAN holder name "${maskNameForAudit(verifiedPanName)}"`,
        },
      });

      if (isMononymousCandidate) {
        // HIR-M-01: The review record never claims the unique PAN blind index; Operations Admin
        // assigns it only on manual approval, after a VERIFIED-only duplicate check.
        const mononymousReviewReason =
          'MONONYMOUS_APPLICANT_MANUAL_REVIEW_REQUIRED: Single-name applicant requires authorized manual document review.';
        const pendingReviewData = {
          panName: verifiedPanName,
          maskedPan: this.maskPan(cleanPan),
          panNumberEncrypted: encryptSensitive(cleanPan),
          panBlindIndex: null,
          provider: 'SIGNCARE',
          providerRequestId: result.providerRequestId || null,
          nameMatched: false,
          rejectionReason: mononymousReviewReason,
          consent: true,
          consentTimestamp: new Date(),
        };
        const existingPending = await prisma.kycRecord.findFirst({
          where: { userId, panStatus: 'PENDING', rejectionReason: { startsWith: 'MONONYMOUS_APPLICANT_MANUAL_REVIEW_REQUIRED:' } },
          orderBy: { createdAt: 'desc' },
        });

        if (existingPending) {
          await prisma.kycRecord.update({ where: { id: existingPending.id }, data: pendingReviewData });
        } else {
          await prisma.kycRecord.create({
            data: { userId, panStatus: 'PENDING', ...pendingReviewData },
          });
        }

        throw new Error(
          'Your profile name appears to be a single name (mononymous). To protect your financial security, your PAN verification has been submitted for manual administrator review.'
        );
      }

      throw new Error(
        // HIR-M-01: Never disclose the provider-verified PAN holder name to the requester.
        'Name mismatch: Your account name does not match the name registered with this PAN. Please make sure your profile name exactly matches your PAN card.'
      );
    }

    const maskedPan = this.maskPan(cleanPan);
    const encryptedPan = encryptSensitive(cleanPan);

    // 6. Atomically persist KYC record and lock user name
    const kyc = await prisma.$transaction(async (tx) => {
      // HIR-M-01: Release the unique blind index from any other account's unverified record
      // (e.g. created before this fix) so the verified PAN holder can claim it.
      await tx.kycRecord.updateMany({
        where: { panBlindIndex, userId: { not: userId }, panStatus: { not: 'VERIFIED' } },
        data: { panBlindIndex: null },
      });

      const existingRecord = await tx.kycRecord.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      let updatedKyc;
      if (existingRecord) {
        updatedKyc = await tx.kycRecord.update({
          where: { id: existingRecord.id },
          data: {
            panNumber: null,
            panBlindIndex,
            panName: cleanName,
            verifiedName: verifiedPanName,
            nameMatched: true,
            mononymousApproved: false,
            panStatus: 'VERIFIED',
            maskedPan,
            panNumberEncrypted: encryptedPan,
            provider: provider.name,
            providerRequestId: result.providerRequestId,
            consent: true,
            consentText: consentText || 'I provide consent to verify my PAN identity for rewards payout compliance.',
            consentTimestamp: new Date(),
            verifiedAt: new Date(),
            rejectionReason: null,
          },
        });
      } else {
        updatedKyc = await tx.kycRecord.create({
          data: {
            userId,
            panNumber: null,
            panBlindIndex,
            panName: cleanName,
            verifiedName: verifiedPanName,
            nameMatched: true,
            mononymousApproved: false,
            panStatus: 'VERIFIED',
            maskedPan,
            panNumberEncrypted: encryptedPan,
            provider: provider.name,
            providerRequestId: result.providerRequestId,
            consent: true,
            consentText: consentText || 'I provide consent to verify my PAN identity for rewards payout compliance.',
            consentTimestamp: new Date(),
            verifiedAt: new Date(),
          },
        });
      }

      // Lock user name against normal user edits
      await tx.user.update({
        where: { id: userId },
        data: {
          isNameLocked: true,
          nameLockedAt: new Date(),
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'KYC_VERIFIED',
          entityType: 'KycRecord',
          entityId: updatedKyc.id,
          newValue: `PAN verified via ${provider.name} (${maskedPan}), name matched and locked.`,
        },
      });

      return updatedKyc;
    });

    return kyc;
  }

  static async getUserKycStatus(userId: string) {
    const kyc = await prisma.kycRecord.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!kyc) {
      return { isVerified: false, status: 'NOT_SUBMITTED' };
    }

    return {
      isVerified: kyc.panStatus === 'VERIFIED' && kyc.nameMatched,
      status: kyc.panStatus,
      maskedPan: kyc.maskedPan,
      verifiedName: kyc.verifiedName || kyc.panName,
      nameMatched: kyc.nameMatched,
      verifiedAt: kyc.verifiedAt,
      provider: kyc.provider,
    };
  }

  static async getUserKyc(userId: string) {
    return this.getUserKycStatus(userId);
  }
}
