import React, { useEffect } from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar, Platform, Linking } from 'react-native';
import { AppProvider, useApp } from './src/context/AppContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import BottomNav from './src/components/BottomNav';
import HomeScreen from './src/screens/HomeScreen';
import BillsScreen from './src/screens/BillsScreen';
import RewardsScreen from './src/screens/RewardsScreen';
import WalletScreen from './src/screens/WalletScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import UploadBillScreen from './src/screens/UploadBillScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import NotificationScreen from './src/screens/NotificationScreen';

function MainAppNavigator() {
  const { currentScreen, activeTab, setCurrentScreen, setActiveTab } = useApp();

  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      if (!event.url) return;
      const url = event.url.toLowerCase();
      if (url.includes('notifications')) {
        setCurrentScreen('NOTIFICATIONS');
      } else if (url.includes('upload')) {
        setCurrentScreen('UPLOAD_BILL');
      } else if (url.includes('bills')) {
        setCurrentScreen('MAIN');
        setActiveTab('BILLS');
      } else if (url.includes('wallet')) {
        setCurrentScreen('MAIN');
        setActiveTab('WALLET');
      } else if (url.includes('rewards')) {
        setCurrentScreen('MAIN');
        setActiveTab('REWARDS');
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [setCurrentScreen, setActiveTab]);

  const renderActiveScreen = () => {
    if (currentScreen === 'WELCOME') return <WelcomeScreen />;
    if (currentScreen === 'LOGIN') return <LoginScreen />;
    if (currentScreen === 'REGISTER') return <RegisterScreen />;
    if (currentScreen === 'UPLOAD_BILL') return <UploadBillScreen />;
    if (currentScreen === 'NOTIFICATIONS') return <NotificationScreen />;

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
        <View style={styles.screenWrapper}>
          {renderActiveScreen()}
        </View>

        {/* Craftsman Bottom Navigation */}
        {currentScreen === 'MAIN' && <BottomNav />}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainAppNavigator />
      </AppProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  appContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  screenWrapper: {
    flex: 1,
  },
});
