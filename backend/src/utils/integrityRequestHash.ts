import crypto from 'crypto';
import { Request } from 'express';
import { IntegrityAction } from '../services/integrity/playIntegrity.service';

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
  accountHolderName?: string;
}

export function buildCanonicalBeneficiaryPayload(
  accountType: 'UPI' | 'BANK',
  identifier: string,
  ifscCode?: string,
  accountHolderName?: string
): CanonicalBeneficiaryPayload {
  return {
    version: 1,
    action: 'BENEFICIARY_VERIFY',
    accountType,
    identifier: String(identifier || '').trim(),
    ...(ifscCode ? { ifscCode: String(ifscCode).trim().toUpperCase() } : {}),
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
};

export function normalizeRegistrationIntegrityPayload(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
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

  return {
    version: 2,
    action: 'REGISTRATION',
    mobile,
    profession: profession as 'PLUMBER' | 'TILE_INSTALLER',
    firstName,
    middleName,
    lastName,
    fullName,
  };
}

export function buildCanonicalRegistrationPayload(input: {
  mobile: string;
  profession: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
}): RegistrationIntegrityPayload {
  return normalizeRegistrationIntegrityPayload(input);
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
      let fileBuffer: Buffer | null = null;
      if (req.file && req.file.buffer) {
        fileBuffer = req.file.buffer;
      } else if (req.body?.fileBase64 && typeof req.body.fileBase64 === 'string') {
        fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('Invoice file content is required to compute integrity request hash.');
      }

      const fileSha256 = computeSha256Bytes(fileBuffer);
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
      const isUpi = Boolean(req.body?.upiId);
      const payload = isUpi
        ? buildCanonicalBeneficiaryPayload(
            'UPI',
            req.body?.upiId,
            undefined,
            req.body?.accountHolderName
          )
        : buildCanonicalBeneficiaryPayload(
            'BANK',
            req.body?.accountNumber,
            req.body?.ifscCode,
            req.body?.accountHolderName
          );
      return computeSha256Json(payload);
    }

    case 'ACCOUNT_DELETION': {
      const payload = buildCanonicalAccountDeletionPayload(req.body?.otpCode);
      return computeSha256Json(payload);
    }

    case 'ACCOUNT_DELETION_REQUEST': {
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
      const payload = {
        version: 1,
        action: 'FORGOT_PASSWORD',
        mobile: String(req.body?.mobile || '').trim(),
      };
      return computeSha256Json(payload);
    }

    case 'FORGOT_PASSWORD_REQUEST': {
      const salt = String(req.body?.integrityRequestSalt || req.headers['x-integrity-request-salt'] || '').trim().toLowerCase();
      const mobile = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
      if (salt) {
        return computeSha256Json({
          version: 2,
          action: 'FORGOT_PASSWORD_REQUEST',
          mobile,
          integrityRequestSalt: salt,
        });
      }
      return computeSha256Json({
        version: 1,
        action: 'FORGOT_PASSWORD_REQUEST',
        mobile: String(req.body?.mobile || '').trim(),
      });
    }

    case 'FORGOT_PASSWORD_VERIFY': {
      const salt = String(req.body?.integrityRequestSalt || req.headers['x-integrity-request-salt'] || '').trim().toLowerCase();
      const mobile = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
      if (salt) {
        return computeSha256Json({
          version: 2,
          action: 'FORGOT_PASSWORD_VERIFY',
          mobile,
          otpCode: String(req.body?.otpCode || '').trim(),
          integrityRequestSalt: salt,
        });
      }
      return computeSha256Json({
        version: 1,
        action: 'FORGOT_PASSWORD_VERIFY',
        mobile: String(req.body?.mobile || '').trim(),
      });
    }

    case 'FORGOT_PASSWORD_COMPLETE': {
      const salt = String(req.body?.integrityRequestSalt || req.headers['x-integrity-request-salt'] || '').trim().toLowerCase();
      const mobile = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
      if (salt) {
        return computeSha256Json({
          version: 2,
          action: 'FORGOT_PASSWORD_COMPLETE',
          mobile,
          verificationToken: String(req.body?.verificationToken || '').trim(),
          newPassword: String(req.body?.newPassword || '').trim(),
          integrityRequestSalt: salt,
        });
      }
      return computeSha256Json({
        version: 1,
        action: 'FORGOT_PASSWORD_COMPLETE',
        mobile: String(req.body?.mobile || '').trim(),
      });
    }

    case 'GENERAL': {
      return computeSha256Json({ version: 1, action: 'GENERAL' });
    }

    default:
      throw new Error(`Unsupported integrity action "${action}" for request hash calculation.`);
  }
}

