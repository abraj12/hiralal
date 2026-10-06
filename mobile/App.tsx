import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView, StatusBar, Platform } from 'react-native';
import { AppProvider, useApp } from './src/context/AppContext';
import BottomNav from './src/components/BottomNav';
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

function MainAppNavigator() {
  const { currentScreen, activeTab } = useApp();

  const renderActiveScreen = () => {
    if (currentScreen === 'WELCOME') return <WelcomeScreen />;
    if (currentScreen === 'LOGIN') return <LoginScreen />;
    if (currentScreen === 'REGISTER') return <RegisterScreen />;
    if (currentScreen === 'UPLOAD_BILL') return <UploadBillScreen />;

    // Main bottom-tabs navigation
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

        {currentScreen === 'MAIN' && <BottomNav />}
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
});
