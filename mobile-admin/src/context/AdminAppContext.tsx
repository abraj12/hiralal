import React, { createContext, useContext, useState, useEffect } from 'react';
import { MobileApiClient } from '../services/api';
import { NotificationsService } from '../services/notifications.service';

export type AdminRole = 'BILL_ADMIN' | 'OPERATIONS_ADMIN';

export interface AdminUser {
  id: string;
  fullName: string;
  mobile: string;
  role: AdminRole;
  isVerified: boolean;
  status: string;
}

interface AdminAppContextType {
  user: AdminUser | null;
  role: AdminRole | null;
  currentScreen: 'LOGIN' | 'MAIN';
  isLoading: boolean;
  loginAdmin: (identifier: string, pass: string, tier1Token?: string) => Promise<any>;
  verifyAdminOtp: (identifier: string, otp: string, challengeToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  setCurrentScreen: (screen: 'LOGIN' | 'MAIN') => void;
}

const AdminAppContext = createContext<AdminAppContextType | undefined>(undefined);

export const AdminAppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'LOGIN' | 'MAIN'>('LOGIN');
  const [isLoading, setIsLoading] = useState(true);

  const role = user?.role || null;

  useEffect(() => {
    let mounted = true;

    async function checkExistingAdminSession() {
      try {
        const token = await MobileApiClient.initToken();
        if (token) {
          const profileRes = await MobileApiClient.getProfile();
          if (profileRes && profileRes.user && mounted) {
            const userRole = profileRes.user.role;
            // Strict role gating: Only BILL_ADMIN or OPERATIONS_ADMIN permitted
            if (userRole === 'BILL_ADMIN' || userRole === 'OPERATIONS_ADMIN') {
              setUser(profileRes.user as AdminUser);
              setCurrentScreen('MAIN');
              NotificationsService.registerDeviceToken().catch(() => {});
            } else {
              // Reject non-admin role immediately (fail-closed)
              console.warn('[SECURITY] Non-administrator session rejected from Admin mobile portal.');
              await MobileApiClient.clearAllTokens();
              setCurrentScreen('LOGIN');
            }
          } else {
            await MobileApiClient.clearAllTokens();
            if (mounted) setCurrentScreen('LOGIN');
          }
        } else {
          if (mounted) setCurrentScreen('LOGIN');
        }
      } catch (err: any) {
        console.warn('Session restoration failed:', err?.message);
        await MobileApiClient.clearAllTokens();
        if (mounted) setCurrentScreen('LOGIN');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    checkExistingAdminSession();
    return () => {
      mounted = false;
    };
  }, []);

  const loginAdmin = async (identifier: string, pass: string, tier1Token?: string) => {
    const res = await MobileApiClient.loginAdminPortal(identifier, pass, tier1Token);
    return res;
  };

  const verifyAdminOtp = async (identifier: string, otp: string, challengeToken?: string) => {
    const res = await MobileApiClient.verifyAdminOtp(identifier, otp, challengeToken);
    if (!res.user) {
      throw new Error('Failed to verify administrator authentication challenge.');
    }

    const assignedRole = res.user.role;
    if (assignedRole !== 'BILL_ADMIN' && assignedRole !== 'OPERATIONS_ADMIN') {
      await MobileApiClient.clearAllTokens();
      throw new Error('Access denied. This application is restricted to authorized Hiralal administrators only.');
    }

    await MobileApiClient.setToken(res.token || '');
    if (res.refreshToken) {
      await MobileApiClient.setRefreshToken(res.refreshToken);
    }
    await MobileApiClient.setStoredUser(res.user);

    setUser(res.user as AdminUser);
    setCurrentScreen('MAIN');
    NotificationsService.registerDeviceToken().catch(() => {});
  };

  const logout = async () => {
    await NotificationsService.deactivateDeviceToken().catch(() => {});
    await MobileApiClient.logout();
    setUser(null);
    setCurrentScreen('LOGIN');
  };

  return (
    <AdminAppContext.Provider
      value={{
        user,
        role,
        currentScreen,
        isLoading,
        loginAdmin,
        verifyAdminOtp,
        logout,
        setCurrentScreen,
      }}
    >
      {children}
    </AdminAppContext.Provider>
  );
};

export const useAdminApp = () => {
  const context = useContext(AdminAppContext);
  if (!context) throw new Error('useAdminApp must be used within an AdminAppProvider');
  return context;
};
