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

  // Dashboard Overview
  static getDashboard() {
    return this.request('/admin/dashboard');
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
  static getBills(status = 'ALL', profession = 'ALL') {
    const params = new URLSearchParams({ status, profession });
    return this.request(`/admin/bills?${params.toString()}`);
  }

  static verifyBill(id: string, action: 'APPROVE' | 'REJECT', rejectionReason?: string) {
    return this.request(`/admin/bills/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ action, rejectionReason }),
    });
  }

  // Payout Management
  static getPayouts(status = 'ALL') {
    return this.request(`/admin/payouts?status=${status}`);
  }

  static handlePayoutAction(id: string, action: 'COMPLETE' | 'FAIL', reason?: string) {
    return this.request(`/admin/payouts/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    });
  }

  // Reward Rules & Pool
  static getRewardRules() {
    return this.request('/admin/settings/reward-rules');
  }

  static updateRewardRules(data: { percentage?: number; monthlyPoolLimit?: number; minRedemptionAmount?: number }) {
    return this.request('/admin/settings/reward-rules', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Redemption Settings (Arbitrary Admin-Controlled Windows)
  static getRedemptionSettings() {
    return this.request('/admin/settings/redemption');
  }

  static updateRedemptionSettings(data: {
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
