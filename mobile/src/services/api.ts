import Constants from 'expo-constants';
import { Platform, NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const getBaseUrl = () => {
  // 1. If explicit EXPO_PUBLIC_API_URL is configured and not emulator 10.0.2.2
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && !envUrl.includes('10.0.2.2')) {
    return envUrl;
  }

  // 2. Auto-detect host IP from Expo Constants (hostUri or debuggerHost)
  try {
    const hostUri = Constants.expoConfig?.hostUri || (Constants as any).expoGoConfig?.debuggerHost;
    if (hostUri) {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:5000/api`;
      }
    }
  } catch (e) {
    // ignore
  }

  // 3. Fallback to NativeModules SourceCode scriptURL
  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^:/]+)/);
      const host = match ? match[1] : null;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:5000/api`;
      }
    }
  } catch (e) {
    // ignore
  }

  // 4. If EXPO_PUBLIC_API_URL was set to 10.0.2.2 and no network host was found
  if (envUrl) {
    return envUrl;
  }

  // 5. Default fallback
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000/api';
  }
  return 'http://localhost:5000/api';
};

export const API_BASE = getBaseUrl();
console.log('📡 Mobile API configured at:', API_BASE);

const STORAGE_KEY = 'hiralal_jwt_token';

export class MobileApiClient {
  private static token: string | null = null;

  static async initToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          this.token = window.localStorage.getItem(STORAGE_KEY);
        }
      } else {
        this.token = await SecureStore.getItemAsync(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Storage read warning:', e);
      this.token = null;
    }
    return this.token;
  }

  static async setToken(token: string | null): Promise<void> {
    this.token = token;
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          if (token) {
            window.localStorage.setItem(STORAGE_KEY, token);
          } else {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } else {
        if (token) {
          await SecureStore.setItemAsync(STORAGE_KEY, token);
        } else {
          await SecureStore.deleteItemAsync(STORAGE_KEY);
        }
      }
    } catch (e) {
      console.warn('Storage write warning:', e);
    }
  }

  static getToken(): string | null {
    if (!this.token && Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          this.token = window.localStorage.getItem(STORAGE_KEY);
        }
      } catch (e) {
        // Storage access ignored
      }
    }
    return this.token;
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // If options.body is FormData, let the fetch environment generate multipart boundary
    if (!(options.body instanceof FormData)) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const currentToken = this.getToken();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000); // 12-second timeout

      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      console.log(`⚡ [API] ${options.method || 'GET'} ${endpoint} completed in ${Date.now() - start}ms`);
      if (!res.ok) {
        throw new Error(data.message || 'Request failed');
      }
      return data;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError') {
        console.warn(`⏱️ [API TIMEOUT] ${endpoint} timed out after ${elapsed}ms`);
        throw new Error('Connection timed out. Please check network/Wi-Fi connection.');
      }
      console.warn(`[API ERROR] ${endpoint} (${elapsed}ms):`, err.message);
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

  static async uploadBill(data: {
    invoiceNumber: string;
    invoiceDate: string;
    billAmount: number;
    remarks?: string;
    file?: {
      uri: string;
      name: string;
      type: string;
      file?: any;
    };
    fileBase64?: string;
    fileName?: string;
    mimeType?: string;
  }) {
    if (data.file) {
      const formData = new FormData();
      formData.append('invoiceNumber', data.invoiceNumber);
      formData.append('invoiceDate', data.invoiceDate);
      formData.append('billAmount', String(data.billAmount));
      if (data.remarks) {
        formData.append('remarks', data.remarks);
      }

      if (Platform.OS === 'web') {
        if (data.file.file instanceof Blob || (typeof File !== 'undefined' && data.file.file instanceof File)) {
          formData.append('invoiceFile', data.file.file, data.file.name);
        } else {
          try {
            const resp = await fetch(data.file.uri);
            const blob = await resp.blob();
            formData.append('invoiceFile', blob, data.file.name);
          } catch {
            formData.append('invoiceFile', {
              uri: data.file.uri,
              name: data.file.name,
              type: data.file.type,
            } as any);
          }
        }
      } else {
        formData.append('invoiceFile', {
          uri: data.file.uri,
          name: data.file.name,
          type: data.file.type,
        } as any);
      }

      return this.request('/bills', {
        method: 'POST',
        body: formData,
      });
    }

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

  static getPayoutEligibility() {
    return this.request('/payouts/eligibility');
  }

  static getPayouts() {
    return this.request('/payouts');
  }
}
