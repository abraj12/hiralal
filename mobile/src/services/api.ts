import Constants from 'expo-constants';
import { Platform, NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface RequiredActionAttestation {
  integrityToken: string;
  integrityNonce: string;
}

const getBaseUrl = () => {
  // 1. In production builds, explicit HTTPS EXPO_PUBLIC_API_URL takes absolute precedence
  const isProduction = process.env.NODE_ENV === 'production' || (typeof __DEV__ !== 'undefined' && !__DEV__);
  const envUrl = process.env.EXPO_PUBLIC_API_URL;

  if (isProduction) {
    if (!envUrl || !envUrl.startsWith('https://')) {
      throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL.');
    }
    return envUrl;
  }

  // 2. If explicit EXPO_PUBLIC_API_URL is configured for development
  if (envUrl && !envUrl.includes('10.205.173.1') && !envUrl.includes('10.0.2.2')) {
    return envUrl;
  }

  // 3. If running on Web, dynamically connect to current hostname
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:5000/api`;
  }

  // 4. Auto-detect host IP from Expo Constants (hostUri or debuggerHost)
  // This automatically matches the Metro IP that the phone connected to over Wi-Fi
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

  // 5. Fallback to NativeModules SourceCode scriptURL
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

  // 6. Default development fallback
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

  static login(identifier: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, mobile: identifier, password }),
    });
  }

  static async logout() {
    const rf = this.getRefreshToken();
    try {
      await this.request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: rf || undefined }),
      });
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

  static async uploadBill(
    data: {
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
    },
    attestation: RequiredActionAttestation
  ) {
    if (!attestation || !attestation.integrityToken?.trim() || !attestation.integrityNonce?.trim()) {
      throw new Error('Play Integrity attestation (integrityToken and integrityNonce) is required for bill upload.');
    }

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': attestation.integrityToken.trim(),
      'x-integrity-nonce': attestation.integrityNonce.trim(),
    };

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
        headers: extraHeaders,
        body: formData,
      });
    }

    return this.request('/bills', {
      method: 'POST',
      headers: extraHeaders,
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
  static verifyPan(
    panNumber: string,
    panName: string,
    consent: boolean,
    consentText: string | undefined,
    attestation: RequiredActionAttestation
  ) {
    if (!attestation || !attestation.integrityToken?.trim() || !attestation.integrityNonce?.trim()) {
      throw new Error('Play Integrity attestation (integrityToken and integrityNonce) is required for PAN verification.');
    }

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': attestation.integrityToken.trim(),
      'x-integrity-nonce': attestation.integrityNonce.trim(),
    };

    return this.request('/kyc/pan/verify', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ panNumber, panName, consent, consentText }),
    });
  }

  // Public Admin Discovery
  static getAdminPrefixes(): Promise<{ success: boolean; prefixes: { billAdmin: string; operationsAdmin: string } }> {
    return this.request('/auth/admin-prefixes');
  }

  // Payment Accounts
  static verifyUpi(upiId: string, accountHolderName?: string, attestation?: RequiredActionAttestation) {
    const extraHeaders: Record<string, string> = {};
    if (attestation && attestation.integrityToken && attestation.integrityNonce) {
      extraHeaders['x-integrity-token'] = attestation.integrityToken.trim();
      extraHeaders['x-integrity-nonce'] = attestation.integrityNonce.trim();
    }
    return this.request('/payment-account/upi/verify', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ upiId, accountHolderName }),
    });
  }

  static verifyBankAccount(
    data: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName?: string;
    },
    attestation?: RequiredActionAttestation
  ) {
    const extraHeaders: Record<string, string> = {};
    if (attestation && attestation.integrityToken && attestation.integrityNonce) {
      extraHeaders['x-integrity-token'] = attestation.integrityToken.trim();
      extraHeaders['x-integrity-nonce'] = attestation.integrityNonce.trim();
    }
    return this.request('/payment-account/bank/verify', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(data),
    });
  }

  static getPaymentAccounts() {
    return this.request('/payment-account');
  }

  // Payouts
  static redeemRewards(
    data: {
      idempotencyKey: string;
      paymentAccountId?: string;
      amount?: number;
    },
    attestation: RequiredActionAttestation
  ) {
    if (!attestation || !attestation.integrityToken?.trim() || !attestation.integrityNonce?.trim()) {
      throw new Error('Play Integrity attestation (integrityToken and integrityNonce) is required for payout redemption.');
    }

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': attestation.integrityToken.trim(),
      'x-integrity-nonce': attestation.integrityNonce.trim(),
    };

    return this.request('/payouts/redeem', {
      method: 'POST',
      headers: extraHeaders,
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

  static getAdminBillDocumentUrl(id: string) {
    return this.request(`/admin/bills/${id}/document-url`);
  }

  static getAdminBillReviewConfig(id: string) {
    return this.request(`/admin/bills/${encodeURIComponent(id)}/review-config`);
  }

  static getGstRules() {
    return this.request('/admin/settings/gst-rules');
  }

  static verifyAdminBill(
    id: string,
    actionOrOptions:
      | 'APPROVE'
      | 'REJECT'
      | {
          action: 'APPROVE' | 'REJECT';
          rejectionReason?: string;
          gstIncluded?: boolean;
          gstRate?: number;
          gstRuleId?: string;
          gstOverrideReason?: string;
        },
    legacyRejectionReason?: string
  ) {
    const payload =
      typeof actionOrOptions === 'string'
        ? { action: actionOrOptions, rejectionReason: legacyRejectionReason }
        : actionOrOptions;

    return this.request(`/admin/bills/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
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

  // ==========================================
  // In-App Notifications & Device Token API
  // ==========================================

  static getNotifications(page = 1, limit = 20) {
    return this.request(`/notifications?page=${page}&limit=${limit}`);
  }

  static getUnreadNotificationCount() {
    return this.request('/notifications/unread-count');
  }

  static markNotificationRead(id: string) {
    return this.request(`/notifications/${id}/read`, { method: 'PATCH' });
  }

  static markAllNotificationsRead() {
    return this.request('/notifications/read-all', { method: 'PATCH' });
  }

  static registerDevicePushToken(token: string, platform = Platform.OS.toUpperCase()) {
    return this.request('/notifications/device-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    });
  }

  static deactivateDevicePushToken(token: string) {
    return this.request(`/notifications/device-token/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    });
  }

  // Play Integrity API
  static getIntegrityNonce(options: { action: string; requestHash: string }) {
    return this.request<{ success: boolean; nonce: string; message?: string }>('/auth/integrity/nonce', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  static getPreAuthIntegrityNonce(options: { requestHash: string }) {
    return this.request<{ success: boolean; nonce: string; message?: string }>('/auth/integrity/pre-auth/nonce', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  static verifyIntegrityToken(
    nonce: string,
    integrityToken: string,
    options: { action: string; requestHash: string }
  ) {
    return this.request('/auth/integrity/verify', {
      method: 'POST',
      body: JSON.stringify({ nonce, integrityToken, ...options }),
    });
  }

  // Account Deletion API (Password + OTP + 7-Day Grace Period)
  static requestAccountDeletion(password: string, attestation?: RequiredActionAttestation) {
    const extraHeaders: Record<string, string> = {};
    if (attestation && attestation.integrityToken?.trim()) {
      extraHeaders['x-integrity-token'] = attestation.integrityToken.trim();
      extraHeaders['x-integrity-nonce'] = attestation.integrityNonce?.trim() || '';
    }
    return this.request('/auth/account-deletion/request', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ password }),
    });
  }

  static confirmAccountDeletion(otpCode: string, attestation?: RequiredActionAttestation) {
    const extraHeaders: Record<string, string> = {};
    if (attestation && attestation.integrityToken?.trim()) {
      extraHeaders['x-integrity-token'] = attestation.integrityToken.trim();
      extraHeaders['x-integrity-nonce'] = attestation.integrityNonce?.trim() || '';
    }
    return this.request('/auth/account-deletion/confirm', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ otpCode }),
    });
  }

  static getAccountDeletionStatus() {
    return this.request('/auth/account-deletion/status');
  }

  // Idempotent Welcome Notification API
  static triggerWelcomeNotification(installationId: string) {
    return this.request('/notifications/welcome', {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    });
  }
}
