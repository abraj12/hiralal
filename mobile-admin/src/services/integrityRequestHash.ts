import * as Crypto from 'expo-crypto';

export function normalizeAmountTwoDecimals(amount: number | string): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).trim());
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('Invalid amount for integrity request hash calculation.');
  }
  return num.toFixed(2);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as any);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Json(value: unknown): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(value),
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

export async function readFileBytes(fileOrUri: any): Promise<Uint8Array> {
  if (fileOrUri instanceof Uint8Array) {
    return fileOrUri;
  }
  if (typeof Blob !== 'undefined' && fileOrUri instanceof Blob) {
    const arrayBuffer = await fileOrUri.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  if (fileOrUri && typeof fileOrUri.file !== 'undefined' && typeof Blob !== 'undefined' && fileOrUri.file instanceof Blob) {
    const arrayBuffer = await fileOrUri.file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  const uri = typeof fileOrUri === 'string' ? fileOrUri : fileOrUri?.uri;
  if (typeof uri === 'string') {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Failed to read file from URI: ${uri}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  throw new Error('Unsupported file input for reading invoice bytes.');
}

/**
 * Computes canonical request hash for bill invoice upload.
 */
export async function createBillUploadRequestHash(
  data: {
    invoiceNumber: string;
    invoiceDate: string;
    billAmount: number | string;
    remarks?: string;
  },
  fileOrUri: any
): Promise<string> {
  const bytes = await readFileBytes(fileOrUri);
  if (!bytes || bytes.length === 0) {
    throw new Error('Invoice file content is required to calculate request hash.');
  }
  const fileSha256 = await sha256Bytes(bytes);

  const canonicalPayload = {
    version: 1,
    action: 'BILL_UPLOAD',
    invoiceNumber: String(data.invoiceNumber || '').trim(),
    invoiceDate: String(data.invoiceDate || '').trim(),
    billAmount: normalizeAmountTwoDecimals(data.billAmount),
    remarks: String(data.remarks || '').trim(),
    fileSha256,
  };

  return sha256Json(canonicalPayload);
}

/**
 * Computes canonical request hash for KYC PAN verification.
 */
export async function createPanVerificationRequestHash(data: {
  panNumber: string;
  panName: string;
  consent: boolean;
  consentText: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'KYC_SUBMIT',
    panNumber: String(data.panNumber || '').trim().toUpperCase(),
    panName: String(data.panName || '').trim(),
    consent: Boolean(data.consent),
    consentText: String(data.consentText || '').trim(),
  };

  return sha256Json(canonicalPayload);
}

/**
 * Computes canonical request hash for payout redemption.
 */
export async function createPayoutRedemptionRequestHash(data: {
  idempotencyKey: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'PAYOUT_REDEEM',
    idempotencyKey: String(data.idempotencyKey || '').trim(),
  };

  return sha256Json(canonicalPayload);
}

/**
 * Computes canonical request hash for account deletion request.
 */
export async function createAccountDeletionRequestHash(data?: {
  password?: string;
  otpCode?: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'ACCOUNT_DELETION_REQUEST',
    ...(data?.password ? { password: String(data.password).trim() } : {}),
  };

  return sha256Json(canonicalPayload);
}

/**
 * Computes canonical request hash for account deletion confirmation.
 */
export async function createAccountDeletionConfirmRequestHash(data: {
  otpCode: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'ACCOUNT_DELETION_CONFIRM',
    otpCode: String(data.otpCode).trim(),
  };

  return sha256Json(canonicalPayload);
}

/**
 * Computes canonical request hash for beneficiary account verification (UPI or Bank).
 */
export async function createBeneficiaryVerificationRequestHash(data: {
  accountType: 'UPI' | 'BANK';
  identifier: string;
  ifscCode?: string;
  accountHolderName?: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'BENEFICIARY_VERIFY',
    accountType: data.accountType,
    identifier: String(data.identifier || '').trim(),
    ...(data.ifscCode ? { ifscCode: String(data.ifscCode).trim().toUpperCase() } : {}),
    ...(data.accountHolderName ? { accountHolderName: String(data.accountHolderName).trim() } : {}),
  };

  return sha256Json(canonicalPayload);
}

export function normalizeRegistrationIntegrityPayload(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  passwordSha256?: string;
  verificationToken?: string;
}) {
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

  return {
    version: 2 as const,
    action: 'REGISTRATION' as const,
    mobile,
    profession: profession as 'PLUMBER' | 'TILE_INSTALLER',
    firstName,
    middleName,
    lastName,
    fullName,
    ...(input.passwordSha256 ? { passwordSha256: input.passwordSha256 } : {}),
    ...(input.verificationToken ? { verificationToken: String(input.verificationToken).trim() } : {}),
  };
}

/**
 * Computes canonical request hash for user registration.
 */
export async function createRegistrationRequestHash(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  password?: string;
  passwordSha256?: string;
  verificationToken?: string;
}): Promise<string> {
  const payload = normalizeRegistrationIntegrityPayload(input);
  return sha256Json(payload);
}

/**
 * Computes canonical request hash for mobile login authentication.
 */
export async function createAuthRequestHash(data: {
  identifier?: string;
  mobile?: string;
}): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action: 'AUTH',
    mobile: String(data.identifier || data.mobile || '').trim(),
  };
  return sha256Json(canonicalPayload);
}

/**
 * Generates a cryptographically secure 16-byte (32-hex character) request salt.
 */
export async function generateSecureRequestSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

export type PasswordRecoveryIntegrityAction =
  | 'FORGOT_PASSWORD_REQUEST'
  | 'FORGOT_PASSWORD_VERIFY'
  | 'FORGOT_PASSWORD_COMPLETE';

/**
 * Computes canonical Version 2 request commitment hash for password recovery actions bound to integrityRequestSalt.
 */
export async function createPasswordResetCommitment(
  action: PasswordRecoveryIntegrityAction,
  data: {
    mobile: string;
    otpCode?: string;
    verificationToken?: string;
    newPassword?: string;
    integrityRequestSalt: string;
  }
): Promise<string> {
  const salt = validateRecoverySalt(data.integrityRequestSalt);
  const rawMobile = data.mobile;
  if (typeof rawMobile !== 'string' && typeof rawMobile !== 'number') {
    throw new Error('INVALID_RECOVERY_MOBILE');
  }
  const mobile = String(rawMobile).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(mobile)) {
    throw new Error('INVALID_RECOVERY_MOBILE');
  }

  if (action === 'FORGOT_PASSWORD_REQUEST') {
    const canonicalPayload = {
      version: 2 as const,
      action: 'FORGOT_PASSWORD_REQUEST' as const,
      mobile,
      integrityRequestSalt: salt,
    };
    return sha256Json(canonicalPayload);
  }

  if (action === 'FORGOT_PASSWORD_VERIFY') {
    const rawOtp = data.otpCode;
    if (typeof rawOtp !== 'string' && typeof rawOtp !== 'number') {
      throw new Error('INVALID_RECOVERY_OTP');
    }
    const otpCode = String(rawOtp).trim();
    if (!/^\d{6}$/.test(otpCode)) {
      throw new Error('INVALID_RECOVERY_OTP');
    }
    const canonicalPayload = {
      version: 2 as const,
      action: 'FORGOT_PASSWORD_VERIFY' as const,
      mobile,
      otpCode,
      integrityRequestSalt: salt,
    };
    return sha256Json(canonicalPayload);
  }

  if (action === 'FORGOT_PASSWORD_COMPLETE') {
    const rawToken = data.verificationToken;
    if (typeof rawToken !== 'string') {
      throw new Error('INVALID_RECOVERY_TOKEN');
    }
    const verificationToken = String(rawToken ?? '');
    if (!/^[0-9a-f]{64}$/i.test(verificationToken.trim())) {
      throw new Error('INVALID_RECOVERY_TOKEN');
    }

    const rawPassword = data.newPassword;
    if (typeof rawPassword !== 'string') {
      throw new Error('INVALID_RECOVERY_PASSWORD');
    }
    // CRITICAL: Never trim or modify password for integrity hashing
    const newPassword = String(rawPassword ?? '');
    const canonicalPayload = {
      version: 2 as const,
      action: 'FORGOT_PASSWORD_COMPLETE' as const,
      mobile,
      verificationToken,
      newPassword,
      integrityRequestSalt: salt,
    };
    return sha256Json(canonicalPayload);
  }

  throw new Error(`Unsupported recovery integrity action "${action}".`);
}

/**
 * Computes canonical request hash for mobile password recovery actions.
 * Enforces Version 2 commitment bound to integrityRequestSalt (V1 deprecated).
 */
export async function createPasswordResetRequestHash(
  action: PasswordRecoveryIntegrityAction,
  data: {
    mobile: string;
    otpCode?: string;
    verificationToken?: string;
    newPassword?: string;
    integrityRequestSalt: string;
  }
): Promise<string> {
  return createPasswordResetCommitment(action, data);
}


