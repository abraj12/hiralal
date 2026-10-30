/**
 * HIR-M-06 / HIR-M-07 / HIR-M-08: Versioned legal documents and server-owned consent texts.
 *
 * The text below was drafted from the platform's actual data flows and business rules during the
 * October 2026 audit remediation. REVIEW_STATUS stays 'DRAFT_PENDING_LEGAL_REVIEW' until Indian
 * counsel approves the wording; then set it to 'APPROVED' and bump the version for any change.
 * Users accept a specific version; changing text without a new version breaks the consent record.
 */
import crypto from 'crypto';

export type LegalReviewStatus = 'DRAFT_PENDING_LEGAL_REVIEW' | 'APPROVED';
export const REVIEW_STATUS: LegalReviewStatus = 'DRAFT_PENDING_LEGAL_REVIEW' as LegalReviewStatus;

export type LegalDocumentType = 'terms' | 'privacy';
export type ConsentPurpose =
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_NOTICE'
  | 'AGE_CONFIRMATION'
  | 'PAN_VERIFICATION'
  | 'BENEFICIARY_VERIFICATION';

export const TERMS_VERSION = '2026-11-01';
export const PRIVACY_VERSION = '2026-11-01';
export const PAN_CONSENT_VERSION = '2026-10-30';
export const BENEFICIARY_CONSENT_VERSION = '2026-10-30';

/** Exactly what the mobile app shows next to the PAN consent checkbox. */
export const PAN_CONSENT_TEXT =
  'I hereby give consent to verify my PAN identity with the income tax database for reward disbursement compliance.';

/** Exactly what the mobile app shows before bank / UPI verification. */
export const BENEFICIARY_CONSENT_TEXT =
  'I consent to Hiralal and Sons Sales Pvt. Ltd. sharing my bank account or UPI details and name with RazorpayX to verify the account (this may involve a ₹1 test transfer) and to send my reward payouts to it.';

export const AGE_CONFIRMATION_TEXT = 'I confirm that I am 18 years of age or older.';

export interface LegalContact {
  companyName: string;
  registeredAddress: string;
  grievanceOfficerName: string;
  grievanceOfficerEmail: string;
  grievanceOfficerPhone?: string;
}

export function getLegalContact(env: Record<string, string | undefined> = process.env): LegalContact {
  const missing = '[to be published before launch]';
  return {
    companyName: 'Hiralal and Sons Sales Pvt. Ltd.',
    registeredAddress: env.LEGAL_COMPANY_ADDRESS?.trim() || missing,
    grievanceOfficerName: env.LEGAL_GRIEVANCE_OFFICER_NAME?.trim() || missing,
    grievanceOfficerEmail: env.LEGAL_GRIEVANCE_OFFICER_EMAIL?.trim() || missing,
    grievanceOfficerPhone: env.LEGAL_GRIEVANCE_OFFICER_PHONE?.trim() || undefined,
  };
}

function contactBlock(c: LegalContact): string {
  return [
    `${c.companyName}, ${c.registeredAddress}`,
    `Grievance Officer: ${c.grievanceOfficerName}`,
    `Email: ${c.grievanceOfficerEmail}`,
    ...(c.grievanceOfficerPhone ? [`Phone: ${c.grievanceOfficerPhone}`] : []),
  ].join('\n');
}

function buildTerms(c: LegalContact): string {
  return `HIRALAL AND SONS SALES PVT. LTD. — REWARDS PROGRAM TERMS AND CONDITIONS
Version ${TERMS_VERSION}

1. Who runs the program
The Hiralal & Sons Rewards program ("Program") is operated by ${c.companyName} ("we", "us"). The app and platform are built and operated for us by Algions AI Labs Private Limited.

2. Who can join
The Program is open to plumbers and tile installers in India who are 18 years of age or older and register with their own mobile number. One account per person. You must keep your profile name the same as the name on your PAN card.

3. Submitting invoices
You may upload invoices for genuine purchases of eligible materials made by you. For each invoice you enter the invoice number, invoice date and total amount, and attach a clear photo or PDF. Invoices older than five years or dated in the future are not accepted. The same invoice can earn a reward only once across the whole Program, whoever submits it. Uploading duplicate, altered or forged invoices is not allowed.

4. Review and approval
Every invoice is reviewed by our administrators before any reward is given. Our administrators verify whether the invoice represents an eligible purchase from Hiralal & Sons Sales Pvt. Ltd. and determine the applicable GST treatment. If an invoice is rejected you may resubmit a corrected version; a resubmission whose amount is more than 25% higher than before needs a second review by another administrator. We may reject or cancel any invoice that we believe is not genuine.

5. How rewards are calculated
Your reward is a percentage of the eligible invoice amount. Where the invoice includes GST, the GST is removed first and the reward is calculated on the remaining amount. The percentage depends on your profession and may change from time to time; the percentage in force on the date and time you submitted the invoice applies. Rewards are shown as Points in your wallet; one Point equals one Indian Rupee when paid out. Rewards are added to your wallet only when an invoice is approved.

6. Redeeming rewards
You can redeem only during redemption windows that we announce. To redeem you must verify your PAN and add a bank account or UPI ID whose verified account-holder name matches your PAN name. When you redeem, your full available balance is paid out, up to the maximum allowed per request (currently ₹50,000 or a lower limit we set) and the daily limit, and only if it meets the minimum we set. Each request is approved by our administrators before it is sent. Payouts are made through our payment partner RazorpayX by UPI or IMPS.

7. Failed, reversed or duplicate payouts
If a payout fails or is reversed by the bank, the amount is returned to your wallet. If money reaches you after a payout had already been marked failed and returned to your wallet, we will deduct that amount from your wallet; if your balance is not enough, the shortfall is recorded against your account and taken from future rewards, and your account may be suspended while we review it.

8. Taxes
Rewards may be subject to tax. We will deduct tax at source or report payments where the law requires, and you are responsible for any tax payable by you.

9. Suspension and termination
We may suspend or close an account that breaks these terms, submits fraudulent invoices or misuses the app. We may change or end the Program by giving notice in the app; rewards already credited to your wallet will remain redeemable in line with these terms.

10. Deleting your account
You can ask to delete your account from the Profile screen. Deletion happens after a 7-day waiting period, which you can cancel by signing in. You cannot delete your account while you have invoices under review, a payout in progress or a wallet balance. Records we must keep by law, such as approved invoices and payout records, are kept for the legally required period as described in the Privacy Policy.

11. Changes to these terms
We will show you any new version of these terms in the app. Continuing to use the Program after a change takes effect means you accept the new version.

12. Complaints and governing law
Contact our Grievance Officer with any complaint:
${contactBlock(c)}
These terms are governed by the laws of India.`;
}

function buildPrivacy(c: LegalContact): string {
  return `HIRALAL AND SONS SALES PVT. LTD. — PRIVACY POLICY
Version ${PRIVACY_VERSION}

1. Who we are
${c.companyName} ("we", "us") decides why and how your personal data is used in the Hiralal & Sons Rewards app. Algions AI Labs Private Limited builds and operates the platform for us.

2. What we collect and why
- Mobile number: to create your account, sign you in and send one-time passwords (OTPs).
- Name and profession: to identify you and apply the reward rules for your profession.
- Password: stored only as a one-way hash, to protect your account.
- Invoices (photo or PDF, invoice number, date, amount): to verify purchases and calculate rewards, and to keep tax and accounting records.
- PAN and the name registered with it: to verify your identity before payouts, with your consent.
- Bank account number, IFSC or UPI ID, and the account-holder name: to verify the account and send payouts, with your consent.
- Wallet, reward and payout history: to run the Program and keep financial records.
- Device information (app installation ID, push notification token, app version, Google Play device and app integrity results): to send notifications and to protect the Program against tampered apps and fraud.
- IP address and device type for sign-ins and security events: to protect your account and investigate misuse.

3. Who we share it with
We do not sell your personal data. We share it only with service providers who process it for us, and with authorities where the law requires:
- SignCare — receives your PAN to verify it with the income tax database.
- RazorpayX (Razorpay) — receives your name, mobile number and bank account or UPI details to verify the account and send payouts.
- Meta (WhatsApp Business) and/or MSG91 — receive your mobile number to deliver OTP messages.
- Cloudflare (R2 storage) — stores your invoice files and our encrypted backups.
- Google (Firebase Cloud Messaging and Play Integrity) — deliver notifications to your device and check that requests come from the genuine app on a genuine device.
- Government and tax authorities — when required by law.
Some of these providers may process data outside India.

4. How we protect it
Your PAN and bank account number are encrypted (AES-256-GCM). Passwords are hashed with bcrypt. Invoice files are stored privately and shown only to authorised administrators through short-lived links, and administrator access is logged.

5. How long we keep it
We keep your data while your account is active. When you delete your account, we erase or anonymise your personal data, except records we must keep by law — such as approved invoices, payout records and the encrypted PAN and bank details linked to them — which we keep for up to 8 years and then delete. Erased data may remain in encrypted backups until those backups expire.

6. Your choices and rights
You can see and update your profile in the app, ask us to correct your data, withdraw a consent you have given (we will then stop the related processing, which may mean you cannot redeem rewards), and delete your account from the Profile screen. For any request or complaint, contact our Grievance Officer:
${contactBlock(c)}

7. Children
The Program is only for people aged 18 or older. We do not knowingly collect data from children.

8. Changes to this policy
We will show you any new version of this policy in the app before it takes effect.`;
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  version: string;
  reviewStatus: LegalReviewStatus;
  content: string;
  contentSha256: string;
}

export function getLegalDocument(type: LegalDocumentType, env: Record<string, string | undefined> = process.env): LegalDocument {
  const contact = getLegalContact(env);
  const content = type === 'terms' ? buildTerms(contact) : buildPrivacy(contact);
  return {
    type,
    title: type === 'terms' ? 'Terms & Conditions' : 'Privacy Policy',
    version: type === 'terms' ? TERMS_VERSION : PRIVACY_VERSION,
    reviewStatus: REVIEW_STATUS,
    content,
    contentSha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Values a registering client must send to accept the current documents (also used by tests). */
export function currentLegalAcceptance() {
  return {
    acceptedTermsVersion: TERMS_VERSION,
    acceptedPrivacyVersion: PRIVACY_VERSION,
    ageConfirmed: true,
  };
}
