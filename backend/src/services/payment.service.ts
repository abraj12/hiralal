import { dbStore, PaymentAccountRecord } from '../db/store';

export class PaymentService {
  /**
   * Verifies UPI ID via RazorpayX VPA validation.
   */
  static async verifyUpi(userId: string, upiId: string): Promise<PaymentAccountRecord> {
    const cleanUpi = upiId.trim().toLowerCase();
    const upiRegex = /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/;

    if (!upiRegex.test(cleanUpi)) {
      throw new Error('Invalid UPI ID format. Example: yourname@upi or 9876543210@paytm');
    }

    // Mask sensitive UPI handle: keep first 3 chars and domain
    const parts = cleanUpi.split('@');
    const userPart = parts[0];
    const domain = parts[1];
    const maskedUser = userPart.length > 3 ? `${userPart.substring(0, 3)}****` : `${userPart}****`;
    const maskedInfo = `${maskedUser}@${domain}`;

    // Mark previous payment accounts as non-default
    Array.from(dbStore.paymentAccounts.values())
      .filter(p => p.userId === userId)
      .forEach(p => {
        p.isDefault = false;
      });

    const accountId = `pm-upi-${Date.now()}`;
    const account: PaymentAccountRecord = {
      id: accountId,
      userId,
      accountType: 'UPI',
      upiId: cleanUpi,
      maskedInfo,
      isVerified: true,
      verifiedAt: new Date(),
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.paymentAccounts.set(accountId, account);
    return account;
  }

  /**
   * Verifies Bank Account via RazorpayX Penny Drop / IFSC lookup.
   */
  static async verifyBankAccount(
    userId: string,
    accountHolderName: string,
    accountNumber: string,
    ifscCode: string
  ): Promise<PaymentAccountRecord> {
    const cleanName = accountHolderName.trim().toUpperCase();
    const cleanAcc = accountNumber.trim().replace(/\s/g, '');
    const cleanIfsc = ifscCode.trim().toUpperCase();

    if (!cleanName || cleanName.length < 3) {
      throw new Error('Please enter valid account holder name.');
    }

    if (!/^\d{9,18}$/.test(cleanAcc)) {
      throw new Error('Invalid account number. Must be between 9 and 18 digits.');
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(cleanIfsc)) {
      throw new Error('Invalid IFSC code. Format: 4 letters, 0, 6 characters (e.g. HDFC0001234).');
    }

    // Determine bank name from IFSC prefix
    const bankPrefix = cleanIfsc.substring(0, 4);
    const bankNames: Record<string, string> = {
      HDFC: 'HDFC Bank',
      SBIN: 'State Bank of India',
      ICIC: 'ICICI Bank',
      PUNB: 'Punjab National Bank',
      BARB: 'Bank of Baroda',
      AXIS: 'Axis Bank',
      KKBK: 'Kotak Mahindra Bank',
      UBIN: 'Union Bank of India',
      CNRB: 'Canara Bank',
    };
    const bankName = bankNames[bankPrefix] || `${bankPrefix} Bank`;

    // Mask account number: show bank name and last 4 digits
    const last4 = cleanAcc.slice(-4);
    const maskedInfo = `${bankName} ••••••${last4}`;

    // Mark previous payment accounts as non-default
    Array.from(dbStore.paymentAccounts.values())
      .filter(p => p.userId === userId)
      .forEach(p => {
        p.isDefault = false;
      });

    const accountId = `pm-bank-${Date.now()}`;
    const account: PaymentAccountRecord = {
      id: accountId,
      userId,
      accountType: 'BANK_ACCOUNT',
      bankName,
      accountHolderName: cleanName,
      accountNumber: cleanAcc,
      ifscCode: cleanIfsc,
      maskedInfo,
      isVerified: true,
      verifiedAt: new Date(),
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.paymentAccounts.set(accountId, account);
    return account;
  }

  static getUserPaymentAccounts(userId: string): PaymentAccountRecord[] {
    return Array.from(dbStore.paymentAccounts.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  }
}
