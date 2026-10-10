import { PrismaClient } from '@prisma/client';
import { encryptSensitive, decryptSensitive, generateBlindIndex } from '../utils/crypto.utils';
import { KycService } from '../services/kyc';

export interface PanMigrationSummary {
  totalFound: number;
  migrated: number;
  skippedAlreadyEncrypted: number;
  failed: number;
  errors: Array<{ recordId: string; reason: string }>;
}

/**
 * Forward-only, resumable, idempotent legacy PAN migration and blind-index backfill runner.
 * Encrypts legacy plaintext PAN records using AES-256-GCM, generates keyed blind index,
 * verifies decryption integrity, and securely nulls legacy plaintext.
 * Never outputs raw PAN numbers in logs or reports.
 */
export async function migrateLegacyPanRecords(prisma: PrismaClient): Promise<PanMigrationSummary> {
  const summary: PanMigrationSummary = {
    totalFound: 0,
    migrated: 0,
    skippedAlreadyEncrypted: 0,
    failed: 0,
    errors: [],
  };

  // Find all records that have legacy plaintext panNumber
  const legacyRecords = await prisma.kycRecord.findMany({
    where: {
      panNumber: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  summary.totalFound = legacyRecords.length;

  for (const record of legacyRecords) {
    try {
      const rawPan = record.panNumber;
      if (!rawPan) {
        summary.skippedAlreadyEncrypted++;
        continue;
      }

      const cleanPan = rawPan.trim().toUpperCase();
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

      if (!panRegex.test(cleanPan)) {
        summary.failed++;
        summary.errors.push({
          recordId: record.id,
          reason: 'Malformed legacy PAN format. Record held for manual compliance review.',
        });
        continue;
      }

      const blindIndex = generateBlindIndex(cleanPan);

      // Check for duplicate blind index on another record
      const duplicateRecord = await prisma.kycRecord.findFirst({
        where: {
          panBlindIndex: blindIndex,
          id: { not: record.id },
          panStatus: 'VERIFIED',
        },
      });

      if (duplicateRecord) {
        summary.failed++;
        summary.errors.push({
          recordId: record.id,
          reason: 'Duplicate verified PAN detected during backfill.',
        });
        continue;
      }

      const encryptedPan = encryptSensitive(cleanPan);

      // Verify that decryption matches cleanPan exactly before clearing plaintext
      const decryptedVerification = decryptSensitive(encryptedPan);
      if (decryptedVerification !== cleanPan) {
        summary.failed++;
        summary.errors.push({
          recordId: record.id,
          reason: 'Cryptographic roundtrip verification failed. Plaintext preserved for recovery.',
        });
        continue;
      }

      const maskedPan = KycService.maskPan(cleanPan);

      // Atomically update record and null plaintext
      await prisma.kycRecord.update({
        where: { id: record.id },
        data: {
          panNumberEncrypted: encryptedPan,
          panBlindIndex: blindIndex,
          maskedPan,
          panNumber: null, // Safely cleared only after encryption verification succeeds
        },
      });

      summary.migrated++;
    } catch (err: any) {
      summary.failed++;
      summary.errors.push({
        recordId: record.id,
        reason: `Unexpected processing error: ${err.message}`,
      });
    }
  }

  return summary;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  migrateLegacyPanRecords(prisma)
    .then((result) => {
      console.log('✅ Legacy PAN Migration Complete:', {
        totalFound: result.totalFound,
        migrated: result.migrated,
        skippedAlreadyEncrypted: result.skippedAlreadyEncrypted,
        failed: result.failed,
      });
      process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal error during PAN migration:', err.message);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
