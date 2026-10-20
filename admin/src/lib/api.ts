import { getAdminApiBase } from './apiConfig';
export { getAdminApiBase };

const API_BASE = getAdminApiBase();

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export class AdminApiClient {
  // Sensitive admin tokens are stored exclusively in HttpOnly cookies to prevent XSS exfiltration.
  private static getToken(): string | null {
    return null;
  }

  static setToken(_token: string) {
    // No-op: Authentication token is stored in HttpOnly cookie set by server
  }

  static clearToken() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('hiralal_admin_token'); // Cleanup legacy token if present
      localStorage.removeItem('hiralal_admin_user');
    }
  }

  static setUser(user: any) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hiralal_admin_user', JSON.stringify(user));
    }
  }

  static getUser(): any | null {
    if (typeof window !== 'undefined') {
      const data = localStorage.getItem('hiralal_admin_user');
      if (data) {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const method = (options.method || 'GET').toUpperCase();
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const isAuthBootstrap = endpoint.includes('/auth/login') ||
      endpoint.includes('/auth/admin-login') ||
      endpoint.includes('/auth/admin/otp') ||
      endpoint.includes('/auth/otp') ||
      endpoint.includes('/auth/send-otp') ||
      endpoint.includes('/auth/verify-otp') ||
      endpoint.includes('/auth/password-reset');

    const csrfToken = getCsrfToken();
    if (csrfToken && isMutating) {
      headers['X-CSRF-Token'] = csrfToken;
    } else if (isMutating && !isAuthBootstrap && typeof window !== 'undefined') {
      const user = this.getUser();
      if (user) {
        throw new Error('Anti-CSRF session token is missing. Please refresh your session or log in again.');
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000); // 15-second timeout

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include', // Always send HttpOnly authentication and CSRF cookies
        signal: controller.signal,
      });
      clearTimeout(timer);

      let data: any = {};
      try {
        data = await res.json();
      } catch (e) {
        data = { message: res.statusText || 'Unexpected server response' };
      }

      if (!res.ok) {
        const isCsrfMismatch = res.status === 403 && data.code === 'CSRF_TOKEN_MISMATCH';
        if ((res.status === 401 || isCsrfMismatch) && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          this.clearToken();
          window.location.href = '/login';
        }
        throw new Error(data.message || `API request failed (${res.status})`);
      }

      return data;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please check server connectivity.');
      }
      throw err;
    }
  }

  // Document URL Retrieval with Fresh Signed Access
  static getBillDocumentUrl(id: string) {
    return this.request(`/admin/bills/${encodeURIComponent(id)}/document-url`);
  }

  // Bill Review Configuration (Read-only, Bill Admin Authorized)
  static getBillReviewConfig(id: string) {
    return this.request(`/admin/bills/${encodeURIComponent(id)}/review-config`);
  }

  // Dashboard Overview with Profession Filtering
  static getDashboard(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/dashboard?${params.toString()}`);
  }

  // User Management
  static getUsers(profession = 'ALL', status = 'ALL', search = '') {
    const params = new URLSearchParams({ profession, status, search });
    return this.request(`/admin/users?${params.toString()}`);
  }

  static getUserDetails(id: string) {
    return this.request(`/admin/users/${encodeURIComponent(id)}`);
  }

  static updateUserName(id: string, data: { fullName: string; reason: string; firstName?: string; middleName?: string; lastName?: string }) {
    return this.request(`/admin/users/${encodeURIComponent(id)}/name`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Bills Management & Verification
  static getBills(status = 'ALL', profession = 'ALL', search = '') {
    const params = new URLSearchParams({ status, profession });
    if (search) params.append('search', search);
    return this.request(`/admin/bills?${params.toString()}`);
  }

  static verifyBill(
    id: string,
    actionOrOptions: 'APPROVE' | 'REJECT' | {
      action: 'APPROVE' | 'REJECT';
      rejectionReason?: string;
      gstIncluded?: boolean;
      gstRate?: number;
      gstRuleId?: string;
      gstOverrideReason?: string;
      correctedGrossAmount?: number;
    },
    legacyRejectionReason?: string
  ) {
    const payload = typeof actionOrOptions === 'string'
      ? { action: actionOrOptions, rejectionReason: legacyRejectionReason }
      : actionOrOptions;

    return this.request(`/admin/bills/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Payout Management
  static getPayouts(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/payouts?${params.toString()}`);
  }

  static handlePayoutAction(
    id: string,
    action: 'APPROVE' | 'REJECT',
    reason?: string
  ) {
    return this.request(`/admin/payouts/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    });
  }

  // Reward Rules (Profession-Specific & Versioned)
  static getRewardRules(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/settings/reward-rules?${params.toString()}`);
  }

  static createRewardRule(data: {
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

  static updateRewardRules(data: {
    percentage?: number;
    profession?: string;
  }) {
    return this.request('/admin/settings/reward-rules', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Tax / GST Rules
  static getGstRules() {
    return this.request('/admin/settings/gst-rules');
  }

  static createGstRule(data: {
    ratePercentage: number;
    description?: string;
    isDefault?: boolean;
  }) {
    return this.request('/admin/settings/gst-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static updateGstRule(
    id: string,
    data: {
      description?: string;
      isDefault?: boolean;
      isActive?: boolean;
    }
  ) {
    return this.request(`/admin/settings/gst-rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // Redemption Settings
  static getRedemptionSettings(profession = 'ALL') {
    const params = new URLSearchParams({ profession });
    return this.request(`/admin/settings/redemption?${params.toString()}`);
  }

  static updateRedemptionSettings(data: {
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

  // Audit Logs
  static getAuditLogs() {
    return this.request('/admin/audit-logs');
  }

  // Notifications Management
  static broadcastNotification(data: {
    title: string;
    message: string;
    targetAudience?: 'ALL' | 'PLUMBER' | 'TILE_INSTALLER';
    idempotencyKey?: string;
  }) {
    return this.request('/admin/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static sendDirectNotification(userId: string, data: { title: string; message: string }) {
    return this.request(`/admin/notifications/users/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static getNotificationHistory(page = 1, limit = 20) {
    return this.request(`/admin/notifications/history?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
  }

  // Admin Password-First OTP-Second Authentication Flow
  static login(identifier: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
  }

  static verifyOtp(identifier: string, otpCode: string, challengeToken: string) {
    return this.request('/auth/admin/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ identifier, otpCode, challengeToken }),
    });
  }

  static async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors during logout
    } finally {
      this.clearToken();
    }
  }
}
