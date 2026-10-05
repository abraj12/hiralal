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
  bills: any[];
  activeTab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE';
  currentScreen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL';
  setActiveTab: (tab: 'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE') => void;
  setCurrentScreen: (screen: 'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL') => void;
  setProfession: (profession: ProfessionType) => void;
  switchProfessionLive: (newProf: ProfessionType) => Promise<void>;
  login: (mobile: string, pass: string) => Promise<void>;
  logout: () => void;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Pre-seed with Raj Kumar (Plumber) for instant rich presentation
  const [user, setUser] = useState<any>({
    id: 'user-plumber-raj',
    fullName: 'Raj Kumar',
    mobile: '9876543210',
    profession: 'PLUMBER',
  });

  const [profession, setProfessionState] = useState<ProfessionType>('PLUMBER');
  const [activeTab, setActiveTab] = useState<'HOME' | 'BILLS' | 'REWARDS' | 'WALLET' | 'PROFILE'>('HOME');
  const [currentScreen, setCurrentScreen] = useState<'WELCOME' | 'LOGIN' | 'REGISTER' | 'MAIN' | 'UPLOAD_BILL'>('MAIN');

  const [wallet, setWallet] = useState({
    availableBalance: 1600.0,
    processingAmount: 850.0,
    totalRedeemed: 2000.0,
  });

  const [bills, setBills] = useState<any[]>([
    {
      id: 'bill-1024',
      invoiceNumber: 'INV-2026-001',
      invoiceDate: '2026-10-02',
      billAmount: 12500,
      calculatedReward: 250,
      status: 'APPROVED',
      remarks: 'PVC Pipes & fittings',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'bill-1023',
      invoiceNumber: 'INV-2026-002',
      invoiceDate: '2026-09-30',
      billAmount: 8000,
      calculatedReward: 400,
      status: 'UNDER_REVIEW',
      remarks: 'Brass taps and valves',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'bill-1022',
      invoiceNumber: 'INV-2026-003',
      invoiceDate: '2026-09-28',
      billAmount: 5200,
      calculatedReward: 125,
      status: 'APPROVED',
      remarks: 'Elbows & Tees',
      createdAt: new Date().toISOString(),
    },
  ]);

  const refreshData = async () => {
    try {
      const [walletRes, billsRes, profileRes] = await Promise.all([
        MobileApiClient.getWallet().catch(() => null),
        MobileApiClient.getBills().catch(() => null),
        MobileApiClient.getProfile().catch(() => null),
      ]);

      if (walletRes && walletRes.wallet) {
        setWallet(walletRes.wallet);
      }
      if (billsRes && billsRes.bills) {
        setBills(billsRes.bills);
      }
      if (profileRes && profileRes.user) {
        setUser(profileRes.user);
        if (profileRes.user.profession && THEMES[profileRes.user.profession as ProfessionType]) {
          setProfessionState(profileRes.user.profession as ProfessionType);
        }
      }
    } catch (e) {
      console.warn('Backend sync failed, maintaining local state');
    }
  };

  const switchProfessionLive = async (newProf: ProfessionType) => {
    setProfessionState(newProf);
    if (newProf === 'TILE_INSTALLER') {
      setUser((prev: any) => ({
        ...prev,
        fullName: prev?.fullName === 'Raj Kumar' ? 'Amit Kumar' : prev?.fullName,
        profession: 'TILE_INSTALLER',
      }));
      setWallet({
        availableBalance: 2170.0,
        processingAmount: 950.0,
        totalRedeemed: 3500.0,
      });
    } else if (newProf === 'PLUMBER') {
      setUser((prev: any) => ({
        ...prev,
        fullName: prev?.fullName === 'Amit Kumar' ? 'Raj Kumar' : prev?.fullName,
        profession: 'PLUMBER',
      }));
      setWallet({
        availableBalance: 1600.0,
        processingAmount: 850.0,
        totalRedeemed: 2000.0,
      });
    }

    try {
      if (MobileApiClient.getToken()) {
        await MobileApiClient.updateProfile({ profession: newProf });
      }
    } catch (e) {
      // Ignore if offline
    }
  };

  const login = async (mobile: string, pass: string) => {
    try {
      const res = await MobileApiClient.login(mobile, pass);
      MobileApiClient.setToken(res.token);
      setUser(res.user);
      if (res.user.profession && THEMES[res.user.profession as ProfessionType]) {
        setProfessionState(res.user.profession as ProfessionType);
      }
      if (res.wallet) {
        setWallet(res.wallet);
      }
      setCurrentScreen('MAIN');
      setActiveTab('HOME');
      refreshData();
    } catch (err: any) {
      // Fallback local demo login
      if (mobile.endsWith('11')) {
        setUser({ fullName: 'Amit Kumar', mobile, profession: 'TILE_INSTALLER' });
        setProfessionState('TILE_INSTALLER');
        setWallet({ availableBalance: 2170.0, processingAmount: 950.0, totalRedeemed: 3500.0 });
      } else {
        setUser({ fullName: 'Raj Kumar', mobile, profession: 'PLUMBER' });
        setProfessionState('PLUMBER');
        setWallet({ availableBalance: 1600.0, processingAmount: 850.0, totalRedeemed: 2000.0 });
      }
      setCurrentScreen('MAIN');
      setActiveTab('HOME');
    }
  };

  const logout = () => {
    MobileApiClient.setToken(null);
    setUser(null);
    setCurrentScreen('WELCOME');
  };

  const theme = THEMES[profession] || THEMES.PLUMBER;

  return (
    <AppContext.Provider
      value={{
        user,
        profession,
        theme,
        wallet,
        bills,
        activeTab,
        currentScreen,
        setActiveTab,
        setCurrentScreen,
        setProfession: setProfessionState,
        switchProfessionLive,
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
