import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
// SEC-MED-06: Standardize on 12-byte (96-bit) IV per NIST SP 800-38D recommendations
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Domain-separation info strings for HKDF derivation (one per use-case)
const HKDF_FIELD_ENC_INFO = Buffer.from('hiralal-field-encryption-v1');

/**
 * Derives a consistent 32-byte AES-256 key using HKDF-SHA256 with
 * domain-separated info strings to prevent cross-purpose key reuse.
 * HKDF replaces the previous raw SHA-256 approach (audit finding F-14).
 */
function getDerivedKey(): Buffer {
  const keySource = config.fieldEncryptionKey || config.encryptionKey;
  const keyMaterial = Buffer.from(keySource, 'utf8');
  // Empty salt is acceptable in HKDF when the key material already has high entropy
  // Buffer.from() converts the ArrayBuffer returned by hkdfSync to a Node.js Buffer
  return Buffer.from(crypto.hkdfSync('sha256', keyMaterial, Buffer.alloc(0), HKDF_FIELD_ENC_INFO, 32));
}


/**
 * Encrypts sensitive text using AES-256-GCM.
 * Output format: iv:tag:ciphertext (hex encoded)
 */
export function encryptSensitive(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getDerivedKey(), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM ciphertext.
 */
export function decryptSensitive(cipherPackage: string): string {
  if (!cipherPackage) return '';
  const parts = cipherPackage.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format.');
  }

  const [ivHex, tagHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, getDerivedKey(), iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Calculates SHA-256 hash in hex format.
 */
export function sha256Hash(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generates a cryptographically secure random token (hex).
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
export function generateSecureOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes a keyed blind index (HMAC-SHA256) for high-entropy unique lookups
 * without exposing plaintext PII in database indexes.
 */
export function generateBlindIndex(plaintext: string): string {
  if (!plaintext) return '';
  const normalized = plaintext.trim().toUpperCase();
  const hmacKey = config.blindIndexSecret || config.fieldEncryptionKey || config.encryptionKey;
  return crypto.createHmac('sha256', hmacKey).update(normalized).digest('hex');
}

/**
 * Computes server-secret-keyed HMAC-SHA256 for 6-digit OTPs
 * to prevent precomputation / rainbow table attacks on low-entropy numbers.
 * Uses a dedicated OTP_HMAC_SECRET (audit finding F-05) — decoupled from
 * the JWT signing key so rotating either does not affect the other.
 */
export function hmacHashOtp(otpCode: string): string {
  const secret = config.otpHmacSecret;
  return crypto.createHmac('sha256', secret).update(otpCode).digest('hex');
}

