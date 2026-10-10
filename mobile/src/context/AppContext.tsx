import React, { createContext, useContext, useState, useEffect } from 'react';
import { THEMES, ThemeConfig, ProfessionType } from '../theme/professionTheme';
import { MobileApiClient } from '../services/api';

interface AppContextType {
  user: any;
  profession: ProfessionType;
  theme: ThemeConfig;
  wallet: {
    availableBalance: number;
    processingAmount: number;
    totalRedeemed: number;
  };
  transactions: any[];
  bills: any[];
  activeTab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE';
  currentScreen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL';
  isLoading: boolean;
  setActiveTab: (tab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE') => void;
  setCurrentScreen: (screen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL') => void;
  setProfession: (profession: ProfessionType) => void;
  login: (mobile: string, pass: string) => Promise<void>;
  logout: () => void;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [profession, setProfessionState] = useState<ProfessionType>('PLUMBER');
  const [activeTab, setActiveTab] = useState<'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE'>('HOME');
  const [currentScreen, setCurrentScreen] = useState<'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL'>('WELCOME');
  const [isLoading, setIsLoading] = useState(true);

  const [wallet, setWallet] = useState({
    availableBalance: 0,
    processingAmount: 0,
    totalRedeemed: 0,
  });

  const [transactions, setTransactions] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);

  const refreshData = async () => {
    try {
      const [walletRes, billsRes, profileRes] = await Promise.all([
        MobileApiClient.getWallet().catch(() => null),
        MobileApiClient.getBills().catch(() => null),
        MobileApiClient.getProfile().catch(() => null),
      ]);

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
        if (token) {
          const profileRes = await MobileApiClient.getProfile();
          if (profileRes && profileRes.user && mounted) {
            setUser(profileRes.user);
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

  const login = async (mobile: string, pass: string) => {
    // Authenticate with real server-side endpoint. NO mock/offline fallback.
    const res = await MobileApiClient.login(mobile, pass);
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
    refreshData().catch(e => console.warn('Background sync failed:', e));
  };

  const logout = async () => {
    await MobileApiClient.logout();
    setUser(null);
    setWallet({ availableBalance: 0, processingAmount: 0, totalRedeemed: 0 });
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
        setActiveTab,
        setCurrentScreen,
        setProfession: setProfessionState,
        login,
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
