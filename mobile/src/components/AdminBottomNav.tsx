import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  LayoutDashboard,
  FileCheck,
  Users,
  CreditCard,
  Sliders,
  Award,
} from 'lucide-react-native';
import { useApp } from '../context/AppContext';

export type BillAdminTab = 'DASHBOARD' | 'BILLS';
export type OpsAdminTab = 'DASHBOARD' | 'USERS' | 'PAYOUTS' | 'MORE';

interface AdminBottomNavProps {
  currentTab: string;
  onSelectTab: (tab: any) => void;
  pendingCount?: number;
}

export default function AdminBottomNav({
  currentTab,
  onSelectTab,
  pendingCount = 0,
}: AdminBottomNavProps) {
  const { user } = useApp();
  const isBillAdmin = user?.role === 'BILL_ADMIN';

  const billAdminTabs = [
    { key: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'BILLS', label: 'Bills Queue', icon: FileCheck, badge: pendingCount },
  ];

  const opsAdminTabs = [
    { key: 'DASHBOARD', label: 'Overview', icon: LayoutDashboard },
    { key: 'USERS', label: 'Craftsmen', icon: Users },
    { key: 'PAYOUTS', label: 'Payouts', icon: CreditCard, badge: pendingCount },
    { key: 'MORE', label: 'More', icon: Sliders },
  ];

  const activeTabs = isBillAdmin ? billAdminTabs : opsAdminTabs;
  const primaryColor = isBillAdmin ? '#2563EB' : '#DC2626';

  return (
    <View style={styles.container}>
      {activeTabs.map(tab => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.key;
        const hasBadge = (tab as any).badge && (tab as any).badge > 0;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabButton}
            onPress={() => onSelectTab(tab.key)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrapper}>
              <Icon
                size={21}
                color={isActive ? primaryColor : '#94A3B8'}
                strokeWidth={isActive ? 2.4 : 1.8}
              />
              {hasBadge && (
                <View style={styles.badgeWrapper}>
                  <Text style={styles.badgeText}>
                    {(tab as any).badge > 99 ? '99+' : (tab as any).badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.tabLabel,
                { color: isActive ? primaryColor : '#94A3B8', fontWeight: isActive ? '700' : '500' },
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
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'relative',
    marginBottom: 3,
  },
  badgeWrapper: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 10.5,
  },
});
