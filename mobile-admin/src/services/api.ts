import Constants from 'expo-constants';
import { Platform, NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface RequiredActionAttestation {
  integrityToken: string;
  integrityNonce: string;
}

export interface PreAuthRecoveryAttestation {
  integrityToken: string;
  integrityNonce: string;
  integrityRequestSalt: string;
}

import { validateProductionApiUrl } from './apiUrl';
import { validateRecoverySalt } from './integrityRequestHash';
export { validateProductionApiUrl };

const getBaseUrl = () => {
  // 1. In production builds, explicit HTTPS EXPO_PUBLIC_API_URL takes absolute precedence
  const isProduction = process.env.NODE_ENV === 'production' || (typeof __DEV__ !== 'undefined' && !__DEV__);
  const envUrl = process.env.EXPO_PUBLIC_API_URL;

  if (isProduction) {
    return validateProductionApiUrl(envUrl);
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

export function resolveDocumentUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  const clean = url.trim();
  if (clean.startsWith('https://')) {
    return clean;
  }
  if (clean.startsWith('http://')) {
    if (process.env.NODE_ENV === 'production') {
      return clean.replace(/^http:\/\//i, 'https://');
    }
    return clean;
  }
  const baseOrigin = API_BASE.replace(/\/api(\/v1)?\/?$/, '');
  return `${baseOrigin}${clean.startsWith('/') ? '' : '/'}${clean}`;
}

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
        // In production web builds, do not persist access tokens in localStorage
        if (process.env.NODE_ENV === 'production') {
          return;
        }
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

  static async getStoredUser(): Promise<any | null> {
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          raw = window.localStorage.getItem('hiralal_user');
        }
      } else {
        raw = await SecureStore.getItemAsync('hiralal_user');
      }
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static async setStoredUser(user: any | null): Promise<void> {
    try {
      const val = user ? JSON.stringify(user) : null;
      if (Platform.OS === 'web') {
        if (process.env.NODE_ENV === 'production') {
          // On web in production, avoid persisting user PII into unencrypted localStorage
          return;
        }
        if (typeof window !== 'undefined' && window.localStorage) {
          if (val) window.localStorage.setItem('hiralal_user', val);
          else window.localStorage.removeItem('hiralal_user');
        }
      } else {
        if (val) await SecureStore.setItemAsync('hiralal_user', val);
        else await SecureStore.deleteItemAsync('hiralal_user');
      }
    } catch {}
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
    await this.setStoredUser(null);
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const headers: Record<string, string> = {
      'X-Client-Type': 'mobile-admin',
      ...(options.headers as Record<string, string>),
    };

    // If options.body is FormData, let the fetch environment generate multipart boundary
    if (!(options.body instanceof FormData)) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    // If a token refresh is currently in progress, wait for it before dispatching new authenticated requests
    if (this.refreshPromise && !endpoint.startsWith('/auth/')) {
      try {
        await this.refreshPromise;
      } catch {
        // If refresh fails, let request proceed to handle 401/error normally
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

  static async register(data: {
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
    const extraHeaders: Record<string, string> = {};

    // Perform pre-auth integrity attestation on Android only
    if (Platform.OS === 'android') {
      try {
        const { createRegistrationRequestHash } = await import('./integrityRequestHash');
        const { MobileIntegrityService } = await import('./integrity.service');

        const requestHash = await createRegistrationRequestHash({
          mobile: data.mobile,
          profession: data.profession,
          firstName: data.firstName,
          middleName: data.middleName,
          lastName: data.lastName,
          fullName: data.fullName,
        });

        // Fetch pre-auth nonce (no authentication required)
        const nonceRes = await this.getPreAuthIntegrityNonce({ requestHash, action: 'REGISTRATION' });
        if (!nonceRes?.success || !nonceRes?.nonce) {
          throw new Error(nonceRes?.message || 'Failed to acquire pre-auth registration integrity nonce.');
        }

        // Get native device integrity token
        const integrityToken = await MobileIntegrityService.requestDeviceIntegrityToken(nonceRes.nonce);
        if (!integrityToken) {
          throw new Error('Device integrity token could not be obtained.');
        }

        extraHeaders['x-integrity-token'] = integrityToken;
        extraHeaders['x-integrity-nonce'] = nonceRes.nonce;
      } catch (integrityErr: any) {
        console.error('[MOBILE-INTEGRITY] Pre-auth registration attestation failed:', integrityErr?.message);
        throw new Error(`Device integrity attestation failed for registration: ${integrityErr?.message || 'Unknown error'}`);
      }
    }

    return this.request('/auth/register', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(data),
    });
  }

  static async login(identifier: string, password: string) {
    const extraHeaders: Record<string, string> = {};

    if (Platform.OS === 'android') {
      try {
        const { createAuthRequestHash } = await import('./integrityRequestHash');
        const { MobileIntegrityService } = await import('./integrity.service');

        const requestHash = await createAuthRequestHash({
          identifier,
        });

        // Fetch pre-auth nonce (no authentication required)
        const nonceRes = await this.getPreAuthIntegrityNonce({ requestHash, action: 'AUTH' });
        if (!nonceRes?.success || !nonceRes?.nonce) {
          throw new Error(nonceRes?.message || 'Failed to acquire pre-auth login integrity nonce.');
        }

        // Get native device integrity token
        const integrityToken = await MobileIntegrityService.requestDeviceIntegrityToken(nonceRes.nonce);
        if (!integrityToken) {
          throw new Error('Device integrity token could not be obtained.');
        }

        extraHeaders['x-integrity-token'] = integrityToken;
        extraHeaders['x-integrity-nonce'] = nonceRes.nonce;
      } catch (integrityErr: any) {
        console.error('[MOBILE-INTEGRITY] Pre-auth login attestation failed:', integrityErr?.message);
        throw new Error(`Device integrity attestation failed for login: ${integrityErr?.message || 'Unknown error'}`);
      }
    }

    return this.request('/auth/login', {
      method: 'POST',
      headers: extraHeaders,
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
    return this.request(`/bills?status=${encodeURIComponent(status)}`);
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
  static requestPasswordReset(mobile: string, attestation: PreAuthRecoveryAttestation) {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error('PreAuthRecoveryAttestation is required for password recovery request.');
    }
    const token = (attestation.integrityToken || '').trim();
    const nonce = (attestation.integrityNonce || '').trim();
    if (!token || !nonce) {
      throw new Error('A valid PreAuthRecoveryAttestation with integrityToken and integrityNonce is required.');
    }
    const salt = validateRecoverySalt(attestation.integrityRequestSalt);

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': token,
      'x-integrity-nonce': nonce,
      'x-integrity-request-salt': salt,
    };
    const body = {
      mobile,
      integrityRequestSalt: salt,
    };
    return this.request('/auth/password-reset/request', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(body),
    });
  }

  static verifyPasswordResetOtp(mobile: string, otpCode: string, attestation: PreAuthRecoveryAttestation) {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error('PreAuthRecoveryAttestation is required for password recovery verification.');
    }
    const token = (attestation.integrityToken || '').trim();
    const nonce = (attestation.integrityNonce || '').trim();
    if (!token || !nonce) {
      throw new Error('A valid PreAuthRecoveryAttestation with integrityToken and integrityNonce is required.');
    }
    const salt = validateRecoverySalt(attestation.integrityRequestSalt);

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': token,
      'x-integrity-nonce': nonce,
      'x-integrity-request-salt': salt,
    };
    const body = {
      mobile,
      otpCode,
      integrityRequestSalt: salt,
    };
    return this.request('/auth/password-reset/verify', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(body),
    });
  }

  static completePasswordReset(
    data: {
      mobile: string;
      verificationToken: string;
      newPassword: string;
    },
    attestation: PreAuthRecoveryAttestation
  ) {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error('PreAuthRecoveryAttestation is required for password reset completion.');
    }
    const token = (attestation.integrityToken || '').trim();
    const nonce = (attestation.integrityNonce || '').trim();
    if (!token || !nonce) {
      throw new Error('A valid PreAuthRecoveryAttestation with integrityToken and integrityNonce is required.');
    }
    const salt = validateRecoverySalt(attestation.integrityRequestSalt);

    const extraHeaders: Record<string, string> = {
      'x-integrity-token': token,
      'x-integrity-nonce': nonce,
      'x-integrity-request-salt': salt,
    };
    const body = {
      ...data,
      integrityRequestSalt: salt,
    };
    return this.request('/auth/password-reset/complete', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(body),
    });
  }

  // Admin Authentication Sequence (Prefix-Verification, Password-First, OTP-Challenge Flow)
  static verifyPrefix(prefix: string) {
    return this.request('/auth/admin/verify-prefix', {
      method: 'POST',
      body: JSON.stringify({ prefix }),
    });
  }

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

  /** @deprecated Legacy admin login is permanently disabled. Use verifyAdminOtp instead. */
  static loginAdmin(_identifier: string, _password: string, _verificationToken: string): Promise<any> {
    throw new Error('Legacy admin login endpoint is permanently disabled. Complete two-factor authentication via verifyAdminOtp.');
  }

  // Mobile Admin Endpoints
  static getAdminDashboard(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/dashboard?${params.toString()}`);
  }

  static getAdminBills(status = 'ALL', profession = 'ALL', search = '') {
    const params = new URLSearchParams({ status, profession });
    if (search && search.trim()) params.append('search', search.trim());
    return this.request(`/admin/bills?${params.toString()}`);
  }

  static getAdminBillDocumentUrl(id: string) {
    return this.request(`/admin/bills/${encodeURIComponent(id)}/document-url`);
  }

  static getAdminBillReviewConfig(id: string) {
    return this.request(`/admin/bills/${encodeURIComponent(id)}/review-config`);
  }

  static getAdminUsers(profession = 'ALL', status = 'ALL', search = '') {
    const params = new URLSearchParams({ profession, status });
    if (search && search.trim()) params.append('search', search.trim());
    return this.request(`/admin/users?${params.toString()}`);
  }

  static getAdminUserDetails(id: string) {
    return this.request(`/admin/users/${encodeURIComponent(id)}`);
  }

  static updateAdminUserName(id: string, data: { fullName: string; reason: string; firstName?: string; middleName?: string; lastName?: string }) {
    return this.request(`/admin/users/${encodeURIComponent(id)}/name`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  static getGstRules() {
    return this.request('/admin/settings/gst-rules');
  }

  static createAdminGstRule(data: { ratePercentage: number; description?: string; isDefault?: boolean }) {
    return this.request('/admin/settings/gst-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static updateAdminGstRule(id: string, data: { description?: string; isDefault?: boolean; isActive?: boolean }) {
    return this.request(`/admin/settings/gst-rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
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

    return this.request(`/admin/bills/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static getAdminPayouts(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/payouts?${params.toString()}`);
  }

  static handleAdminPayout(id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    return this.request(`/admin/payouts/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    });
  }

  static getAdminRewardRules(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/settings/reward-rules?${params.toString()}`);
  }

  static createAdminRewardRule(data: {
    profession: 'PLUMBER' | 'TILE_INSTALLER';
    rewardPercentage: number;
    effectiveFrom?: string;
    effectiveUntil?: string | null;
  }) {
    return this.request('/admin/settings/reward-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static updateAdminRewardRules(data: { percentage?: number; profession?: string }) {
    return this.request('/admin/settings/reward-rules', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  static getAdminRedemptionSettings(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/settings/redemption?${params.toString()}`);
  }

  static updateAdminRedemptionSettings(data: {
    profession?: string;
    isEnabled: boolean;
    startAt?: string | null;
    endAt?: string | null;
    message?: string;
    minimumRedemptionAmount?: number | null;
  }) {
    return this.request('/admin/settings/redemption', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  static getAdminAuditLogs() {
    return this.request('/admin/audit-logs');
  }

  static broadcastAdminNotification(data: {
    title: string;
    message: string;
    targetAudience?: 'ALL' | 'PLUMBER' | 'TILE_INSTALLER';
    idempotencyKey?: string;
  }) {
    const payload = {
      ...data,
      idempotencyKey:
        data.idempotencyKey ||
        `idem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    };
    return this.request('/admin/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static getAdminNotificationHistory(page = 1, limit = 20) {
    return this.request(`/admin/notifications/history?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
  }

  // ==========================================
  // In-App Notifications & Device Token API
  // ==========================================

  static getNotifications(page = 1, limit = 20) {
    return this.request(`/notifications?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
  }

  static getUnreadNotificationCount() {
    return this.request('/notifications/unread-count');
  }

  static markNotificationRead(id: string) {
    return this.request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
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

  static getPreAuthIntegrityNonce(options: { requestHash: string; action?: string }) {
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
  static triggerWelcomeNotification(
    installationId: string,
    token?: string,
    platform = Platform.OS.toUpperCase()
  ) {
    return this.request('/notifications/welcome', {
      method: 'POST',
      body: JSON.stringify({ installationId, token, platform }),
    });
  }
}
