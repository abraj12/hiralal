import { Platform } from 'react-native';

const getBaseUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000/api';
  }
  return 'http://localhost:5000/api';
};

export const API_BASE = getBaseUrl();

export class MobileApiClient {
  private static token: string | null = null;

  static setToken(token: string | null) {
    this.token = token;
  }

  static getToken(): string | null {
    return this.token;
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Request failed');
      }
      return data;
    } catch (err: any) {
      console.warn(`[API ERROR] ${endpoint}:`, err.message);
      throw err;
    }
  }

  // Auth
  static sendOtp(mobile: string, purpose = 'REGISTRATION') {
    return this.request('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ mobile, purpose }),
    });
  }

  static verifyOtp(mobile: string, otpCode: string, purpose = 'REGISTRATION') {
    return this.request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ mobile, otpCode, purpose }),
    });
  }

  static register(data: {
    mobile: string;
    fullName: string;
    password: string;
    profession: string;
    otpCode?: string;
  }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static login(mobile: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mobile, password }),
    });
  }

  static getProfile() {
    return this.request('/auth/me');
  }

  static updateProfile(data: { profession?: string; fullName?: string }) {
    return this.request('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // Bills
  static getBills(status = 'ALL') {
    return this.request(`/bills?status=${status}`);
  }

  static uploadBill(data: {
    invoiceNumber: string;
    invoiceDate: string;
    billAmount: number;
    remarks?: string;
    fileBase64?: string;
  }) {
    return this.request('/bills', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Rewards
  static getRewards() {
    return this.request('/rewards');
  }

  // Wallet
  static getWallet() {
    return this.request('/wallet');
  }

  // KYC (PAN)
  static verifyPan(panNumber: string, panName: string) {
    return this.request('/kyc/pan/verify', {
      method: 'POST',
      body: JSON.stringify({ panNumber, panName }),
    });
  }

  // Payment Accounts
  static verifyUpi(upiId: string) {
    return this.request('/payment-account/upi/verify', {
      method: 'POST',
      body: JSON.stringify({ upiId }),
    });
  }

  static verifyBankAccount(data: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
  }) {
    return this.request('/payment-account/bank/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static getPaymentAccounts() {
    return this.request('/payment-account');
  }

  // Payouts
  static redeemRewards(data: {
    amount: number;
    paymentAccountId?: string;
    idempotencyKey: string;
  }) {
    return this.request('/payouts/redeem', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static getPayouts() {
    return this.request('/payouts');
  }
}
