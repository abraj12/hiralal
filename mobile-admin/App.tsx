import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar, Platform, Text, TouchableOpacity } from 'react-native';
import { AdminAppProvider, useAdminApp } from './src/context/AdminAppContext';
import AdminHeader from './src/components/AdminHeader';
import AdminBottomNav from './src/components/AdminBottomNav';
import AdminLoginScreen from './src/screens/AdminLoginScreen';

// 2 Authoritative Admin Mobile Workflows
import BillAdminDashboardScreen from './src/screens/BillAdminDashboardScreen';
import BillReviewScreen from './src/screens/BillReviewScreen';
import OpsAdminDashboardScreen from './src/screens/OpsAdminDashboardScreen';
import OpsAdminUsersScreen from './src/screens/OpsAdminUsersScreen';
import OpsAdminPayoutsScreen from './src/screens/OpsAdminPayoutsScreen';
import OpsAdminMoreScreen from './src/screens/OpsAdminMoreScreen';

function AdminAppNavigator() {
  const { currentScreen, user, role, logout } = useAdminApp();

  // Navigation state for the 2 supported administrative roles
  const [billAdminTab, setBillAdminTab] = useState<'DASHBOARD' | 'BILLS'>('DASHBOARD');
  const [opsAdminTab, setOpsAdminTab] = useState<'DASHBOARD' | 'USERS' | 'PAYOUTS' | 'MORE'>('DASHBOARD');
  const [opsAdminMoreSubtab, setOpsAdminMoreSubtab] = useState<'REWARDS' | 'BROADCAST' | 'AUDIT' | 'SETTINGS'>('REWARDS');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  if (currentScreen === 'LOGIN' || !user) {
    return <AdminLoginScreen />;
  }

  const renderScreen = () => {
    // 1. BILL_ADMIN Portal (Strictly Bill Verification & Inspection)
    if (role === 'BILL_ADMIN') {
      switch (billAdminTab) {
        case 'DASHBOARD':
          return (
            <BillAdminDashboardScreen
              key={`bill-dash-${refreshKey}`}
              onNavigateToBills={() => setBillAdminTab('BILLS')}
            />
          );
        case 'BILLS':
          return <BillReviewScreen key={`bill-review-${refreshKey}`} showStandaloneHeader={false} />;
        default:
          return <BillAdminDashboardScreen onNavigateToBills={() => setBillAdminTab('BILLS')} />;
      }
    }

    // 2. OPERATIONS_ADMIN Portal (Users, Payouts, Slabs, Broadcasts, Audit)
    if (role === 'OPERATIONS_ADMIN') {
      switch (opsAdminTab) {
        case 'DASHBOARD':
          return (
            <OpsAdminDashboardScreen
              key={`ops-dash-${refreshKey}`}
              onNavigateTab={tab => setOpsAdminTab(tab as any)}
              onNavigateMoreSubtab={st => {
                setOpsAdminMoreSubtab(st as any);
                setOpsAdminTab('MORE');
              }}
            />
          );
        case 'USERS':
          return <OpsAdminUsersScreen key={`ops-users-${refreshKey}`} />;
        case 'PAYOUTS':
          return <OpsAdminPayoutsScreen key={`ops-payouts-${refreshKey}`} />;
        case 'MORE':
          return (
            <OpsAdminMoreScreen
              key={`ops-more-${opsAdminMoreSubtab}-${refreshKey}`}
              initialSubTab={opsAdminMoreSubtab}
            />
          );
        default:
          return (
            <OpsAdminDashboardScreen
              onNavigateTab={tab => setOpsAdminTab(tab as any)}
              onNavigateMoreSubtab={st => {
                setOpsAdminMoreSubtab(st as any);
                setOpsAdminTab('MORE');
              }}
            />
          );
      }
    }

    // Fallback if role is unassigned
    return (
      <View style={styles.unauthorizedContainer}>
        <Text style={styles.unauthorizedTitle}>Access Restricted</Text>
        <Text style={styles.unauthorizedText}>
          Only Bill Admin and Operations Admin roles are permitted to access this portal.
        </Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutBtnText}>Return to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <View style={styles.appContainer}>
        <AdminHeader onRefresh={handleRefresh} />

        <View style={styles.screenWrapper}>
          {renderScreen()}
        </View>

        {role === 'BILL_ADMIN' && (
          <AdminBottomNav
            currentTab={billAdminTab}
            onSelectTab={setBillAdminTab}
          />
        )}

        {role === 'OPERATIONS_ADMIN' && (
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
  return (
    <AdminAppProvider>
      <AdminAppNavigator />
    </AdminAppProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  appContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  screenWrapper: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  unauthorizedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  unauthorizedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#EF4444',
    marginBottom: 8,
  },
  unauthorizedText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  logoutBtn: {
    backgroundColor: '#D32F2F',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
