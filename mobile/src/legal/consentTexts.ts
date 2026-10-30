/**
 * HIR-M-08: Consent wording shown in the app. Must stay identical to the server's
 * backend/src/legal/documents.ts (PAN_CONSENT_TEXT, BENEFICIARY_CONSENT_TEXT, AGE_CONFIRMATION_TEXT);
 * the server records its own copy as the evidence of consent.
 */
export const PAN_CONSENT_TEXT =
  'I hereby give consent to verify my PAN identity with the income tax database for reward disbursement compliance.';

export const BENEFICIARY_CONSENT_TEXT =
  'I consent to Hiralal and Sons Sales Pvt. Ltd. sharing my bank account or UPI details and name with RazorpayX to verify the account (this may involve a ₹1 test transfer) and to send my reward payouts to it.';

export const AGE_CONFIRMATION_TEXT = 'I confirm that I am 18 years of age or older.';
