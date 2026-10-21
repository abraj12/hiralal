/**
 * Database Field Re-Encryption Migration Utility
 * Rotates database-level field encryption keys for KycRecord and PaymentAccount.
 * 
 * Usage:
 *   npx ts-node scripts/reencrypt-sensitive-fields.ts [--dry-run|--commit]
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const HKDF_FIELD_ENC_INFO = Buffer.from('hiralal-field-encryption-v1');

function deriveKey(secret: string): Buffer {
  const keyMaterial = Buffer.from(secret, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', keyMaterial, Buffer.alloc(0), HKDF_FIELD_ENC_INFO, 32));
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptWithKey(cipherPackage: string, key: Buffer): string {
  if (!cipherPackage) return '';
  const parts = cipherPackage.split(':');
  let ivHex: string, tagHex: string, encryptedText: string;
  if (parts[0] === 'v1') {
    if (parts.length !== 4) throw new Error('Invalid versioned format');
    [, ivHex, tagHex, encryptedText] = parts;
  } else if (parts.length === 3) {
    [ivHex, tagHex, encryptedText] = parts;
  } else {
    throw new Error('Invalid envelope structure');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function reencryptSensitiveFields(options: {
  oldSecret: string;
  newSecret: string;
  dryRun?: boolean;
}) {
  const { oldSecret, newSecret, dryRun = true } = options;
  if (!oldSecret || !newSecret) {
    throw new Error('Both oldSecret and newSecret are required for re-encryption.');
  }

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  console.log(`[REENCRYPT] Mode: ${dryRun ? 'DRY-RUN (no database writes)' : 'COMMIT'}`);

  // 1. Re-encrypt KycRecord.panNumberEncrypted
  const kycRecords = await prisma.kycRecord.findMany({
    where: { panNumberEncrypted: { not: null } },
    select: { id: true, panNumberEncrypted: true },
  });

  console.log(`[REENCRYPT] Found ${kycRecords.length} KycRecord entries to process...`);
  let kycSuccess = 0;
  for (const record of kycRecords) {
    if (!record.panNumberEncrypted) continue;
    try {
      const plaintext = decryptWithKey(record.panNumberEncrypted, oldKey);
      const reencrypted = encryptWithKey(plaintext, newKey);

      if (!dryRun) {
        await prisma.kycRecord.update({
          where: { id: record.id },
          data: { panNumberEncrypted: reencrypted },
        });
      }
      kycSuccess++;
    } catch (err: any) {
      console.error(`[REENCRYPT-ERROR] Failed to re-encrypt KycRecord ${record.id}:`, err.message);
    }
  }

  // 2. Re-encrypt PaymentAccount.accountNumberEncrypted and upiIdEncrypted
  const paymentAccounts = await prisma.paymentAccount.findMany({
    where: {
      OR: [
        { accountNumberEncrypted: { not: null } },
        { upiIdEncrypted: { not: null } },
      ],
    },
    select: { id: true, accountNumberEncrypted: true, upiIdEncrypted: true },
  });

  console.log(`[REENCRYPT] Found ${paymentAccounts.length} PaymentAccount entries to process...`);
  let paymentSuccess = 0;
  for (const account of paymentAccounts) {
    try {
      const updates: any = {};
      if (account.accountNumberEncrypted) {
        const plainAccount = decryptWithKey(account.accountNumberEncrypted, oldKey);
        updates.accountNumberEncrypted = encryptWithKey(plainAccount, newKey);
      }
      if (account.upiIdEncrypted) {
        const plainUpi = decryptWithKey(account.upiIdEncrypted, oldKey);
        updates.upiIdEncrypted = encryptWithKey(plainUpi, newKey);
      }

      if (!dryRun && Object.keys(updates).length > 0) {
        await prisma.paymentAccount.update({
          where: { id: account.id },
          data: updates,
        });
      }
      paymentSuccess++;
    } catch (err: any) {
      console.error(`[REENCRYPT-ERROR] Failed to re-encrypt PaymentAccount ${account.id}:`, err.message);
    }
  }

  console.log(`[REENCRYPT-COMPLETE] KycRecords: ${kycSuccess}/${kycRecords.length}, PaymentAccounts: ${paymentSuccess}/${paymentAccounts.length}`);
  return { kycSuccess, paymentSuccess, totalKyc: kycRecords.length, totalPayment: paymentAccounts.length };
}

if (require.main === module) {
  const isCommit = process.argv.includes('--commit');
  const oldSecret = process.env.OLD_FIELD_ENCRYPTION_KEY || process.env.FIELD_ENCRYPTION_KEY || '';
  const newSecret = process.env.NEW_FIELD_ENCRYPTION_KEY || '';

  reencryptSensitiveFields({ oldSecret, newSecret, dryRun: !isCommit })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL]', err.message);
      process.exit(1);
    });
}
