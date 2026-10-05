import { StorageService } from '../services/storage';
import { KycService } from '../services/kyc';
import { BillService } from '../services/bill.service';
import { prisma } from '../db';
import { decryptSensitive } from '../utils/crypto.utils';

describe('Storage Magic-Byte Security & KYC Provider Validation Tests', () => {
  let user1: any;
  let user2: any;

  beforeAll(async () => {
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: ['9555555551', '9555555552'] } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: ['9555555551', '9555555552'] } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: ['9555555551', '9555555552'] } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: ['9555555551', '9555555552'] } } });

    user1 = await prisma.user.create({
      data: {
        mobile: '9555555551',
        fullName: 'Craftsman Alpha',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    user2 = await prisma.user.create({
      data: {
        mobile: '9555555552',
        fullName: 'Craftsman Beta',
        passwordHash: 'hash',
        profession: 'TILE_INSTALLER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.bill.deleteMany({ where: { userId: { in: [user1.id, user2.id] } } });
    await prisma.kycRecord.deleteMany({ where: { userId: { in: [user1.id, user2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
  });

  describe('Storage Magic-Byte Verification', () => {
    test('1. Genuine JPEG magic bytes (FF D8 FF) pass validation', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const result = StorageService.validateMagicBytes(jpegBuffer);
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/jpeg');
    });

    test('2. Genuine PNG magic bytes (89 50 4E 47) pass validation', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = StorageService.validateMagicBytes(pngBuffer);
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('image/png');
    });

    test('3. Genuine PDF magic bytes (%PDF) pass validation', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%test invoice stream');
      const result = StorageService.validateMagicBytes(pdfBuffer);
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('application/pdf');
    });

    test('4. Spoofed plain text renamed to .jpg fails magic-byte check', () => {
      const spoofedBuffer = Buffer.from('Just plain text inside an invoice.jpg file');
      expect(() => {
        StorageService.validateAndHashFile({
          buffer: spoofedBuffer,
          originalFilename: 'malicious_invoice.jpg',
          mimeType: 'image/jpeg',
        });
      }).toThrow(/genuine JPEG, PNG, WEBP, or PDF/i);
    });

    test('5. Disallowed file extensions (.exe, .sh) are rejected', () => {
      const execBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(() => {
        StorageService.validateAndHashFile({
          buffer: execBuffer,
          originalFilename: 'exploit.exe',
          mimeType: 'application/octet-stream',
        });
      }).toThrow(/Invalid file extension/i);
    });

    test('6. Cross-user document duplicate rejection via SHA-256', async () => {
      const sharedDocBuffer = Buffer.from('%PDF-1.4 Cross user identical document payload ' + Date.now());

      // User 1 submits bill
      await BillService.submitBill({
        userId: user1.id,
        invoiceNumber: `INV-U1-${Date.now()}`,
        invoiceDate: '2026-10-01',
        billAmount: 12000,
        fileBuffer: sharedDocBuffer,
        fileName: 'invoice1.pdf',
        mimeType: 'application/pdf',
      });

      // User 2 tries to submit identical document!
      await expect(
        BillService.submitBill({
          userId: user2.id,
          invoiceNumber: `INV-U2-${Date.now()}`,
          invoiceDate: '2026-10-01',
          billAmount: 12000,
          fileBuffer: sharedDocBuffer,
          fileName: 'invoice2.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/Duplicate documents are rejected/i);
    });
  });

  describe('KYC PAN Validation & Sensitive Data Encryption', () => {
    test('1. Rejects invalid PAN syntax format', async () => {
      // Missing digit
      await expect(KycService.submitPan(user1.id, 'ABC1234F', 'Name')).rejects.toThrow(/Invalid PAN format/i);
      // Wrong character structure
      await expect(KycService.submitPan(user1.id, '12345ABCDE', 'Name')).rejects.toThrow(/Invalid PAN format/i);
    });

    test('2. Valid PAN format passes, gets encrypted with AES-256-GCM, and masked', async () => {
      const pan = 'BNZPA1234K';
      const record = await KycService.submitPan(user1.id, pan, 'Craftsman Alpha');

      expect(record.panStatus).toBe('VERIFIED');
      expect(record.maskedPan).toBe('BNZPA••••K');
      expect(record.panNumberEncrypted).toBeDefined();

      // Verify AES-256-GCM encryption is reversible only with server encryption key
      const decrypted = decryptSensitive(record.panNumberEncrypted!);
      expect(decrypted).toBe(pan);
    });

    test('3. Rejects duplicate PAN across different users', async () => {
      // User 2 attempts to claim User 1's already verified PAN
      await expect(
        KycService.submitPan(user2.id, 'BNZPA1234K', 'Craftsman Beta')
      ).rejects.toThrow(/already verified with another user/i);
    });
  });
});
