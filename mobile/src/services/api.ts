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
const REFRESH_STORAGE_KEY = 'hiralal_refresh_token';

export class MobileApiClient {
  private static token: string | null = null;
  private static refreshToken: string | null = null;
  private static refreshPromise: Promise<string | null> | null = null;

  static async initToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          this.token = window.localStorage.getItem(STORAGE_KEY);
          this.refreshToken = window.localStorage.getItem(REFRESH_STORAGE_KEY);
        }
      } else {
        this.token = await SecureStore.getItemAsync(STORAGE_KEY);
        this.refreshToken = await SecureStore.getItemAsync(REFRESH_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Storage read warning:', e);
      this.token = null;
      this.refreshToken = null;
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

  static async setRefreshToken(refreshToken: string | null): Promise<void> {
    this.refreshToken = refreshToken;
    try {
      if (Platform.OS === 'web') {
        // In production web builds, do not persist long-lived refresh tokens in localStorage
        if (process.env.NODE_ENV === 'production') {
          return;
        }
        if (typeof window !== 'undefined' && window.localStorage) {
          if (refreshToken) {
            window.localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
          } else {
            window.localStorage.removeItem(REFRESH_STORAGE_KEY);
          }
        }
      } else {
        if (refreshToken) {
          await SecureStore.setItemAsync(REFRESH_STORAGE_KEY, refreshToken);
        } else {
          await SecureStore.deleteItemAsync(REFRESH_STORAGE_KEY);
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

  static getRefreshToken(): string | null {
    if (!this.refreshToken && Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          this.refreshToken = window.localStorage.getItem(REFRESH_STORAGE_KEY);
        }
      } catch (e) {
        // Storage access ignored
      }
    }
    return this.refreshToken;
  }

  static async clearAllTokens(): Promise<void> {
    await this.setToken(null);
    await this.setRefreshToken(null);
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
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
    if (currentToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('application/json')) {
        try {
          data = await res.json();
        } catch {
          data = {};
        }
      } else {
        const text = await res.text();
        data = { message: text };
      }

      // If 401 Unauthorized, perform token rotation and retry once
      if (
        res.status === 401 &&
        !isRetry &&
        !endpoint.startsWith('/auth/login') &&
        !endpoint.startsWith('/auth/refresh') &&
        !endpoint.startsWith('/auth/register')
      ) {
        const refreshedToken = await this.performTokenRefresh();
        if (refreshedToken) {
          const retryHeaders = { ...headers, Authorization: `Bearer ${refreshedToken}` };
          return this.request(endpoint, { ...options, headers: retryHeaders }, true);
        }
      }

      if (!res.ok) {
        throw new Error(data.message || `Request failed with status ${res.status}`);
      }

      return data;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError') {
        throw new Error('Connection timed out. Please check network/Wi-Fi connection.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private static async performTokenRefresh(): Promise<string | null> {
    const rf = this.getRefreshToken();
    if (!rf) {
      await this.clearAllTokens();
      return null;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res: globalThis.Response;
        try {
          res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rf }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!res.ok) {
          // If server explicitly returns 401 Unauthorized, token is expired/revoked: clear credentials
          if (res.status === 401) {
            await this.clearAllTokens();
          }
          return null;
        }

        const data = await res.json();
        const newAccessToken = data.accessToken || data.token;
        if (newAccessToken) {
          await this.setToken(newAccessToken);
          if (data.refreshToken) {
            await this.setRefreshToken(data.refreshToken);
          }
          return newAccessToken;
        }
        await this.clearAllTokens();
        return null;
      } catch (err) {
        // Transient network failures or timeouts MUST NOT clear user credentials!
        console.warn('Token refresh network attempt failed:', err);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // Auth
  static sendOtp(mobile: string, purpose = 'REGISTRATION') {
    return this.request('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ mobile, purpose }),
    });
  }

  static requestOtp(mobile: string, purpose = 'REGISTRATION') {
    return this.sendOtp(mobile, purpose);
  }

  static verifyOtp(mobile: string, otpCode: string, purpose = 'REGISTRATION') {
    return this.request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ mobile, otpCode, purpose }),
    });
  }

  static register(data: {
    mobile: string;
    fullName?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    password: string;
    profession: string;
    verificationToken?: string;
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

  static async logout() {
    const rf = this.getRefreshToken();
    try {
      if (rf) {
        await this.request('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: rf }),
        });
      }
    } catch {
      // safe fallback
    } finally {
      await this.clearAllTokens();
    }
  }

  static getProfile() {
    return this.request('/auth/me');
  }

  static updateProfileName(data: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    fullName?: string;
  }) {
    return this.request('/auth/profile/name', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
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
  static verifyPan(panNumber: string, panName: string, consent = true, consentText?: string) {
    return this.request('/kyc/pan/verify', {
      method: 'POST',
      body: JSON.stringify({ panNumber, panName, consent, consentText }),
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
    amount?: number;
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

  // Real Backend Password Reset Flow
  static requestPasswordReset(mobile: string) {
    return this.request('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  }

  static verifyPasswordResetOtp(mobile: string, otpCode: string) {
    return this.request('/auth/password-reset/verify', {
      method: 'POST',
      body: JSON.stringify({ mobile, otpCode }),
    });
  }

  static completePasswordReset(data: {
    mobile: string;
    verificationToken: string;
    newPassword: string;
  }) {
    return this.request('/auth/password-reset/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Admin Authentication Sequence (Password-First, OTP-Challenge Flow)
  static requestAdminOtp(identifier: string, password?: string) {
    return this.request('/auth/admin/otp/request', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
  }

  static verifyAdminOtp(identifier: string, otpCode: string, challengeToken?: string) {
    return this.request('/auth/admin/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ identifier, otpCode, challengeToken }),
    });
  }

  static loginAdmin(identifier: string, password: string, verificationToken: string) {
    return this.request('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, verificationToken }),
    });
  }

  // Mobile Admin Endpoints
  static getAdminBills(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/bills?${params.toString()}`);
  }

  static verifyAdminBill(id: string, action: 'APPROVE' | 'REJECT', rejectionReason?: string) {
    return this.request(`/admin/bills/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ action, rejectionReason }),
    });
  }

  static getAdminPayouts(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/payouts?${params.toString()}`);
  }

  static handleAdminPayout(id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    return this.request(`/admin/payouts/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    });
  }
}
