const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export class AdminApiClient {
  private static getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hiralal_admin_token');
    }
    return null;
  }

  static setToken(token: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hiralal_admin_token', token);
    }
  }

  static clearToken() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('hiralal_admin_token');
    }
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        this.clearToken();
        window.location.href = '/login';
      }
      throw new Error(data.message || 'API request failed');
    }

    return data;
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
    return this.request(`/admin/users/${id}`);
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
      customRewardAmount?: number;
    },
    legacyRejectionReason?: string
  ) {
    const payload = typeof actionOrOptions === 'string'
      ? { action: actionOrOptions, rejectionReason: legacyRejectionReason }
      : actionOrOptions;

    return this.request(`/admin/bills/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Payout Management
  static getPayouts(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/payouts?${params.toString()}`);
  }

  static handlePayoutAction(id: string, action: 'COMPLETE' | 'FAIL', reason?: string) {
    return this.request(`/admin/payouts/${id}/action`, {
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
    monthlyPoolLimit: number;
    minRedemptionAmount?: number;
    maxRedemptionAmount?: number;
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
    monthlyPoolLimit?: number;
    minRedemptionAmount?: number;
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
    minimumAmount?: number;
    maximumAmount?: number;
    message?: string;
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

  // Login
  static login(username: string, password: string) {
    return this.request('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }
}
