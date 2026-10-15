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
  FileCheck,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Layers,
} from 'lucide-react-native';
import { MobileApiClient } from '../../services/api';

interface BillAdminDashboardProps {
  onNavigateToBills: () => void;
}

export default function BillAdminDashboardScreen({ onNavigateToBills }: BillAdminDashboardProps) {
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
      console.warn('Failed to load Bill Admin dashboard:', e?.message);
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

  const stats = data?.stats
    ? {
        pendingBills: data.stats.pendingBills ?? 0,
        approvedBills: data.stats.approvedBillsCount ?? data.stats.approvedBills ?? 0,
        rejectedBills: data.stats.rejectedBillsCount ?? data.stats.rejectedBills ?? 0,
        totalBills:
          data.stats.totalBills ??
          ((data.stats.approvedBillsCount ?? data.stats.approvedBills ?? 0) +
            (data.stats.rejectedBillsCount ?? data.stats.rejectedBills ?? 0) +
            (data.stats.pendingBills ?? 0)),
        verifiedToday: data.stats.verifiedToday ?? 0,
        approvalRate: data.stats.approvalRate ?? 0,
      }
    : {
        pendingBills: 0,
        approvedBills: 0,
        rejectedBills: 0,
        totalBills: 0,
        verifiedToday: 0,
        approvalRate: 0,
      };

  const approvalRate = stats.totalBills > 0
    ? Math.round((stats.approvedBills / stats.totalBills) * 100)
    : 0;

  const recentBills = data?.recentBills || [];

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 1. Hero Banner */}
      <View style={styles.heroCard}>
        <View style={styles.heroTextCol}>
          <View style={styles.heroBadge}>
            <ShieldCheck size={12} color="#1D4ED8" />
            <Text style={styles.heroBadgeText}>AUDITING ENGINE</Text>
          </View>
          <Text style={styles.heroTitle}>Invoice Verification</Text>
          <Text style={styles.heroSub}>
            Inspect real customer invoices, deduct GST, and verify cashback rewards with zero latency.
          </Text>
          <TouchableOpacity
            style={styles.heroBtn}
            onPress={onNavigateToBills}
            activeOpacity={0.8}
          >
            <Text style={styles.heroBtnText}>Open Review Queue</Text>
            <ArrowRight size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Image
          source={require('../../../assets/admin_bill_review_hero.png')}
          style={styles.heroImg}
          resizeMode="contain"
        />
      </View>

      {/* 2. Key Metrics Grid */}
      <Text style={styles.sectionHeading}>Verification Metrics</Text>
      <View style={styles.statsGrid}>
        {/* Pending Queue */}
        <TouchableOpacity
          style={[styles.statBox, styles.statBoxAmber]}
          onPress={onNavigateToBills}
          activeOpacity={0.7}
        >
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Pending Queue</Text>
            <Clock size={16} color="#D97706" />
          </View>
          <Text style={[styles.statValue, { color: '#B45309' }]}>
            {stats.pendingBills}
          </Text>
          <Text style={styles.statDesc}>Awaiting audit</Text>
        </TouchableOpacity>

        {/* Approved Bills */}
        <View style={[styles.statBox, styles.statBoxGreen]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Approved</Text>
            <CheckCircle2 size={16} color="#16A34A" />
          </View>
          <Text style={[styles.statValue, { color: '#15803D' }]}>
            {stats.approvedBills}
          </Text>
          <Text style={styles.statDesc}>Total verified</Text>
        </View>

        {/* Rejected Bills */}
        <View style={[styles.statBox, styles.statBoxRed]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Rejected</Text>
            <XCircle size={16} color="#DC2626" />
          </View>
          <Text style={[styles.statValue, { color: '#B91C1C' }]}>
            {stats.rejectedBills}
          </Text>
          <Text style={styles.statDesc}>Declined submissions</Text>
        </View>

        {/* Approval Rate */}
        <View style={[styles.statBox, styles.statBoxBlue]}>
          <View style={styles.statHeaderRow}>
            <Text style={styles.statLabel}>Approval Rate</Text>
            <TrendingUp size={16} color="#2563EB" />
          </View>
          <Text style={[styles.statValue, { color: '#1D4ED8' }]}>
            {approvalRate}%
          </Text>
          <Text style={styles.statDesc}>Total {stats.totalBills} processed</Text>
        </View>
      </View>

      {/* 3. Action CTA Banner */}
      {stats.pendingBills > 0 && (
        <TouchableOpacity
          style={styles.pendingAlertCard}
          onPress={onNavigateToBills}
          activeOpacity={0.85}
        >
          <View style={styles.alertLeft}>
            <View style={styles.alertIconWrapper}>
              <FileCheck size={20} color="#D97706" />
            </View>
            <View>
              <Text style={styles.alertTitle}>{stats.pendingBills} Bills Need Verification</Text>
              <Text style={styles.alertSub}>Tap to review invoices & authorize rewards</Text>
            </View>
          </View>
          <ArrowRight size={18} color="#D97706" />
        </TouchableOpacity>
      )}

      {/* 4. Recent Verified Submissions */}
      <View style={styles.recentSection}>
        <View style={styles.recentHeader}>
          <Text style={styles.sectionHeading}>Recent Invoices</Text>
          <TouchableOpacity onPress={onNavigateToBills}>
            <Text style={styles.viewAllLink}>View All ({stats.totalBills})</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 20 }} />
        ) : recentBills.length === 0 ? (
          <View style={styles.emptyRecent}>
            <Text style={styles.emptyRecentText}>No recent bills found.</Text>
          </View>
        ) : (
          <View style={styles.recentList}>
            {recentBills.slice(0, 5).map((bill: any) => {
              const isApproved = bill.status === 'APPROVED';
              const isPending = bill.status === 'PENDING';
              const isRejected = bill.status === 'REJECTED';

              const statusColor = isApproved ? '#16A34A' : isPending ? '#D97706' : '#DC2626';
              const statusBg = isApproved ? '#F0FDF4' : isPending ? '#FEF3C7' : '#FEF2F2';

              return (
                <View key={bill.id} style={styles.billItemCard}>
                  <View style={styles.billItemTop}>
                    <View>
                      <Text style={styles.billNumberText}>
                        {bill.invoiceNumber || bill.id.substring(0, 12)}
                      </Text>
                      <Text style={styles.billCraftsmanText}>
                        {bill.user?.fullName || 'Craftsman'} • {bill.user?.profession || 'PLUMBER'}
                      </Text>
                    </View>
                    <View style={[styles.statusChip, { backgroundColor: statusBg, borderColor: statusColor }]}>
                      <Text style={[styles.statusChipText, { color: statusColor }]}>
                        {bill.status}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.billItemBottom}>
                    <Text style={styles.billAmountText}>
                      Amount: <Text style={{ fontWeight: '800' }}>₹{Number(bill.billAmount || 0).toLocaleString('en-IN')}</Text>
                    </Text>
                    <Text style={[styles.billRewardText, { color: isApproved ? '#16A34A' : isRejected ? '#DC2626' : '#D97706' }]}>
                      {isApproved
                        ? `+${Number(bill.calculatedReward ?? bill.rewardAmount ?? 0).toLocaleString('en-IN')} Points`
                        : isRejected
                        ? 'Rejected'
                        : 'Pending audit'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
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
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  heroBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#1D4ED8',
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
    backgroundColor: '#2563EB',
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
    marginBottom: 16,
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
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statDesc: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  pendingAlertCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  alertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alertIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  alertSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  recentSection: {
    marginTop: 8,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  viewAllLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  recentList: {
    gap: 8,
  },
  billItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  billItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  billNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  billCraftsmanText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  billItemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 8,
  },
  billAmountText: {
    fontSize: 12,
    color: '#475569',
  },
  billRewardText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyRecent: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyRecentText: {
    fontSize: 12,
    color: '#94A3B8',
  },
});
