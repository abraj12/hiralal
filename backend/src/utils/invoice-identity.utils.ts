import { formatIstDate } from './timezone.utils';

/**
 * Single-seller invoice identity: Hiralal & Sons + YYYY-MM + normalised invoice number.
 *
 * Hiralal & Sons is the only seller and its invoice serials restart every month, so the same number
 * in a different month is a different invoice. The amount is never part of the identity.
 *
 * Must stay in sync with set_bill_invoice_identity() in
 * prisma/migrations/20261030150000_single_seller_invoice_identity/migration.sql, which is the
 * authoritative source of Bill.invoicePeriod / Bill.invoiceKey.
 */
export const INVOICE_SELLER_IDENTITY = 'HIRALAL_AND_SONS';

export function normalizeInvoiceKey(invoiceNumber: string): string {
  const stripped = invoiceNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return stripped.replace(/([A-Z]+)0+([1-9][0-9]*)/g, '$1$2');
}

/** invoiceDate must be the stored business date (midnight Asia/Kolkata). */
export function getInvoicePeriod(invoiceDate: Date): string {
  return formatIstDate(invoiceDate, 'yyyy-MM');
}

export function getInvoiceIdentity(invoiceNumber: string, invoiceDate: Date) {
  const invoiceKey = normalizeInvoiceKey(invoiceNumber);
  if (!invoiceKey) {
    throw new Error('Invoice number must contain at least one letter or digit.');
  }
  const invoicePeriod = getInvoicePeriod(invoiceDate);
  return {
    invoicePeriod,
    invoiceKey,
    lockKey: `lock:invoice:${INVOICE_SELLER_IDENTITY}:${invoicePeriod}:${invoiceKey}`,
  };
}

/** True when a Prisma error is a unique-constraint violation (P2002) or custom trigger rejection on Bill. */
export function isUniqueViolation(err: any): boolean {
  return (
    err?.code === 'P2002' ||
    err?.meta?.code === '23505' ||
    /23505|unique constraint|reserved by another customer|permanently disqualified/i.test(
      String(err?.message || '')
    )
  );
}
