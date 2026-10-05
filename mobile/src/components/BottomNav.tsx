import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Home, FileText, Gift, Wallet, User } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

export default function BottomNav() {
  const { activeTab, setActiveTab, theme } = useApp();

  const tabs = [
    { key: 'HOME', label: 'Home', icon: Home },
    { key: 'BILLS', label: 'Bills', icon: FileText },
    { key: 'REWARDS', label: 'Rewards', icon: Gift },
    { key: 'WALLET', label: 'Wallet', icon: Wallet },
    { key: 'PROFILE', label: 'Profile', icon: User },
  ] as const;

  return (
    <View style={styles.container}>
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabButton}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Icon
                size={22}
                color={isActive ? theme.primaryColor : '#94A3B8'}
                strokeWidth={isActive ? 2.4 : 1.8}
              />
            </View>
            <Text
              style={[
                styles.tabLabel,
                { color: isActive ? theme.primaryColor : '#94A3B8', fontWeight: isActive ? '700' : '500' },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginBottom: 4,
  },
  tabLabel: {
    fontSize: 11,
  },
});
