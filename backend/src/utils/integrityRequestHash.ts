import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import { IntegrityAction } from '../services/integrity/playIntegrity.service';

/**
 * Safely computes the SHA-256 hash of a file on disk using 64KB streaming chunks
 * to avoid memory amplification while enforcing file type and size bounds.
 */
export function computeSha256FromFile(filePath: string, maxBytes: number): string {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (err: any) {
    throw new Error(`Failed to access uploaded file: ${err?.message || 'Access error'}`);
  }

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error('Uploaded entity is not a regular file.');
    }
    if (stat.size <= 0) {
      throw new Error('Invoice file content is required to compute integrity request hash.');
    }
    if (stat.size > maxBytes) {
      throw new Error(`Uploaded file exceeds maximum permitted size of ${maxBytes} bytes.`);
    }

    const hash = crypto.createHash('sha256');
    const chunkSize = 64 * 1024; // 64KB chunk buffer to prevent memory amplification
    const buffer = Buffer.alloc(chunkSize);
    let totalRead = 0;
    let bytesRead = 0;

    while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      totalRead += bytesRead;
      if (totalRead > maxBytes) {
        throw new Error(`Uploaded file exceeds maximum permitted size of ${maxBytes} bytes.`);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }

    if (totalRead === 0) {
      throw new Error('Invoice file content is required to compute integrity request hash.');
    }

    return hash.digest('hex').toLowerCase();
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_) {}
  }
}

/**
 * Validates that an upload path returned by Multer is safely located inside
 * the designated application uploads directory.
 */
export function validateUploadPath(filePath: string, destination?: string): string {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Invalid upload file path.');
  }

  const normalized = path.resolve(filePath);
  const uploadsBase = path.resolve(process.cwd(), 'uploads');
  const allowedBase = destination ? path.resolve(destination) : uploadsBase;

  // The file must be strictly within the designated uploads base or allowed destination
  const isWithinUploads = normalized.startsWith(uploadsBase + path.sep);
  const isWithinDestination = destination ? (normalized.startsWith(allowedBase + path.sep) || normalized === allowedBase) : false;

  if (!isWithinUploads && !isWithinDestination) {
    throw new Error('Uploaded file is outside the permitted storage directory.');
  }

  return normalized;
}

export function normalizeAmountTwoDecimals(amount: number | string): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).trim());
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('Invalid amount for integrity request hash calculation.');
  }
  return num.toFixed(2);
}

export function computeSha256Bytes(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
}

export function computeSha256Json(payload: Record<string, any>): string {
  const jsonStr = JSON.stringify(payload);
  return crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex').toLowerCase();
}

export interface CanonicalBillUploadPayload {
  version: 1;
  action: 'BILL_UPLOAD';
  invoiceNumber: string;
  invoiceDate: string;
  billAmount: string;
  remarks: string;
  fileSha256: string;
}

export interface CanonicalKycSubmitPayload {
  version: 1;
  action: 'KYC_SUBMIT';
  panNumber: string;
  panName: string;
  consent: boolean;
  consentText: string;
}

export interface CanonicalPayoutRedeemPayload {
  version: 1;
  action: 'PAYOUT_REDEEM';
  idempotencyKey: string;
}

export function buildCanonicalBillUploadPayload(
  invoiceNumber: string,
  invoiceDate: string,
  billAmount: number | string,
  remarks: string | undefined,
  fileSha256: string
): CanonicalBillUploadPayload {
  return {
    version: 1,
    action: 'BILL_UPLOAD',
    invoiceNumber: String(invoiceNumber || '').trim(),
    invoiceDate: String(invoiceDate || '').trim(),
    billAmount: normalizeAmountTwoDecimals(billAmount),
    remarks: String(remarks || '').trim(),
    fileSha256: String(fileSha256 || '').trim().toLowerCase(),
  };
}

export function buildCanonicalKycSubmitPayload(
  panNumber: string,
  panName: string,
  consent: boolean,
  consentText: string
): CanonicalKycSubmitPayload {
  return {
    version: 1,
    action: 'KYC_SUBMIT',
    panNumber: String(panNumber || '').trim().toUpperCase(),
    panName: String(panName || '').trim(),
    consent: Boolean(consent),
    consentText: String(consentText || '').trim(),
  };
}

export function buildCanonicalPayoutRedeemPayload(
  idempotencyKey: string
): CanonicalPayoutRedeemPayload {
  return {
    version: 1,
    action: 'PAYOUT_REDEEM',
    idempotencyKey: String(idempotencyKey || '').trim(),
  };
}

export interface CanonicalAccountDeletionPayload {
  version: 1;
  action: 'ACCOUNT_DELETION';
  otpCode?: string;
}

export function buildCanonicalAccountDeletionPayload(
  otpCode?: string
): CanonicalAccountDeletionPayload {
  return {
    version: 1,
    action: 'ACCOUNT_DELETION',
    ...(otpCode ? { otpCode: String(otpCode).trim() } : {}),
  };
}

export interface CanonicalBeneficiaryPayload {
  version: 1;
  action: 'BENEFICIARY_VERIFY';
  accountType: 'UPI' | 'BANK';
  identifier: string;
  ifscCode?: string;
  bankName?: string;
  accountHolderName?: string;
}

export function buildCanonicalBeneficiaryPayload(
  accountType: 'UPI' | 'BANK',
  identifier: string,
  ifscCode?: string,
  accountHolderName?: string,
  bankName?: string
): CanonicalBeneficiaryPayload {
  return {
    version: 1,
    action: 'BENEFICIARY_VERIFY',
    accountType,
    identifier: String(identifier || '').trim(),
    ...(ifscCode ? { ifscCode: String(ifscCode).trim().toUpperCase() } : {}),
    ...(bankName ? { bankName: String(bankName).trim() } : {}),
    ...(accountHolderName ? { accountHolderName: String(accountHolderName).trim() } : {}),
  };
}

export interface CanonicalAuthPayload {
  version: 1;
  action: 'AUTH';
  mobile: string;
}

export function buildCanonicalAuthPayload(mobileOrIdentifier: string): CanonicalAuthPayload {
  return {
    version: 1,
    action: 'AUTH',
    mobile: String(mobileOrIdentifier || '').trim(),
  };
}

export type RegistrationIntegrityPayload = {
  version: 2;
  action: 'REGISTRATION';
  mobile: string;
  profession: 'PLUMBER' | 'TILE_INSTALLER';
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  passwordSha256?: string;
  verificationToken?: string;
};

export function normalizeRegistrationIntegrityPayload(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  password?: string;
  verificationToken?: string;
}): RegistrationIntegrityPayload {
  const mobile = String(input.mobile || '').replace(/\D/g, '').slice(-10);
  const profession = String(input.profession || '').trim().toUpperCase();

  if (!/^\d{10}$/.test(mobile)) {
    throw new Error('A valid mobile number is required.');
  }

  if (profession !== 'PLUMBER' && profession !== 'TILE_INSTALLER') {
    throw new Error('Invalid registration profession.');
  }

  const firstName = (input.firstName ?? '').trim().replace(/\s+/g, ' ');
  const middleName = (input.middleName ?? '').trim().replace(/\s+/g, ' ');
  const lastName = (input.lastName ?? '').trim().replace(/\s+/g, ' ');
  const fullName = (input.fullName && input.fullName.trim()
    ? input.fullName.trim()
    : [firstName, middleName, lastName].filter(Boolean).join(' ')
  ).replace(/\s+/g, ' ');

  const passwordSha256 = input.password
    ? crypto.createHash('sha256').update(String(input.password)).digest('hex').toLowerCase()
    : undefined;
  const verificationToken = input.verificationToken ? String(input.verificationToken).trim() : undefined;

  return {
    version: 2,
    action: 'REGISTRATION',
    mobile,
    profession: profession as 'PLUMBER' | 'TILE_INSTALLER',
    firstName,
    middleName,
    lastName,
    fullName,
    ...(passwordSha256 ? { passwordSha256 } : {}),
    ...(verificationToken ? { verificationToken } : {}),
  };
}

export function buildCanonicalRegistrationPayload(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  password?: string;
  verificationToken?: string;
}): RegistrationIntegrityPayload {
  return normalizeRegistrationIntegrityPayload(input);
}

export const RECOVERY_SALT_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Validates that a value is a valid 32-character lowercase hexadecimal recovery salt.
 */
export function validateRecoverySalt(value: unknown): string {
  if (typeof value !== 'string' || !RECOVERY_SALT_PATTERN.test(value)) {
    throw new Error('INVALID_RECOVERY_INTEGRITY_SALT');
  }
  return value;
}

/**
 * Extracts and validates the required 32-character hexadecimal recovery salt from an Express Request.
 * Enforces body and header equality when both are supplied; rejects missing, malformed, or conflicting salts.
 */
export function getRequiredRecoverySalt(req: Request): string {
  const bodySalt: unknown = req.body?.integrityRequestSalt;
  const headerSalt = typeof req.get === 'function'
    ? req.get('x-integrity-request-salt')
    : (req.headers ? (req.headers['x-integrity-request-salt'] as string) : undefined);

  if (bodySalt !== undefined && typeof bodySalt !== 'string') {
    throw new Error('INVALID_RECOVERY_INTEGRITY_SALT');
  }

  if (bodySalt !== undefined && headerSalt !== undefined && bodySalt !== headerSalt) {
    throw new Error('RECOVERY_INTEGRITY_SALT_MISMATCH');
  }

  const salt = bodySalt !== undefined ? bodySalt : headerSalt;

  if (typeof salt !== 'string' || !RECOVERY_SALT_PATTERN.test(salt)) {
    throw new Error('INVALID_RECOVERY_INTEGRITY_SALT');
  }

  return salt;
}

/**
 * Computes canonical SHA-256 request hash from the actual received Express request.
 */
export function computeIntegrityRequestHash(
  action: IntegrityAction,
  req: Request
): string {
  switch (action) {
    case 'BILL_UPLOAD': {
      const rawMaxUploadMb = parseInt(process.env.BILL_MAX_UPLOAD_SIZE_MB || '10', 10);
      const maxUploadMb = Number.isFinite(rawMaxUploadMb) && rawMaxUploadMb > 0 ? rawMaxUploadMb : 10;
      const maxUploadBytes = maxUploadMb * 1024 * 1024;

      let fileSha256: string | null = null;

      if (req.file) {
        const file = req.file as any;
        if (file.path && typeof file.path === 'string') {
          const safePath = validateUploadPath(file.path, file.destination);
          fileSha256 = computeSha256FromFile(safePath, maxUploadBytes);
        } else if (file.buffer && Buffer.isBuffer(file.buffer)) {
          if (file.buffer.length === 0) {
            throw new Error('Invoice file content is required to compute integrity request hash.');
          }
          if (file.buffer.length > maxUploadBytes) {
            throw new Error(`Uploaded file exceeds maximum permitted size of ${maxUploadBytes} bytes.`);
          }
          fileSha256 = computeSha256Bytes(file.buffer);
        }
      } else if (req.body?.fileBase64 && typeof req.body.fileBase64 === 'string') {
        const fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
        if (fileBuffer.length === 0) {
          throw new Error('Invoice file content is required to compute integrity request hash.');
        }
        if (fileBuffer.length > maxUploadBytes) {
          throw new Error(`Uploaded file exceeds maximum permitted size of ${maxUploadBytes} bytes.`);
        }
        fileSha256 = computeSha256Bytes(fileBuffer);
      }

      if (!fileSha256) {
        throw new Error('Invoice file content is required to compute integrity request hash.');
      }

      const payload = buildCanonicalBillUploadPayload(
        req.body?.invoiceNumber,
        req.body?.invoiceDate,
        req.body?.billAmount,
        req.body?.remarks,
        fileSha256
      );

      return computeSha256Json(payload);
    }

    case 'KYC_SUBMIT': {
      const payload = buildCanonicalKycSubmitPayload(
        req.body?.panNumber,
        req.body?.panName,
        req.body?.consent,
        req.body?.consentText
      );

      return computeSha256Json(payload);
    }

    case 'PAYOUT_REDEEM': {
      const payload = buildCanonicalPayoutRedeemPayload(
        req.body?.idempotencyKey
      );

      return computeSha256Json(payload);
    }

    case 'BENEFICIARY_VERIFY': {
      const url = req.originalUrl || req.baseUrl || req.path || '';
      const isBank = url.includes('/bank') || (!url.includes('/upi') && Boolean(req.body?.accountNumber));
      const payload = isBank
        ? buildCanonicalBeneficiaryPayload(
            'BANK',
            req.body?.accountNumber,
            req.body?.ifscCode,
            req.body?.accountHolderName,
            req.body?.bankName
          )
        : buildCanonicalBeneficiaryPayload(
            'UPI',
            req.body?.upiId,
            undefined,
            req.body?.accountHolderName
          );
      return computeSha256Json(payload);
    }

    case 'ACCOUNT_DELETION': {
      const payload = buildCanonicalAccountDeletionPayload(req.body?.otpCode);
      return computeSha256Json(payload);
    }

    case 'ACCOUNT_DELETION_REQUEST': {
      const salt = req.headers['x-integrity-request-salt'] || req.body?.integrityRequestSalt;
      if (salt && typeof salt === 'string') {
        const payload = {
          version: 2,
          action: 'ACCOUNT_DELETION_REQUEST',
          integrityRequestSalt: salt.trim(),
        };
        return computeSha256Json(payload);
      }
      const payload = {
        version: 1,
        action: 'ACCOUNT_DELETION_REQUEST',
        password: String(req.body?.password || '').trim(),
      };
      return computeSha256Json(payload);
    }

    case 'ACCOUNT_DELETION_CONFIRM': {
      const payload = {
        version: 1,
        action: 'ACCOUNT_DELETION_CONFIRM',
        otpCode: String(req.body?.otpCode || '').trim(),
      };
      return computeSha256Json(payload);
    }

    case 'REGISTRATION': {
      const payload = buildCanonicalRegistrationPayload({
        mobile: req.body?.mobile,
        profession: req.body?.profession,
        firstName: req.body?.firstName,
        middleName: req.body?.middleName,
        lastName: req.body?.lastName,
        fullName: req.body?.fullName,
        password: req.body?.password,
        verificationToken: req.body?.verificationToken,
      });
      return computeSha256Json(payload);
    }

    case 'AUTH': {
      const payload = buildCanonicalAuthPayload(
        req.body?.identifier || req.body?.mobile || ''
      );
      return computeSha256Json(payload);
    }

    case 'FORGOT_PASSWORD': {
      throw new Error('Legacy FORGOT_PASSWORD action is deprecated. Use V2 recovery actions.');
    }

    case 'FORGOT_PASSWORD_REQUEST': {
      const salt = getRequiredRecoverySalt(req);
      const rawMobile = req.body?.mobile;
      if (typeof rawMobile !== 'string' && typeof rawMobile !== 'number') {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      const mobile = String(rawMobile).replace(/\D/g, '').slice(-10);
      if (!/^\d{10}$/.test(mobile)) {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      return computeSha256Json({
        version: 2,
        action: 'FORGOT_PASSWORD_REQUEST',
        mobile,
        integrityRequestSalt: salt,
      });
    }

    case 'FORGOT_PASSWORD_VERIFY': {
      const salt = getRequiredRecoverySalt(req);
      const rawMobile = req.body?.mobile;
      if (typeof rawMobile !== 'string' && typeof rawMobile !== 'number') {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      const mobile = String(rawMobile).replace(/\D/g, '').slice(-10);
      if (!/^\d{10}$/.test(mobile)) {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      const rawOtp = req.body?.otpCode;
      if (typeof rawOtp !== 'string' && typeof rawOtp !== 'number') {
        throw new Error('INVALID_RECOVERY_OTP');
      }
      const otpCode = String(rawOtp).trim();
      if (!/^\d{6}$/.test(otpCode)) {
        throw new Error('INVALID_RECOVERY_OTP');
      }
      return computeSha256Json({
        version: 2,
        action: 'FORGOT_PASSWORD_VERIFY',
        mobile,
        otpCode,
        integrityRequestSalt: salt,
      });
    }

    case 'FORGOT_PASSWORD_COMPLETE': {
      const salt = getRequiredRecoverySalt(req);
      const rawMobile = req.body?.mobile;
      if (typeof rawMobile !== 'string' && typeof rawMobile !== 'number') {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      const mobile = String(rawMobile).replace(/\D/g, '').slice(-10);
      if (!/^\d{10}$/.test(mobile)) {
        throw new Error('INVALID_RECOVERY_MOBILE');
      }
      const rawToken = req.body?.verificationToken;
      if (typeof rawToken !== 'string') {
        throw new Error('INVALID_RECOVERY_TOKEN');
      }
      const verificationToken = String(rawToken ?? '');
      if (!/^[0-9a-f]{64}$/i.test(verificationToken.trim())) {
        throw new Error('INVALID_RECOVERY_TOKEN');
      }
      const rawPassword = req.body?.newPassword;
      if (typeof rawPassword !== 'string') {
        throw new Error('INVALID_RECOVERY_PASSWORD');
      }
      // CRITICAL: Never trim or modify password for integrity hashing
      const newPassword = String(rawPassword ?? '');
      return computeSha256Json({
        version: 2,
        action: 'FORGOT_PASSWORD_COMPLETE',
        mobile,
        verificationToken,
        newPassword,
        integrityRequestSalt: salt,
      });
    }

    case 'GENERAL': {
      return computeSha256Json({ version: 1, action: 'GENERAL' });
    }

    default:
      throw new Error(`Unsupported integrity action "${action}" for request hash calculation.`);
  }
}

