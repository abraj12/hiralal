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
function deriveKeyFromSecret(secret: string): Buffer {
  const keyMaterial = Buffer.from(secret, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', keyMaterial, Buffer.alloc(0), HKDF_FIELD_ENC_INFO, 32));
}

function getDerivedKey(): Buffer {
  const keySource = config.fieldEncryptionKey || config.encryptionKey;
  return deriveKeyFromSecret(keySource);
}


/**
 * Encrypts sensitive text using AES-256-GCM with version-prefixed envelope formatting.
 * Output format: v1:iv:tag:ciphertext (hex encoded)
 */
export function encryptSensitive(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getDerivedKey(), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM ciphertext supporting both v1 versioned envelope and legacy unversioned formats.
 * Supports cryptographic key rotation with automatic fallback to previousFieldEncryptionKeys.
 */
export function decryptSensitive(cipherPackage: string): string {
  if (!cipherPackage) return '';
  const parts = cipherPackage.split(':');
  
  let ivHex: string, tagHex: string, encryptedText: string;
  if (parts[0] === 'v1') {
    if (parts.length !== 4) {
      throw new Error('Invalid versioned encrypted data format.');
    }
    [, ivHex, tagHex, encryptedText] = parts;
  } else if (parts.length === 3) {
    // Backwards compatibility with unversioned legacy records
    [ivHex, tagHex, encryptedText] = parts;
  } else {
    throw new Error('Invalid encrypted data format.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  // Candidate keys: current primary key first, followed by previous keys for rotation
  const candidateKeySources = [
    config.fieldEncryptionKey || config.encryptionKey,
    ...(config.previousFieldEncryptionKeys || []),
  ].filter(Boolean);

  let lastError: Error | null = null;
  for (const keySource of candidateKeySources) {
    try {
      const derivedKey = deriveKeyFromSecret(keySource);
      const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('Decryption failed with all candidate keys.');
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
 * Returns null on falsy or blank input to prevent duplicate empty string collisions on unique indexes.
 */
export function generateBlindIndex(plaintext: string): string;
export function generateBlindIndex(plaintext: null | undefined): null;
export function generateBlindIndex(plaintext?: string | null): string | null;
export function generateBlindIndex(plaintext?: string | null): string | null {
  if (!plaintext || !plaintext.trim()) return null;
  let normalized = plaintext.trim().toUpperCase();
  // VULN-MED-20: Domain separation for PAN blind index to prevent collision with banking keys
  if (!normalized.includes(':') && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) {
    normalized = `PAN:${normalized}`;
  }
  const hmacKey = config.blindIndexSecret;
  if (!hmacKey) {
    throw new Error('BLIND_INDEX_SECRET is required to compute blind indexes.');
  }
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

