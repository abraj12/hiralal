import { prisma } from '../db';
import { config } from '../config';
import { PaymentType } from '@prisma/client';
import { encryptSensitive } from '../utils/crypto.utils';

export class PaymentService {
  /**
   * Masks sensitive account info for presentation:
   * e.g., raj****@okhdfcbank or HDFC Bank ••••••5678
   */
  static maskPaymentInfo(type: PaymentType, identifier: string, bankName?: string): string {
    const clean = identifier.trim();
    if (type === 'UPI') {
      const parts = clean.split('@');
      if (parts.length === 2) {
        const username = parts[0];
        const handle = parts[1];
        const masked = username.length > 3 ? `${username.substring(0, 3)}****` : '****';
        return `${masked}@${handle}`;
      }
      return clean.length > 4 ? `****${clean.slice(-4)}` : clean;
    } else {
      const last4 = clean.slice(-4);
      return `${bankName || 'Bank'} ••••••${last4}`;
    }
  }

  /**
   * Verifies and saves a UPI ID using RazorpayX Fund Account Validation API.
   */
  static async verifyAndAddUpi(userId: string, upiId: string) {
    const cleanUpi = upiId.trim().toLowerCase();

    // Syntax validation
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiRegex.test(cleanUpi)) {
      throw new Error('Please enter a valid UPI ID (e.g., yourname@bank or 9876543210@paytm).');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found.');

    let isValid = true;
    let registeredName = user.fullName;

    // Real RazorpayX VPA Validation
    if (config.razorpayx.keyId && config.razorpayx.keySecret && config.nodeEnv !== 'test') {
      try {
        const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
        const res = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account: {
              account_type: 'vpa',
              vpa: { address: cleanUpi },
            },
            amount: 100, // 1 Rupee penny validation
            currency: 'INR',
          }),
        });

        const data: any = await res.json();
        if (res.ok && data.status !== 'failed') {
          isValid = true;
          registeredName = data.results?.registered_name || user.fullName;
        } else {
          throw new Error(data.error?.description || 'UPI ID validation failed with banking network.');
        }
      } catch (err: any) {
        throw new Error(`UPI Validation failed: ${err.message}`);
      }
    }

    const maskedInfo = this.maskPaymentInfo('UPI', cleanUpi);

    // Save or update account
    return await prisma.$transaction(async (tx) => {
      // Ensure only one default account
      await tx.paymentAccount.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });

      return await tx.paymentAccount.create({
        data: {
          userId,
          accountType: 'UPI',
          upiId: cleanUpi,
          accountHolderName: registeredName,
          maskedInfo,
          isVerified: isValid,
          verifiedAt: new Date(),
          isDefault: true,
        },
      });
    });
  }

  /**
   * Verifies and saves a Bank Account using RazorpayX Penny Drop / Validation.
   */
  static async verifyAndAddBankAccount(params: {
    userId: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName?: string;
  }) {
    const cleanAccount = params.accountNumber.trim();
    const cleanIfsc = params.ifscCode.trim().toUpperCase();
    const cleanName = params.accountHolderName.trim();

    if (cleanAccount.length < 9 || cleanAccount.length > 18 || !/^\d+$/.test(cleanAccount)) {
      throw new Error('Please enter a valid bank account number (9 to 18 digits).');
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      throw new Error('Please enter a valid 11-character Indian IFSC code (e.g. HDFC0001234).');
    }

    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new Error('User not found.');

    let isValid = true;
    let registeredName = cleanName;

    // Real RazorpayX Bank Account Validation
    if (config.razorpayx.keyId && config.razorpayx.keySecret && config.nodeEnv !== 'test') {
      try {
        const auth = 'Basic ' + Buffer.from(`${config.razorpayx.keyId}:${config.razorpayx.keySecret}`).toString('base64');
        const res = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_number: config.razorpayx.accountNumber,
            fund_account: {
              account_type: 'bank_account',
              bank_account: {
                name: cleanName,
                ifsc: cleanIfsc,
                account_number: cleanAccount,
              },
            },
            amount: 100,
            currency: 'INR',
          }),
        });

        const data: any = await res.json();
        if (res.ok && data.status !== 'failed') {
          isValid = true;
          registeredName = data.results?.registered_name || cleanName;
        } else {
          throw new Error(data.error?.description || 'Bank account validation failed with IFSC switch.');
        }
      } catch (err: any) {
        throw new Error(`Bank Account validation failed: ${err.message}`);
      }
    }

    const maskedInfo = this.maskPaymentInfo('BANK_ACCOUNT', cleanAccount, params.bankName);
    const encryptedAccount = encryptSensitive(cleanAccount);

    return await prisma.$transaction(async (tx) => {
      await tx.paymentAccount.updateMany({
        where: { userId: params.userId, isDefault: true },
        data: { isDefault: false },
      });

      return await tx.paymentAccount.create({
        data: {
          userId: params.userId,
          accountType: 'BANK_ACCOUNT',
          accountHolderName: registeredName,
          accountNumber: maskedInfo,
          accountNumberEncrypted: encryptedAccount,
          ifscCode: cleanIfsc,
          bankName: params.bankName || 'Bank',
          maskedInfo,
          isVerified: isValid,
          verifiedAt: new Date(),
          isDefault: true,
        },
      });
    });
  }

  static async getUserPaymentAccounts(userId: string) {
    const accounts = await prisma.paymentAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((a) => ({
      id: a.id,
      accountType: a.accountType,
      maskedInfo: a.maskedInfo,
      bankName: a.bankName,
      accountHolderName: a.accountHolderName,
      isVerified: a.isVerified,
      isDefault: a.isDefault,
      verifiedAt: a.verifiedAt,
      createdAt: a.createdAt,
    }));
  }

  static async addUpiAccount(userId: string, upiId: string, _accountHolderName?: string) {
    return this.verifyAndAddUpi(userId, upiId);
  }

  static async addBankAccount(params: {
    userId: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName?: string;
  }) {
    return this.verifyAndAddBankAccount(params);
  }

  static async getUserAccounts(userId: string) {
    return this.getUserPaymentAccounts(userId);
  }
}
