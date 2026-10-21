import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { RefreshCw, LogOut, ShieldCheck, CheckCircle2 } from 'lucide-react-native';
import { useAdminApp as useApp } from '../context/AdminAppContext';

interface AdminHeaderProps {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export default function AdminHeader({ title, subtitle, onRefresh, refreshing }: AdminHeaderProps) {
  const { user, logout } = useApp();

  const isBillAdmin = user?.role === 'BILL_ADMIN';
  const roleName = isBillAdmin ? 'BILL ADMIN' : 'OPS ADMIN';
  const roleColor = isBillAdmin ? '#2563EB' : '#DC2626';
  const roleBg = isBillAdmin ? '#EFF6FF' : '#FEF2F2';

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to end your administrator session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/brand_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <View style={styles.titleBadgeRow}>
              <Text style={styles.titleText}>
                {title || (isBillAdmin ? 'Bill Review Admin' : 'Operations Command')}
              </Text>
              <View style={[styles.badge, { backgroundColor: roleBg, borderColor: roleColor }]}>
                <Text style={[styles.badgeText, { color: roleColor }]}>{roleName}</Text>
              </View>
            </View>
            <Text style={styles.subText}>
              {subtitle || `${user?.fullName || 'Administrator'} • ${user?.mobile || ''}`}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {onRefresh && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onRefresh}
              disabled={refreshing}
              activeOpacity={0.7}
            >
              <RefreshCw
                size={18}
                color="#475569"
                style={refreshing ? { opacity: 0.5 } : undefined}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.iconBtn, styles.logoutBtn]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <LogOut size={18} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  logo: {
    width: 38,
    height: 38,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  subText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FEE2E2',
  },
});
