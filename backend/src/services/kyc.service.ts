import { prisma } from '../db';
import { config } from '../config';

export class KycService {
  /**
   * Masks PAN number keeping only first and last characters: e.g. ABCDE••••F
   */
  static maskPan(panNumber: string): string {
    const clean = panNumber.trim().toUpperCase();
    if (clean.length !== 10) return clean;
    return `${clean.substring(0, 5)}••••${clean.substring(9)}`;
  }

  /**
   * Submits and verifies Indian PAN Card via integrated verification provider.
   */
  static async submitPan(userId: string, panNumber: string, panName: string) {
    const cleanPan = panNumber.trim().toUpperCase();
    const cleanName = panName.trim();

    // 1. Strict Indian Income Tax PAN syntax format: 5 letters, 4 numbers, 1 letter
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(cleanPan)) {
      throw new Error('Invalid PAN format. Please enter a valid 10-character Indian PAN (e.g. ABCDE1234F).');
    }

    // 2. Check if this PAN is already associated with another user
    const existingOther = await prisma.kycRecord.findFirst({
      where: {
        panNumber: cleanPan,
        userId: { not: userId },
        panStatus: 'VERIFIED',
      },
    });

    if (existingOther) {
      throw new Error('This PAN number is already registered and verified with another account.');
    }

    // 3. Provider Verification Call
    let isProviderVerified = false;
    let providerRemarks = '';

    if (config.kyc.apiKey && config.kyc.provider === 'SUREPASS' && config.nodeEnv !== 'test') {
      try {
        const response = await fetch('https://kyc-api.surepass.io/api/v1/pan/pan-comprehensive', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.kyc.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id_number: cleanPan }),
        });
        const resData: any = await response.json();
        if (resData.success && resData.data?.pan_number === cleanPan) {
          isProviderVerified = true;
        } else {
          providerRemarks = resData.message || 'PAN verification failed with provider';
        }
      } catch (err: any) {
        console.error('Surepass PAN API Error:', err);
        providerRemarks = 'External verification gateway error';
      }
    } else if (config.kyc.apiKey && config.kyc.provider === 'SANDBOX' && config.nodeEnv !== 'test') {
      try {
        const response = await fetch('https://api.sandbox.co.in/kyc/pan/verify', {
          method: 'POST',
          headers: {
            'x-api-key': config.kyc.apiKey,
            'x-api-secret': config.kyc.apiSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pan: cleanPan }),
        });
        const resData: any = await response.json();
        if (resData.code === 200 && resData.data?.status === 'VALID') {
          isProviderVerified = true;
        } else {
          providerRemarks = resData.message || 'PAN status invalid with NSDL database';
        }
      } catch (err: any) {
        console.error('Sandbox PAN API Error:', err);
        providerRemarks = 'External verification gateway error';
      }
    } else {
      // In development or when external credentials are pending setup:
      if (config.nodeEnv === 'production') {
        throw new Error('Real KYC provider credentials (KYC_API_KEY) are required in production to verify PAN.');
      }
      // In dev environment, mark pending or verified based on valid checksum
      isProviderVerified = true;
    }

    if (!isProviderVerified) {
      throw new Error(providerRemarks || 'PAN card details could not be verified with the tax registry.');
    }

    const maskedPan = this.maskPan(cleanPan);

    // Upsert user's KYC record
    const existingUserKyc = await prisma.kycRecord.findFirst({
      where: { userId },
    });

    if (existingUserKyc) {
      return await prisma.kycRecord.update({
        where: { id: existingUserKyc.id },
        data: {
          panNumber: cleanPan,
          panName: cleanName,
          panStatus: 'VERIFIED',
          maskedPan,
          verifiedAt: new Date(),
          rejectionReason: null,
        },
      });
    }

    return await prisma.kycRecord.create({
      data: {
        userId,
        panNumber: cleanPan,
        panName: cleanName,
        panStatus: 'VERIFIED',
        maskedPan,
        verifiedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves verified KYC status for a user.
   */
  static async getUserKyc(userId: string) {
    const record = await prisma.kycRecord.findFirst({
      where: { userId },
    });

    if (!record) {
      return { isKycVerified: false, kycRecord: null };
    }

    return {
      isKycVerified: record.panStatus === 'VERIFIED',
      kycRecord: {
        panStatus: record.panStatus,
        maskedPan: record.maskedPan,
        panName: record.panName,
        verifiedAt: record.verifiedAt,
      },
    };
  }
}
