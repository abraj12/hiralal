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

    default:
      throw new Error(`Unsupported integrity action "${action}" for request hash calculation.`);
  }
}
