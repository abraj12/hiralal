import { prisma } from '../db';
import { config } from '../config';

export class PaymentService {
  /**
   * Masks sensitive bank account number or UPI VPA.
   */
  static maskPaymentInfo(type: 'UPI' | 'BANK_ACCOUNT', detail: string): string {
    if (type === 'UPI') {
      const parts = detail.split('@');
      if (parts.length === 2) {
        const name = parts[0];
        const visible = name.length > 3 ? name.substring(0, 3) : name;
        return `${visible}****@${parts[1]}`;
      }
      return detail;
    } else {
      const clean = detail.replace(/\s+/g, '');
      const last4 = clean.slice(-4);
      return `••••••${last4}`;
    }
  }

  /**
   * Adds and verifies a UPI handle via RazorpayX Fund Account Validation.
   */
  static async addUpiAccount(userId: string, upiId: string, accountHolderName?: string) {
    const cleanUpi = upiId.trim().toLowerCase();
    const upiRegex = /^[\w.-]+@[\w.-]+$/;
    if (!upiRegex.test(cleanUpi)) {
      throw new Error('Please enter a valid UPI ID (e.g. yourname@okhdfcbank or 9876543210@paytm).');
    }

    let isVerified = false;

    // Call RazorpayX Fund Account Validation if credentials exist
    if (config.razorpayx.keyId && config.razorpayx.keySecret && config.nodeEnv !== 'test') {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
        const validationRes = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account: {
              account_type: 'vpa',
              vpa: { address: cleanUpi },
              contact: { name: accountHolderName || 'Craftsman', type: 'vendor' },
            },
            amount: 100, // Re. 1 validation
            currency: 'INR',
          }),
        });

        const valData: any = await validationRes.json();
        if (valData.id && valData.status !== 'failed') {
          isVerified = true;
        } else {
          throw new Error(valData.error?.description || 'UPI ID could not be validated with banking network.');
        }
      } catch (err: any) {
        if (config.nodeEnv === 'production') {
          throw new Error(`RazorpayX UPI validation failed: ${err.message}`);
        }
        isVerified = true; // Sandbox fallback in local development
      }
    } else {
      if (config.nodeEnv === 'production') {
        throw new Error('RazorpayX API credentials (RAZORPAYX_KEY_ID & SECRET) are required in production.');
      }
      isVerified = true;
    }

    // Set other accounts to non-default
    await prisma.paymentAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    const maskedInfo = this.maskPaymentInfo('UPI', cleanUpi);

    return await prisma.paymentAccount.create({
      data: {
        userId,
        accountType: 'UPI',
        upiId: cleanUpi,
        accountHolderName: accountHolderName || null,
        maskedInfo,
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
        isDefault: true,
      },
    });
  }

  /**
   * Adds and verifies a Bank Account via RazorpayX penny-drop account validation.
   */
  static async addBankAccount(data: {
    userId: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName?: string;
  }) {
    const cleanAccount = data.accountNumber.replace(/\s+/g, '');
    const cleanIfsc = data.ifscCode.trim().toUpperCase();

    if (!/^\d{9,18}$/.test(cleanAccount)) {
      throw new Error('Please enter a valid 9 to 18-digit bank account number.');
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      throw new Error('Please enter a valid 11-character Indian IFSC code (e.g. HDFC0001234).');
    }

    let isVerified = false;

    // Call RazorpayX Fund Account Validation API
    if (config.razorpayx.keyId && config.razorpayx.keySecret && config.nodeEnv !== 'test') {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
        const validationRes = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account: {
              account_type: 'bank_account',
              bank_account: {
                name: data.accountHolderName,
                ifsc: cleanIfsc,
                account_number: cleanAccount,
              },
              contact: { name: data.accountHolderName, type: 'vendor' },
            },
            amount: 100, // Re 1 penny drop validation
            currency: 'INR',
          }),
        });

        const valData: any = await validationRes.json();
        if (valData.id && valData.status !== 'failed') {
          isVerified = true;
        } else {
          throw new Error(valData.error?.description || 'Bank account verification failed with the bank.');
        }
      } catch (err: any) {
        if (config.nodeEnv === 'production') {
          throw new Error(`RazorpayX Bank Account validation failed: ${err.message}`);
        }
        isVerified = true; // Sandbox fallback in local development
      }
    } else {
      if (config.nodeEnv === 'production') {
        throw new Error('RazorpayX API credentials (RAZORPAYX_KEY_ID & SECRET) are required in production.');
      }
      isVerified = true;
    }

    await prisma.paymentAccount.updateMany({
      where: { userId: data.userId },
      data: { isDefault: false },
    });

    const maskedInfo = `${data.bankName || 'Bank'} ${this.maskPaymentInfo('BANK_ACCOUNT', cleanAccount)}`;

    return await prisma.paymentAccount.create({
      data: {
        userId: data.userId,
        accountType: 'BANK_ACCOUNT',
        accountHolderName: data.accountHolderName.trim(),
        accountNumber: cleanAccount,
        ifscCode: cleanIfsc,
        bankName: data.bankName || null,
        maskedInfo,
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
        isDefault: true,
      },
    });
  }

  /**
   * Retrieves user's registered payment accounts.
   */
  static async getUserAccounts(userId: string) {
    return await prisma.paymentAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        accountType: true,
        maskedInfo: true,
        accountHolderName: true,
        isVerified: true,
        verifiedAt: true,
        isDefault: true,
      },
    });
  }
}
