import Constants from 'expo-constants';
import { Platform, NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { validateProductionApiUrl } from './apiUrl';
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

export const ALLOWED_DOC_HOST_PATTERNS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^(?:[a-zA-Z0-9-]+\.)*s3\.amazonaws\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*r2\.cloudflarestorage\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*r2\.dev$/,
  /^(?:[a-zA-Z0-9-]+\.)*cloudfront\.net$/,
  /^(?:[a-zA-Z0-9-]+\.)*hsspl\.algions\.in$/,
  /^(?:[a-zA-Z0-9-]+\.)*hiralalandsons\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*hiralalandsonspvtltd\.com$/,
];

export function isAllowedDocumentUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  const clean = url.trim();
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      return false;
    }
    return ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export function resolveDocumentUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  const clean = url.trim();
  if (clean.startsWith('https://')) {
    try {
      const parsed = new URL(clean);
      const isAllowed = ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
      return isAllowed ? clean : null;
    } catch {
      return null;
    }
  }
  if (clean.startsWith('http://')) {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    try {
      const parsed = new URL(clean);
      const isAllowed = ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
      return isAllowed ? clean : null;
    } catch {
      return null;
    }
  }

  // Reject unsupported protocols like javascript:, file:, data:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) {
    return null;
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

  // Admin Authentication Sequence (Prefix-Verification, Password-First, OTP-Challenge Flow)
  static verifyPrefix(prefix: string) {
    return this.request('/auth/admin/verify-prefix', {
      method: 'POST',
      body: JSON.stringify({ prefix }),
    });
  }

  static requestAdminOtp(identifier: string, password?: string, tier1Token?: string) {
    const headers: Record<string, string> = {};
    if (tier1Token) {
      headers['X-Tier1-Token'] = tier1Token;
    }
    return this.request('/auth/admin/otp/request', {
      method: 'POST',
      headers,
      body: JSON.stringify({ identifier, password, tier1Token }),
    });
  }

  static loginAdminPortal(identifier: string, password: string, tier1Token?: string) {
    const headers: Record<string, string> = {};
    if (tier1Token) {
      headers['X-Tier1-Token'] = tier1Token;
    }
    return this.request('/auth/admin-portal/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ identifier, password, tier1Token }),
    });
  }

  // HIR-M-12: authenticated password change; the server revokes all sessions afterwards
  static changePassword(currentPassword: string, newPassword: string) {
    return this.request('/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
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

  static verifyMononymousKyc(id: string, reason: string) {
    return this.request(`/admin/users/${encodeURIComponent(id)}/verify-mononymous-kyc`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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
      | 'CANCEL'
      | {
          action: 'APPROVE' | 'REJECT' | 'CANCEL';
          rejectionReason?: string;
          cancellationReason?: string;
          reason?: string;
          gstIncluded?: boolean;
          gstRate?: number;
          gstRuleId?: string;
          gstOverrideReason?: string;
        },
    legacyRejectionReason?: string
  ) {
    const payload =
      typeof actionOrOptions === 'string'
        ? { action: actionOrOptions, rejectionReason: legacyRejectionReason, cancellationReason: legacyRejectionReason }
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
    maximumRedemptionAmount?: number | null;
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
}
