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
 * Computes canonical request hash for mobile password recovery actions.
 */
export async function createPasswordResetRequestHash(
  action: 'FORGOT_PASSWORD' | 'FORGOT_PASSWORD_REQUEST' | 'FORGOT_PASSWORD_VERIFY' | 'FORGOT_PASSWORD_COMPLETE',
  data: {
    mobile: string;
  }
): Promise<string> {
  const canonicalPayload = {
    version: 1,
    action,
    mobile: String(data.mobile || '').trim(),
  };
  return sha256Json(canonicalPayload);
}

