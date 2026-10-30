# Data Retention and Erasure

Describes what the platform keeps, for how long, and what happens on account deletion, as implemented in
`backend/src/services/account-deletion.service.ts`. Retention periods marked ⚖️ must be confirmed by legal / tax
counsel before release.

## Account deletion lifecycle

1. User requests deletion (password) → confirms with OTP → 7-day grace period (signing in cancels it).
2. Blocked while bills are pending, a payout is in flight, a wallet balance or deficit remains, or a legal hold is set.
3. The deletion worker (Redis lock + database lease) then:
   - deletes invoice files from storage, except approved invoices when `RETAIN_APPROVED_BILLS_FOR_AUDIT` is on (default in production);
   - deletes notifications, push device tokens, sessions, OTP requests, verification tokens and **app installation records**;
   - clears file references on unapproved bills;
   - anonymises the user (name, mobile, password), KYC names and payment account names;
   - **redacts identity and KYC audit entries** (IP address, user agent, old/new values → `[REDACTED]`);
   - keeps financial records (bills, wallet ledger, payouts, encrypted PAN and account number when there is financial history) until `statutoryRetentionExpiresAt` (8 years ⚖️), after which `purgeExpiredStatutoryRecords` removes them.

## Retention schedule

| Data | Where | Retention | Basis |
|---|---|---|---|
| Approved invoices, bill financial snapshot | `Bill`, R2 | 8 years from deletion ⚖️ | Tax / accounting records ⚖️ |
| Wallet ledger, payouts | `WalletTransaction`, `Payout` | 8 years from deletion ⚖️ | Financial records ⚖️ |
| Encrypted PAN, encrypted bank account (financial users) | `KycRecord`, `PaymentAccount` | 8 years from deletion ⚖️ | Tax / payout audit ⚖️ |
| Unapproved invoice files | R2 | Deleted at account deletion | No retention purpose |
| Identity audit entries (logins, password changes, name corrections) | `AuditLog` | Redacted at account deletion | — |
| Financial audit entries (bill approval, payouts) | `AuditLog` | Kept with financial records | Audit trail |
| Notifications, device tokens, installations, sessions, OTPs | various | Deleted at account deletion | — |
| Encrypted database backups | Dedicated R2 backup bucket | Local 30 days (`RETENTION_DAYS`); remote: set a lifecycle rule ⚖️ | Disaster recovery |

Data of deleted users remains inside encrypted backups until those backups expire. The remote backup bucket's
lifecycle rule therefore bounds how long erased data persists.

## Processor deletion checklist

These providers receive personal data and are **not** cleaned automatically. Operations must handle them when an
account is deleted or when a deletion request covers them:

| Provider | Data sent | Action |
|---|---|---|
| RazorpayX | Contact (name, mobile), fund account (UPI or bank account + name), payouts | Payout records are financial and retained; deactivate the contact/fund account via RazorpayX dashboard or API |
| SignCare | PAN, consent text | Confirm SignCare's retention under the processing contract ⚖️ |
| Meta WhatsApp Business / MSG91 | Mobile number, OTP messages | Governed by provider retention; no stored copy on our side |
| Google Firebase Cloud Messaging | Device push token, notification content | Token deleted locally; FCM tokens expire when unused |
| Google Play Integrity | App / device attestation | No personal data stored by the platform |
| Cloudflare R2 | Invoice images/PDFs, encrypted backups | Deleted / expired as above |
