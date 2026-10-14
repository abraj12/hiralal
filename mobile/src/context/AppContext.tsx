import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { THEMES, ThemeConfig, ProfessionType } from '../theme/professionTheme';
import { MobileApiClient } from '../services/api';
import { NotificationsService } from '../services/notifications.service';

const INSTALLATION_KEY = 'hiralal_installation_id';
const WELCOME_DISPATCHED_KEY = 'hiralal_welcome_dispatched';

export async function getOrCreateInstallationId(): Promise<string> {
  try {
    let id: string | null = null;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        id = window.localStorage.getItem(INSTALLATION_KEY);
      }
    } else {
      id = await SecureStore.getItemAsync(INSTALLATION_KEY);
    }

    if (!id || id.length < 8) {
      id = `inst-${Date.now()}-${Math.random().toString(36).substring(2, 12)}-${Math.random().toString(36).substring(2, 12)}`;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(INSTALLATION_KEY, id);
        }
      } else {
        await SecureStore.setItemAsync(INSTALLATION_KEY, id);
      }
    }
    return id;
  } catch {
    return `inst-fallback-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }
}

export async function dispatchWelcomeNotificationOnce(): Promise<void> {
  try {
    let alreadyDispatched = false;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        alreadyDispatched = window.localStorage.getItem(WELCOME_DISPATCHED_KEY) === 'true';
      }
    } else {
      const val = await SecureStore.getItemAsync(WELCOME_DISPATCHED_KEY);
      alreadyDispatched = val === 'true';
    }

    if (alreadyDispatched) {
      return;
    }

    const instId = await getOrCreateInstallationId();
    let nativeToken: string | undefined = undefined;
    let nativePlatform = 'ANDROID';
    try {
      const tokenResult = await NotificationsService.getNativePushToken();
      if (tokenResult.token) {
        nativeToken = tokenResult.token;
        nativePlatform = tokenResult.platform?.toUpperCase() || 'ANDROID';
      }
    } catch {}

    const res: any = await MobileApiClient.triggerWelcomeNotification(instId, nativeToken, nativePlatform);

    // Only mark as permanently dispatched when the server confirms actual provider acceptance ('ACCEPTED' or 'ALREADY_ACCEPTED')
    // 'RECORDED_PENDING_PUSH', 'FAILED_RETRYABLE', 'NOT_SENT' are NOT treated as permanently completed so future launches can retry.
    const permanentStatuses = ['ACCEPTED', 'ALREADY_ACCEPTED', 'DELIVERED'];
    if (res && res.success && permanentStatuses.includes(res.status)) {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(WELCOME_DISPATCHED_KEY, 'true');
        }
      } else {
        await SecureStore.setItemAsync(WELCOME_DISPATCHED_KEY, 'true');
      }
    }
  } catch {
    // Non-blocking
  }
}

interface AppContextType {
  user: any;
  profession: ProfessionType;
  theme: ThemeConfig;
  wallet: {
    availableBalance: number;
    processingAmount: number;
    totalRedeemed: number;
    lifetimeCashback?: number;
  };
  transactions: any[];
  bills: any[];
  activeTab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE';
  currentScreen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL' | 'NOTIFICATIONS';
  isLoading: boolean;
  unreadNotificationCount: number;
  setActiveTab: (tab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE') => void;
  setCurrentScreen: (screen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL' | 'NOTIFICATIONS') => void;
  setProfession: (profession: ProfessionType) => void;
  login: (mobile: string, pass: string) => Promise<any>;
  loginAdmin: (identifier: string, pass: string, verificationToken: string) => Promise<void>;
  loginAdminSession: (user: any, token: string) => Promise<void>;
  logout: () => void;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [profession, setProfessionState] = useState<ProfessionType>('PLUMBER');
  const [activeTab, setActiveTab] = useState<'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE'>('HOME');
  const [currentScreen, setCurrentScreen] = useState<'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL' | 'NOTIFICATIONS'>('WELCOME');
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const [wallet, setWallet] = useState({
    availableBalance: 0,
    processingAmount: 0,
    totalRedeemed: 0,
    lifetimeCashback: 0,
  });

  const [transactions, setTransactions] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);

  const refreshData = async () => {
    try {
      const [walletRes, billsRes, profileRes, notifRes] = await Promise.all([
        MobileApiClient.getWallet().catch(() => null),
        MobileApiClient.getBills().catch(() => null),
        MobileApiClient.getProfile().catch(() => null),
        MobileApiClient.getUnreadNotificationCount().catch(() => null),
      ]);

      if (notifRes && typeof notifRes.unreadCount === 'number') {
        setUnreadNotificationCount(notifRes.unreadCount);
      }
      if (walletRes && walletRes.wallet) {
        setWallet(walletRes.wallet);
        if (walletRes.transactions) {
          setTransactions(walletRes.transactions);
        }
      }
      if (billsRes && billsRes.bills) {
        setBills(billsRes.bills);
      }
      if (profileRes && profileRes.user) {
        setUser(profileRes.user);
        if (profileRes.user.profession && (profileRes.user.profession === 'PLUMBER' || profileRes.user.profession === 'TILE_INSTALLER')) {
          setProfessionState(profileRes.user.profession as ProfessionType);
        }
      }
    } catch (e) {
      console.warn('Backend sync failed:', e);
    }
  };

  // Initial authentication check on application boot
  useEffect(() => {
    let mounted = true;

    async function checkExistingSession() {
      try {
        const token = await MobileApiClient.initToken();
        const storedUser = await MobileApiClient.getStoredUser();

        if (token && storedUser && (storedUser.role === 'BILL_ADMIN' || storedUser.role === 'OPERATIONS_ADMIN')) {
          if (mounted) {
            setUser(storedUser);
            setCurrentScreen('MAIN');
          }
          return;
        }

        if (token) {
          const profileRes = await MobileApiClient.getProfile();
          if (profileRes && profileRes.user && mounted) {
            setUser(profileRes.user);
            await MobileApiClient.setStoredUser(profileRes.user);
            if (profileRes.user.profession && (profileRes.user.profession === 'PLUMBER' || profileRes.user.profession === 'TILE_INSTALLER')) {
              setProfessionState(profileRes.user.profession as ProfessionType);
            }
            // Load wallet and bills
            const [walletRes, billsRes] = await Promise.all([
              MobileApiClient.getWallet().catch(() => null),
              MobileApiClient.getBills().catch(() => null),
            ]);
            if (walletRes && walletRes.wallet && mounted) {
              setWallet(walletRes.wallet);
              if (walletRes.transactions) setTransactions(walletRes.transactions);
            }
            if (billsRes && billsRes.bills && mounted) {
              setBills(billsRes.bills);
            }
            setCurrentScreen('MAIN');
            NotificationsService.registerDeviceToken().catch(() => {});
            dispatchWelcomeNotificationOnce().catch(() => {});
          } else {
            // Server responded but user profile was not returned
            await MobileApiClient.clearAllTokens();
            if (mounted) setCurrentScreen('WELCOME');
          }
        } else {
          if (mounted) setCurrentScreen('WELCOME');
        }
      } catch (e: any) {
        // Only clear tokens if the server specifically rejects the session with 401 Unauthorized
        if (e?.message?.includes('401') || e?.message?.includes('Unauthorized') || e?.message?.includes('invalid')) {
          await MobileApiClient.clearAllTokens();
        } else {
          console.warn('Network or server unreachable during startup session check:', e?.message);
        }
        if (mounted) setCurrentScreen('WELCOME');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    checkExistingSession();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (mobile: string, pass: string): Promise<any> => {
    // Authenticate with real server-side endpoint. NO mock/offline fallback.
    const res = await MobileApiClient.login(mobile, pass);
    if (res?.requiresOtp) {
      return res;
    }
    await MobileApiClient.setToken(res.token);
    if (res.refreshToken) {
      await MobileApiClient.setRefreshToken(res.refreshToken);
    }
    setUser(res.user);

    if (res.user.profession && (res.user.profession === 'PLUMBER' || res.user.profession === 'TILE_INSTALLER')) {
      setProfessionState(res.user.profession as ProfessionType);
    }
    if (res.wallet) {
      setWallet(res.wallet);
    }

    setCurrentScreen('MAIN');
    setActiveTab('HOME');
    NotificationsService.registerDeviceToken().catch(() => {});
    dispatchWelcomeNotificationOnce().catch(() => {});
    refreshData().catch(e => console.warn('Background sync failed:', e));
    return res;
  };

  /** @deprecated Legacy admin login is permanently disabled. Use loginAdminSession instead. */
  const loginAdmin = async (_identifier: string, _pass: string, _verificationToken: string) => {
    throw new Error('Legacy admin login is permanently disabled. Use loginAdminSession with verified OTP.');
  };

  const loginAdminSession = async (adminUser: any, token: string) => {
    await MobileApiClient.setToken(token);
    await MobileApiClient.setStoredUser(adminUser);
    setUser(adminUser);
    NotificationsService.registerDeviceToken().catch(() => {});
    setCurrentScreen('MAIN');
  };

  const logout = async () => {
    await NotificationsService.deactivateDeviceToken().catch(() => {});
    await MobileApiClient.logout();
    setUser(null);
    setWallet({ availableBalance: 0, processingAmount: 0, totalRedeemed: 0, lifetimeCashback: 0 });
    setTransactions([]);
    setBills([]);
    setCurrentScreen('WELCOME');
    setActiveTab('HOME');
  };

  const theme = THEMES[profession] || THEMES.PLUMBER;

  return (
    <AppContext.Provider
      value={{
        user,
        profession,
        theme,
        wallet,
        transactions,
        bills,
        activeTab,
        currentScreen,
        isLoading,
        unreadNotificationCount,
        setActiveTab,
        setCurrentScreen,
        setProfession: setProfessionState,
        login,
        loginAdmin,
        loginAdminSession,
        logout,
        refreshData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
