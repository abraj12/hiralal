import { dbStore, KycRecordData } from '../db/store';

export class KycService {
  /**
   * Verifies Indian PAN number format and performs KYC verification.
   * Standard PAN regex: 5 uppercase letters, 4 digits, 1 uppercase letter.
   */
  static async verifyPan(userId: string, panNumber: string, panName: string): Promise<KycRecordData> {
    const cleanPan = panNumber.trim().toUpperCase();
    const cleanName = panName.trim().toUpperCase();

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(cleanPan)) {
      throw new Error('Invalid PAN format. PAN must be 10 characters (e.g. ABCDE1234F).');
    }

    if (!cleanName || cleanName.length < 3) {
      throw new Error('Please enter the full name as registered on the PAN card.');
    }

    // Check if PAN is already verified by another user
    const existingOther = Array.from(dbStore.kycRecords.values()).find(
      k => k.panNumber === cleanPan && k.userId !== userId && k.panStatus === 'VERIFIED'
    );

    if (existingOther) {
      throw new Error('This PAN number is already linked to another registered account.');
    }

    // Masked PAN: First 5 letters, 4 asterisks, last letter
    const maskedPan = `${cleanPan.substring(0, 5)}••••${cleanPan.substring(9)}`;

    let kycRecord = Array.from(dbStore.kycRecords.values()).find(k => k.userId === userId);
    if (!kycRecord) {
      kycRecord = {
        id: `kyc-${Date.now()}`,
        userId,
        panNumber: cleanPan,
        panName: cleanName,
        panStatus: 'VERIFIED',
        maskedPan,
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      kycRecord.panNumber = cleanPan;
      kycRecord.panName = cleanName;
      kycRecord.panStatus = 'VERIFIED';
      kycRecord.maskedPan = maskedPan;
      kycRecord.verifiedAt = new Date();
      kycRecord.updatedAt = new Date();
    }

    dbStore.kycRecords.set(kycRecord.id, kycRecord);

    return kycRecord;
  }

  static getUserKyc(userId: string): KycRecordData | null {
    return Array.from(dbStore.kycRecords.values()).find(k => k.userId === userId) || null;
  }
}
