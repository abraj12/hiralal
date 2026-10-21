import { prisma } from '../db';
import { config } from '../config';
import { PaymentType } from '@prisma/client';
import { encryptSensitive, decryptSensitive, generateBlindIndex } from '../utils/crypto.utils';

export function readProviderRegisteredName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (normalized.length < 2 || normalized.length > 200) {
    return null;
  }

  return normalized;
}

export class PaymentService {
  static forceRealProvider = false;
  static mockProviderActive = false;

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
   * Requires explicit documented success from provider.
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
    if (user.role !== 'USER') {
      throw new Error('Only registered users can link payment accounts.');
    }
    if (user.status !== 'ACTIVE') {
      throw new Error('User account is suspended or inactive.');
    }

    const beneficiaryBlindIndex = generateBlindIndex(`UPI:${cleanUpi}`);

    // Prevent cross-user account takeover: ensure UPI is not already verified to another user
    const existingOther = await prisma.paymentAccount.findFirst({
      where: {
        OR: [
          { upiId: cleanUpi },
          { beneficiaryBlindIndex },
        ],
        userId: { not: userId },
        isVerified: true,
      },
    });
    if (existingOther) {
      throw new Error('This UPI ID is already registered and verified with another user account.');
    }

    let isValid = false;
    let providerRegisteredName: string | null = null;
    let providerNameVerified = false;

    if (config.isProduction || config.nodeEnv === 'production') {
      if (this.mockProviderActive) {
        throw new Error('Test-only provider mocks cannot be selected in production mode.');
      }
      if (!config.razorpayx.keyId || !config.razorpayx.keySecret) {
        throw new Error('Payment provider credentials are not configured. Verification cannot proceed in production.');
      }
    }

    const isTestMock = config.nodeEnv === 'test' && !this.forceRealProvider;

    if (isTestMock) {
      if (config.isProduction || config.nodeEnv === 'production') {
        throw new Error('Test-only provider mocks cannot be selected in production mode.');
      }
      isValid = true;
      providerRegisteredName = user.fullName;
      providerNameVerified = true;
    } else {
      if (!config.razorpayx.keyId || !config.razorpayx.keySecret) {
        throw new Error('Payment provider credentials are not configured. Verification cannot proceed.');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s strict timeout

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
          signal: controller.signal,
        });

        const data: any = await res.json().catch(() => null);

        const providerName = readProviderRegisteredName(data?.results?.registered_name);

        const explicitlyVerified =
          res.ok &&
          data &&
          (data.status === 'completed' || data.status === 'created') &&
          data.results?.account_status === 'active' &&
          providerName !== null;

        if (!explicitlyVerified) {
          throw new Error(
            'The payment provider could not confirm the beneficiary name. ' +
            'Please retry verification or contact support.'
          );
        }

        isValid = true;
        providerRegisteredName = providerName;
        providerNameVerified = true;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('UPI account validation timed out. Please try again.');
        }
        throw new Error(`UPI Validation failed: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    const maskedInfo = this.maskPaymentInfo('UPI', cleanUpi);

    // Save or update account under concurrency-safe transaction
    try {
      return await prisma.$transaction(async (tx) => {
        // Concurrency lock on user row to eliminate duplicate default account race conditions
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

        // Ensure only one default account
        await tx.paymentAccount.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });

        // If the same user already has this payment account, update it
        const existingSelf = await tx.paymentAccount.findFirst({
          where: {
            userId,
            beneficiaryBlindIndex,
          },
        });

        if (existingSelf) {
          return await tx.paymentAccount.update({
            where: { id: existingSelf.id },
            data: {
              upiId: cleanUpi,
              accountHolderName: providerRegisteredName || user.fullName,
              providerRegisteredName,
              providerNameVerified,
              maskedInfo,
              isVerified: isValid,
              verifiedAt: isValid ? new Date() : null,
              isDefault: true,
            },
          });
        }

        return await tx.paymentAccount.create({
          data: {
            userId,
            accountType: 'UPI',
            upiId: cleanUpi,
            beneficiaryBlindIndex,
            accountHolderName: providerRegisteredName || user.fullName,
            providerRegisteredName,
            providerNameVerified,
            maskedInfo,
            isVerified: isValid,
            verifiedAt: isValid ? new Date() : null,
            isDefault: true,
          },
        });
      });
    } catch (err: any) {
      if (err.code === 'P2002' || (err.message && err.message.includes('Unique constraint failed'))) {
        throw new Error('This UPI ID is already registered and verified with another user account.');
      }
      throw err;
    }
  }

  /**
   * Verifies and saves a Bank Account using RazorpayX Penny Drop / Validation.
   * Requires explicit documented success from provider.
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
    if (user.role !== 'USER') {
      throw new Error('Only registered users can link payment accounts.');
    }
    if (user.status !== 'ACTIVE') {
      throw new Error('User account is suspended or inactive.');
    }

    const maskedInfo = this.maskPaymentInfo('BANK_ACCOUNT', cleanAccount, params.bankName);
    const beneficiaryBlindIndex = generateBlindIndex(`BANK:${cleanIfsc}:${cleanAccount}`);

    // Prevent cross-user duplicate registration using exact normalized account number + IFSC blind index
    const existingOther = await prisma.paymentAccount.findFirst({
      where: {
        beneficiaryBlindIndex,
        userId: { not: params.userId },
        isVerified: true,
      },
    });
    if (existingOther) {
      throw new Error('This bank account is already registered and verified with another user account.');
    }

    // Fallback check for unindexed legacy rows
    const existingOthers = await prisma.paymentAccount.findMany({
      where: {
        ifscCode: cleanIfsc,
        userId: { not: params.userId },
        isVerified: true,
        beneficiaryBlindIndex: null,
      },
      select: {
        id: true,
        accountNumberEncrypted: true,
        maskedInfo: true,
      },
    });

    for (const other of existingOthers) {
      if (other.accountNumberEncrypted) {
        try {
          const decrypted = decryptSensitive(other.accountNumberEncrypted);
          // SEC-MED-06: Opportunistically backfill blind index on legacy unindexed row
          const backfilledIndex = generateBlindIndex(`${cleanIfsc}:${decrypted}`);
          prisma.paymentAccount.update({
            where: { id: other.id },
            data: { beneficiaryBlindIndex: backfilledIndex },
          }).catch(() => {});

          if (decrypted === cleanAccount) {
            throw new Error('This bank account is already registered and verified with another user account.');
          }
        } catch (e: any) {
          if (e.message && e.message.includes('already registered')) throw e;
          if (other.maskedInfo === maskedInfo) {
            throw new Error('This bank account is already registered and verified with another user account.');
          }
        }
      } else if (other.maskedInfo === maskedInfo) {
        throw new Error('This bank account is already registered and verified with another user account.');
      }
    }

    let isValid = false;
    let providerRegisteredName: string | null = null;
    let providerNameVerified = false;

    if (config.isProduction || config.nodeEnv === 'production') {
      if (this.mockProviderActive) {
        throw new Error('Test-only provider mocks cannot be selected in production mode.');
      }
      if (!config.razorpayx.keyId || !config.razorpayx.keySecret) {
        throw new Error('Payment provider credentials are not configured. Verification cannot proceed in production.');
      }
    }

    const isTestMock = config.nodeEnv === 'test' && !this.forceRealProvider;

    if (isTestMock) {
      if (config.isProduction || config.nodeEnv === 'production') {
        throw new Error('Test-only provider mocks cannot be selected in production mode.');
      }
      isValid = true;
      providerRegisteredName = cleanName;
      providerNameVerified = true;
    } else {
      if (!config.razorpayx.keyId || !config.razorpayx.keySecret) {
        throw new Error('Payment provider credentials are not configured. Verification cannot proceed.');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s strict timeout

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
          signal: controller.signal,
        });

        const data: any = await res.json().catch(() => null);

        const providerName = readProviderRegisteredName(data?.results?.registered_name);

        const explicitlyVerified =
          res.ok &&
          data &&
          (data.status === 'completed' || data.status === 'created') &&
          data.results?.account_status === 'active' &&
          providerName !== null;

        if (!explicitlyVerified) {
          throw new Error(
            'The payment provider could not confirm the beneficiary name. ' +
            'Please retry verification or contact support.'
          );
        }

        isValid = true;
        providerRegisteredName = providerName;
        providerNameVerified = true;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('Bank account validation timed out. Please try again.');
        }
        throw new Error(`Bank Account validation failed: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    const encryptedAccount = encryptSensitive(cleanAccount);

    try {
      return await prisma.$transaction(async (tx) => {
        // Concurrency lock on user row to eliminate duplicate default account race conditions
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${params.userId} FOR UPDATE`;

        await tx.paymentAccount.updateMany({
          where: { userId: params.userId, isDefault: true },
          data: { isDefault: false },
        });

        // If the same user already has this payment account, update it
        const existingSelf = await tx.paymentAccount.findFirst({
          where: {
            userId: params.userId,
            beneficiaryBlindIndex,
          },
        });

        if (existingSelf) {
          return await tx.paymentAccount.update({
            where: { id: existingSelf.id },
            data: {
              accountHolderName: providerRegisteredName || cleanName,
              providerRegisteredName,
              providerNameVerified,
              accountNumber: maskedInfo,
              accountNumberEncrypted: encryptedAccount,
              ifscCode: cleanIfsc,
              bankName: params.bankName || 'Bank',
              maskedInfo,
              isVerified: isValid,
              verifiedAt: isValid ? new Date() : null,
              isDefault: true,
            },
          });
        }

        return await tx.paymentAccount.create({
          data: {
            userId: params.userId,
            accountType: 'BANK_ACCOUNT',
            beneficiaryBlindIndex,
            accountHolderName: providerRegisteredName || cleanName,
            providerRegisteredName,
            providerNameVerified,
            accountNumber: maskedInfo,
            accountNumberEncrypted: encryptedAccount,
            ifscCode: cleanIfsc,
            bankName: params.bankName || 'Bank',
            maskedInfo,
            isVerified: isValid,
            verifiedAt: isValid ? new Date() : null,
            isDefault: true,
          },
        });
      });
    } catch (err: any) {
      if (err.code === 'P2002' || (err.message && err.message.includes('Unique constraint failed'))) {
        throw new Error('This bank account is already registered and verified with another user account.');
      }
      throw err;
    }
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
      providerRegisteredName: a.providerRegisteredName,
      providerNameVerified: a.providerNameVerified,
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
