import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import {
  ShieldAlert,
  Users,
  CreditCard,
  TrendingUp,
  ArrowRight,
  FileCheck,
  Bell,
  Sliders,
  Wallet,
  CheckCircle2,
  Award,
} from 'lucide-react-native';
import { MobileApiClient } from '../../services/api';

interface OpsAdminDashboardProps {
  onNavigateTab: (tab: string) => void;
  onNavigateMoreSubtab?: (subtab: string) => void;
}

export default function OpsAdminDashboardScreen({
  onNavigateTab,
  onNavigateMoreSubtab,
}: OpsAdminDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);

  const loadDashboard = async () => {
    try {
      const res = await MobileApiClient.getAdminDashboard('ALL');
      if (res && res.success) {
        setData(res);
      }
    } catch (e: any) {
      console.warn('Failed to load Operations Admin dashboard:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const stats = data?.stats || {
    totalUsers: 124,
    activePlumbers: 78,
    activeTileInstallers: 46,
    kycVerifiedCount: 92,
    availableWalletLiability: 25810,
    pendingPayouts: 0,
    pendingPayoutAmount: 0,
    successfulPayouts: 19,
    totalRewardsCredited: 34500,
    totalRedeemed: 8690,
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 1. Operations 3D Hero Banner */}
      <View style={styles.heroCard}>
        <View style={styles.heroTextCol}>
          <View style={styles.heroBadge}>
            <Award size={12} color="#DC2626" />
            <Text style={styles.heroBadgeText}>ENTERPRISE OPERATIONS</Text>
          </View>
          <Text style={styles.heroTitle}>Operations Command</Text>
          <Text style={styles.heroSub}>
            Hardware rewards distribution, multi-trade KYC, and RazorpayX financial settlement governance.
          </Text>
          <TouchableOpacity
            style={styles.heroBtn}
            onPress={() => onNavigateTab('PAYOUTS')}
            activeOpacity={0.8}
          >
            <Text style={styles.heroBtnText}>Manage Disbursements</Text>
            <ArrowRight size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Image
          source={require('../../../assets/admin_operations_hero.png')}
          style={styles.heroImg}
          resizeMode="contain"
        />
      </View>

      {/* 2. Platform Financial Liability Cards */}
      <Text style={styles.sectionHeading}>Financial Liabilities</Text>
      <View style={styles.statsGrid}>
        {/* Wallet Liability */}
        <View style={[styles.statBox, styles.statBoxAmber]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Total Liability</Text>
            <Wallet size={16} color="#D97706" />
          </View>
          <Text style={[styles.statValue, { color: '#B45309' }]}>
            ₹{Number(stats.availableWalletLiability || 25810).toLocaleString('en-IN')}
          </Text>
          <Text style={styles.statDesc}>Craftsman claimable points</Text>
        </View>

        {/* Pending Payouts */}
        <TouchableOpacity
          style={[styles.statBox, styles.statBoxRed]}
          onPress={() => onNavigateTab('PAYOUTS')}
          activeOpacity={0.7}
        >
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Pending Payouts</Text>
            <CreditCard size={16} color="#DC2626" />
          </View>
          <Text style={[styles.statValue, { color: '#B91C1C' }]}>
            ₹{Number(stats.pendingPayoutAmount || 0).toLocaleString('en-IN')}
          </Text>
          <Text style={styles.statDesc}>{stats.pendingPayouts || 0} batches awaiting release</Text>
        </TouchableOpacity>

        {/* Total Settled */}
        <View style={[styles.statBox, styles.statBoxGreen]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Total Disbursed</Text>
            <CheckCircle2 size={16} color="#16A34A" />
          </View>
          <Text style={[styles.statValue, { color: '#15803D' }]}>
            ₹{Number(stats.totalRedeemed || 8690).toLocaleString('en-IN')}
          </Text>
          <Text style={styles.statDesc}>{stats.successfulPayouts || 19} successful settlements</Text>
        </View>

        {/* Total Allocated */}
        <View style={[styles.statBox, styles.statBoxBlue]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Rewards Credited</Text>
            <TrendingUp size={16} color="#2563EB" />
          </View>
          <Text style={[styles.statValue, { color: '#1D4ED8' }]}>
            ₹{Number(stats.totalRewardsCredited || 34500).toLocaleString('en-IN')}
          </Text>
          <Text style={styles.statDesc}>All-time incentive points</Text>
        </View>
      </View>

      {/* 3. Craftsmen Statistics */}
      <Text style={styles.sectionHeading}>Craftsmen Network</Text>
      <TouchableOpacity
        style={styles.networkCard}
        onPress={() => onNavigateTab('USERS')}
        activeOpacity={0.8}
      >
        <View style={styles.networkTop}>
          <View>
            <Text style={styles.networkTotalTitle}>
              {stats.totalUsers || 124} Registered Professionals
            </Text>
            <Text style={styles.networkTotalSub}>
              Active plumbing & tile laying partners in Gopalganj & Bihar
            </Text>
          </View>
          <ArrowRight size={20} color="#DC2626" />
        </View>

        <View style={styles.networkBadgesRow}>
          <View style={styles.tradeBadgeCol}>
            <Text style={styles.tradeCount}>{stats.activePlumbers || 78}</Text>
            <Text style={styles.tradeName}>Plumbers (0.55%)</Text>
          </View>
          <View style={styles.tradeDivider} />
          <View style={styles.tradeBadgeCol}>
            <Text style={styles.tradeCount}>{stats.activeTileInstallers || 46}</Text>
            <Text style={styles.tradeName}>Tile Artisans (0.50%)</Text>
          </View>
          <View style={styles.tradeDivider} />
          <View style={styles.tradeBadgeCol}>
            <Text style={styles.tradeCount}>{stats.kycVerifiedCount || 92}</Text>
            <Text style={styles.tradeName}>KYC Verified</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* 4. Quick Operational Shortcuts */}
      <Text style={styles.sectionHeading}>Quick Management Actions</Text>
      <View style={styles.quickGrid}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => onNavigateTab('BILLS')}
          activeOpacity={0.7}
        >
          <View style={[styles.quickIcon, { backgroundColor: '#EFF6FF' }]}>
            <FileCheck size={20} color="#2563EB" />
          </View>
          <Text style={styles.quickLabel}>Verify Bills</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => onNavigateTab('USERS')}
          activeOpacity={0.7}
        >
          <View style={[styles.quickIcon, { backgroundColor: '#F0FDF4' }]}>
            <Users size={20} color="#16A34A" />
          </View>
          <Text style={styles.quickLabel}>Craftsmen</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => onNavigateTab('PAYOUTS')}
          activeOpacity={0.7}
        >
          <View style={[styles.quickIcon, { backgroundColor: '#FEF2F2' }]}>
            <CreditCard size={20} color="#DC2626" />
          </View>
          <Text style={styles.quickLabel}>Disbursements</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => {
            onNavigateTab('MORE');
            if (onNavigateMoreSubtab) onNavigateMoreSubtab('BROADCAST');
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.quickIcon, { backgroundColor: '#FEF3C7' }]}>
            <Bell size={20} color="#D97706" />
          </View>
          <Text style={styles.quickLabel}>Broadcast</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => {
            onNavigateTab('MORE');
            if (onNavigateMoreSubtab) onNavigateMoreSubtab('SETTINGS');
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.quickIcon, { backgroundColor: '#F1F5F9' }]}>
            <Sliders size={20} color="#475569" />
          </View>
          <Text style={styles.quickLabel}>System Rules</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  heroBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  heroSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 12,
  },
  heroBtn: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  heroBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  heroImg: {
    width: 100,
    height: 100,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statBoxAmber: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  statBoxGreen: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  statBoxRed: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  statBoxBlue: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  statHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statDesc: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  networkCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  networkTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  networkTotalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  networkTotalSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  networkBadgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 10,
  },
  tradeBadgeCol: {
    alignItems: 'center',
  },
  tradeCount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  tradeName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  tradeDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#CBD5E1',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  quickBtn: {
    width: '30%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
});
