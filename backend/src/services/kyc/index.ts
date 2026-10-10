import { prisma } from '../../db';
import { config } from '../../config';
import { KycProvider } from './kyc.interface';
import { SignCareKycProvider } from './signcare.provider';
import { MockKycProvider } from './mock.provider';
import { encryptSensitive, generateBlindIndex } from '../../utils/crypto.utils';

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

  static async submitPan(userId: string, panNumber: string, panName: string, requestId?: string) {
    const cleanPan = panNumber.trim().toUpperCase();
    const cleanName = panName.trim();

    // 1. Strict Indian Income Tax PAN syntax format: 5 letters, 4 numbers, 1 letter
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(cleanPan)) {
      throw new Error('Invalid PAN format. Please enter a valid 10-character Indian PAN (e.g. ABCDE1234F).');
    }

    if (!cleanName) {
      throw new Error('Full Name as registered on PAN card is required.');
    }

    // 2. Check cross-user uniqueness using keyed blind index
    const panBlindIndex = generateBlindIndex(cleanPan);
    const existingOther = await prisma.kycRecord.findFirst({
      where: {
        OR: [
          { panBlindIndex },
          { panNumber: cleanPan },
        ],
        userId: { not: userId },
        panStatus: 'VERIFIED',
      },
    });

    if (existingOther) {
      throw new Error('This PAN number is already verified with another user account.');
    }

    // 3. Dispatch to KYC Provider
    const provider = this.getProvider();
    const result = await provider.verifyPan({
      panNumber: cleanPan,
      panName: cleanName,
      userId,
      requestId,
    });

    if (!result.isValid) {
      // Record failed KYC audit
      await prisma.auditLog.create({
        data: {
          action: 'KYC_FAILED',
          entityType: 'KycRecord',
          entityId: userId,
          newValue: `PAN ${this.maskPan(cleanPan)} failed: ${result.rejectionReason}`,
        },
      });

      throw new Error(result.rejectionReason || 'PAN verification failed with tax records.');
    }

    const maskedPan = this.maskPan(cleanPan);
    const encryptedPan = encryptSensitive(cleanPan);

    // 4. Upsert User KYC Record with encrypted PAN and blind index (no plaintext)
    const existingRecord = await prisma.kycRecord.findFirst({
      where: { userId },
    });

    let kyc;
    if (existingRecord) {
      kyc = await prisma.kycRecord.update({
        where: { id: existingRecord.id },
        data: {
          panNumber: null,
          panBlindIndex,
          panName: result.panName || cleanName,
          panStatus: 'VERIFIED',
          maskedPan,
          panNumberEncrypted: encryptedPan,
          provider: provider.name,
          providerRequestId: result.providerRequestId,
          verifiedAt: new Date(),
          rejectionReason: null,
        },
      });
    } else {
      kyc = await prisma.kycRecord.create({
        data: {
          userId,
          panNumber: null,
          panBlindIndex,
          panName: result.panName || cleanName,
          panStatus: 'VERIFIED',
          maskedPan,
          panNumberEncrypted: encryptedPan,
          provider: provider.name,
          providerRequestId: result.providerRequestId,
          verifiedAt: new Date(),
        },
      });
    }

    // 5. Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'KYC_VERIFIED',
        entityType: 'KycRecord',
        entityId: kyc.id,
        newValue: `PAN verified via ${provider.name} (${maskedPan})`,
      },
    });

    return kyc;
  }

  static async getUserKycStatus(userId: string) {
    const kyc = await prisma.kycRecord.findFirst({
      where: { userId },
    });

    if (!kyc) {
      return { isVerified: false, status: 'NOT_SUBMITTED' };
    }

    return {
      isVerified: kyc.panStatus === 'VERIFIED',
      status: kyc.panStatus,
      maskedPan: kyc.maskedPan,
      verifiedName: kyc.panName,
      verifiedAt: kyc.verifiedAt,
      provider: kyc.provider,
    };
  }

  static async getUserKyc(userId: string) {
    return this.getUserKycStatus(userId);
  }
}
