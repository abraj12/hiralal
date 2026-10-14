import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar, Platform, Text, TouchableOpacity } from 'react-native';
import { AppProvider, useApp } from './src/context/AppContext';
import BottomNav from './src/components/BottomNav';
import AdminHeader from './src/components/AdminHeader';
import AdminBottomNav from './src/components/AdminBottomNav';
import AnimatedSplashScreen from './src/components/AnimatedSplashScreen';
import HomeScreen from './src/screens/HomeScreen';
import BillsScreen from './src/screens/BillsScreen';
import RewardsScreen from './src/screens/RewardsScreen';
import WalletScreen from './src/screens/WalletScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import UploadBillScreen from './src/screens/UploadBillScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import BillReviewScreen from './src/screens/BillReviewScreen';
import NotificationScreen from './src/screens/NotificationScreen';

// Admin Mobile Screens
import BillAdminDashboardScreen from './src/screens/admin/BillAdminDashboardScreen';
import OpsAdminDashboardScreen from './src/screens/admin/OpsAdminDashboardScreen';
import OpsAdminUsersScreen from './src/screens/admin/OpsAdminUsersScreen';
import OpsAdminPayoutsScreen from './src/screens/admin/OpsAdminPayoutsScreen';
import OpsAdminMoreScreen from './src/screens/admin/OpsAdminMoreScreen';

const OperationsDashboardScreen = OpsAdminDashboardScreen;

function MainAppNavigator() {
  const { currentScreen, activeTab, user, logout } = useApp();

  // Admin Tab State
  const [billAdminTab, setBillAdminTab] = useState<'DASHBOARD' | 'BILLS'>('DASHBOARD');
  const [opsAdminTab, setOpsAdminTab] = useState<'DASHBOARD' | 'BILLS' | 'USERS' | 'PAYOUTS' | 'MORE'>('DASHBOARD');
  const [opsAdminMoreSubtab, setOpsAdminMoreSubtab] = useState<'REWARDS' | 'BROADCAST' | 'AUDIT' | 'SETTINGS'>('REWARDS');
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);

  const isBillAdmin = user?.role === 'BILL_ADMIN';
  const isOpsAdmin = user?.role === 'OPERATIONS_ADMIN';
  const isAdmin = isBillAdmin || isOpsAdmin;

  const handleAdminRefresh = () => {
    setAdminRefreshKey(k => k + 1);
  };

  const renderActiveScreen = () => {
    if (currentScreen === 'WELCOME') return <WelcomeScreen />;
    if (currentScreen === 'LOGIN') return <LoginScreen />;
    if (currentScreen === 'REGISTER') return <RegisterScreen />;
    if (currentScreen === 'UPLOAD_BILL') return <UploadBillScreen />;
    if (currentScreen === 'NOTIFICATIONS') return <NotificationScreen />;

    // 1. BILL_ADMIN Mobile Portal
    if (user?.role === 'BILL_ADMIN') {
      switch (billAdminTab) {
        case 'DASHBOARD':
          return (
            <BillAdminDashboardScreen
              key={`bill-dash-${adminRefreshKey}`}
              onNavigateToBills={() => setBillAdminTab('BILLS')}
            />
          );
        case 'BILLS':
          return <BillReviewScreen key={`bill-review-${adminRefreshKey}`} showStandaloneHeader={false} />;
        default:
          return <BillReviewScreen />;
      }
    }

    // 2. OPERATIONS_ADMIN Mobile Portal
    if (user?.role === 'OPERATIONS_ADMIN') {
      switch (opsAdminTab) {
        case 'DASHBOARD':
          return (
            <OperationsDashboardScreen
              key={`ops-dash-${adminRefreshKey}`}
              onNavigateTab={tab => setOpsAdminTab(tab as any)}
              onNavigateMoreSubtab={st => {
                setOpsAdminMoreSubtab(st as any);
                setOpsAdminTab('MORE');
              }}
            />
          );
        case 'BILLS':
          return <BillReviewScreen key={`ops-bills-${adminRefreshKey}`} showStandaloneHeader={false} />;
        case 'USERS':
          return <OpsAdminUsersScreen key={`ops-users-${adminRefreshKey}`} />;
        case 'PAYOUTS':
          return <OpsAdminPayoutsScreen key={`ops-payouts-${adminRefreshKey}`} />;
        case 'MORE':
          return (
            <OpsAdminMoreScreen
              key={`ops-more-${opsAdminMoreSubtab}-${adminRefreshKey}`}
              initialSubTab={opsAdminMoreSubtab}
            />
          );
        default:
          return <OperationsDashboardScreen />;
      }
    }

    // Fail closed for legacy ADMIN: require role migration
    if (user?.role === 'ADMIN') {
      return (
        <View style={styles.legacyNoticeContainer}>
          <Text style={styles.legacyNoticeTitle}>Role Migration Required</Text>
          <Text style={styles.legacyNoticeText}>
            Legacy administrator accounts have been deprecated. Please contact system administration to migrate your account to Bill Admin or Operations Admin.
          </Text>
          <TouchableOpacity style={styles.legacyNoticeBtn} onPress={logout}>
            <Text style={styles.legacyNoticeBtnText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Main bottom-tabs navigation for regular craftsman users
    switch (activeTab) {
      case 'HOME':
        return <HomeScreen />;
      case 'BILLS':
        return <BillsScreen />;
      case 'REWARDS':
        return <RewardsScreen />;
      case 'WALLET':
        return <WalletScreen />;
      case 'PROFILE':
        return <ProfileScreen />;
      default:
        return <HomeScreen />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <View style={styles.appContainer}>
        {/* Admin Persistent Header */}
        {currentScreen === 'MAIN' && isAdmin && (
          <AdminHeader onRefresh={handleAdminRefresh} />
        )}

        <View style={styles.screenWrapper}>
          {renderActiveScreen()}
        </View>

        {/* Worker Bottom Navigation */}
        {currentScreen === 'MAIN' && !isAdmin && <BottomNav />}

        {/* Admin Bottom Navigation */}
        {currentScreen === 'MAIN' && isBillAdmin && (
          <AdminBottomNav
            currentTab={billAdminTab}
            onSelectTab={setBillAdminTab}
          />
        )}

        {currentScreen === 'MAIN' && isOpsAdmin && (
          <AdminBottomNav
            currentTab={opsAdminTab}
            onSelectTab={setOpsAdminTab}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <AppProvider>
      <MainAppNavigator />
      {showSplash && (
        <AnimatedSplashScreen onFinish={() => setShowSplash(false)} />
      )}
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#0F172A' : '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appContainer: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 440 : '100%',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 25,
    elevation: 12,
    overflow: 'hidden',
  },
  screenWrapper: {
    flex: 1,
  },
  legacyNoticeContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  legacyNoticeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  legacyNoticeText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  legacyNoticeBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  legacyNoticeBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
