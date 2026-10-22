import { z } from 'zod';

export const ProfessionEnum = z.enum(['PLUMBER', 'TILE_INSTALLER']);
export type ProfessionType = z.infer<typeof ProfessionEnum>;

export const BillStatusEnum = z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']);
export type BillStatusType = z.infer<typeof BillStatusEnum>;

export const PayoutStatusEnum = z.enum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED']);
export type PayoutStatusType = z.infer<typeof PayoutStatusEnum>;

export const PaymentTypeEnum = z.enum(['UPI', 'BANK_ACCOUNT', 'BANK']);
export type PaymentTypeChoice = z.infer<typeof PaymentTypeEnum>;

export const IndianMobileSchema = z.string().trim().regex(/^(?:\+91|91)?[6-9]\d{9}$/, {
  message: 'Valid 10-digit Indian mobile number required',
});

export const PanSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
  message: 'Valid 10-character Indian Permanent Account Number (PAN) required',
});

export const UpiIdSchema = z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, {
  message: 'Valid Virtual Payment Address (UPI ID) required',
});

export const IfscSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
  message: 'Valid 11-character Indian Financial System Code (IFSC) required',
});

export const BillUploadInputSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid invoice date (YYYY-MM-DD) required'),
  billAmount: z.union([z.number().positive(), z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/)]),
  remarks: z.string().max(500).optional(),
});

export const PayoutRedemptionInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const DeviceTokenInputSchema = z.object({
  token: z.string().trim().min(1).max(1024),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
});
