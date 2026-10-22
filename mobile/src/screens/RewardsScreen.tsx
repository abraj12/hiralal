import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Gift, CheckCircle2, Clock, FileCheck, ArrowDownRight, ArrowUpRight, DollarSign } from 'lucide-react-native';
import Header from '../components/Header';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function RewardsScreen() {
  const { theme, wallet, bills, transactions, refreshData } = useApp();
  const [rewardsData, setRewardsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'APPROVED' | 'LEDGER'>('APPROVED');

  const fetchRewards = useCallback(async () => {
    try {
      const res = await MobileApiClient.getRewards();
      if (res && res.success) {
        setRewardsData(res);
      }
    } catch (e: any) {
      console.warn('Failed to load rewards from backend:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRewards();
  }, [fetchRewards]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshData(), fetchRewards()]);
    setRefreshing(false);
  };

  const summary = rewardsData?.summary;
  const totalRewards = summary?.lifetimeCashback ?? wallet.lifetimeCashback ?? (wallet.availableBalance + wallet.totalRedeemed);
  const processingAmount = summary?.processingAmount ?? wallet.processingAmount;
  const availableBalance = summary?.availableBalance ?? wallet.availableBalance;

  const localApprovedBills = bills.filter(b => b.status === 'APPROVED');
  const localPendingBills = bills.filter(b => b.status === 'PENDING' || b.status === 'UNDER_REVIEW');

  const approvedCount = summary?.billsApprovedCount ?? localApprovedBills.length;
  const pendingCount = summary?.billsPendingCount ?? localPendingBills.length;

  const recentRewards = rewardsData?.recentRewards && rewardsData.recentRewards.length > 0
    ? rewardsData.recentRewards
    : localApprovedBills.map(b => ({
        id: b.id,
        invoiceNumber: b.invoiceNumber,
        invoiceDate: b.invoiceDate,
        billAmount: Number(b.billAmount),
        rewardAmount: Number(b.calculatedReward || 0),
        status: b.status,
        createdAt: b.createdAt,
      }));

  const ledgerList = rewardsData?.ledger && rewardsData.ledger.length > 0
    ? rewardsData.ledger
    : transactions;

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 34 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Top Summary Card */}
        <View style={[styles.heroSummaryCard, { backgroundColor: theme.primaryColor }]}>
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.heroSub}>{theme.myRewardsTitle}</Text>
              <Text style={styles.heroValue}>{Number(totalRewards).toLocaleString('en-IN')} Points</Text>
            </View>
            <Image
              source={require('../../assets/rewards_illustration.png')}
              style={styles.heroGiftImg}
              resizeMode="contain"
            />
          </View>

          {/* 4 Mini Metrics inside Card */}
          <View style={styles.heroMetricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Processing</Text>
              <Text style={styles.metricVal}>{Number(processingAmount).toLocaleString('en-IN')} Points</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Available</Text>
              <Text style={styles.metricVal}>{Number(availableBalance).toLocaleString('en-IN')} Points</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Approved Bills</Text>
              <Text style={styles.metricVal}>{approvedCount}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Pending Bills</Text>
              <Text style={styles.metricVal}>{pendingCount}</Text>
            </View>
          </View>
        </View>

        {/* Section View Tabs */}
        <View style={styles.tabSwitchContainer}>
          <TouchableOpacity
            style={[styles.tabSwitchBtn, activeTab === 'APPROVED' && styles.tabSwitchBtnActive]}
            onPress={() => setActiveTab('APPROVED')}
          >
            <Text style={[styles.tabSwitchText, activeTab === 'APPROVED' && styles.tabSwitchTextActive]}>
              Approved Rewards ({recentRewards.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabSwitchBtn, activeTab === 'LEDGER' && styles.tabSwitchBtnActive]}
            onPress={() => setActiveTab('LEDGER')}
          >
            <Text style={[styles.tabSwitchText, activeTab === 'LEDGER' && styles.tabSwitchTextActive]}>
              Reward Ledger ({ledgerList.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab 1: Approved Rewards */}
        {activeTab === 'APPROVED' && (
          <View style={styles.historySection}>
            <Text style={styles.historySectionTitle}>Approved Cashback Rewards</Text>

            {recentRewards.length === 0 ? (
              <View style={styles.emptyBox}>
                <Image
                  source={require('../../assets/state_no_transactions.png')}
                  style={styles.emptyImg}
                  resizeMode="contain"
                />
                <Text style={styles.emptyText}>No approved rewards yet</Text>
                <Text style={styles.emptySubtext}>Submit your bills to earn rewards once verified</Text>
              </View>
            ) : (
              recentRewards.map((item: any) => {
                const amount = Number(item.rewardAmount || item.calculatedReward || 0);
                return (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.cardHeaderLeft}>
                        <Gift size={16} color={theme.primaryColor} />
                        <Text style={styles.cardInvoice}>{item.invoiceNumber}</Text>
                      </View>
                      <Text style={styles.cardRewardGreen}>
                        +{amount.toLocaleString('en-IN')} Points
                      </Text>
                    </View>

                    <View style={styles.cardFooterRow}>
                      <Text style={styles.cardBillAmount}>
                        Bill: ₹{Number(item.billAmount || 0).toLocaleString('en-IN')} • {new Date(item.invoiceDate || item.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </Text>
                      <View style={styles.approvedPill}>
                        <Text style={styles.approvedPillText}>APPROVED</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Tab 2: Reward Ledger */}
        {activeTab === 'LEDGER' && (
          <View style={styles.historySection}>
            <Text style={styles.historySectionTitle}>Wallet & Reward Ledger</Text>

            {ledgerList.length === 0 ? (
              <View style={styles.emptyBox}>
                <Image
                  source={require('../../assets/state_no_transactions.png')}
                  style={styles.emptyImg}
                  resizeMode="contain"
                />
                <Text style={styles.emptyText}>No ledger transactions yet</Text>
                <Text style={styles.emptySubtext}>Approved credits and payouts will record here</Text>
              </View>
            ) : (
              ledgerList.map((t: any) => {
                const isCredit =
                  t.type === 'REWARD_CREDIT' ||
                  t.type === 'PAYOUT_REVERSAL' ||
                  t.type === 'REFUND' ||
                  t.type === 'CREDIT' ||
                  t.type === 'REWARD' ||
                  (t.type === 'MANUAL_ADJUSTMENT' && Number(t.amount) >= 0);

                const getTitle = () => {
                  if (t.type === 'REWARD_CREDIT' || t.type === 'CREDIT' || t.type === 'REWARD') return 'Reward Credited';
                  if (t.type === 'PAYOUT_REVERSAL') return 'Payout Reversed';
                  if (t.type === 'REFUND') return 'Refund Credited';
                  if (t.type === 'PAYOUT_DEBIT') return 'Payout Disbursed';
                  if (t.type === 'MANUAL_ADJUSTMENT') return 'Balance Adjustment';
                  return String(t.type || 'Transaction').replace(/_/g, ' ');
                };

                return (
                  <View key={t.id} style={styles.historyCard}>
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.cardHeaderLeft}>
                        <View
                          style={[
                            styles.ledgerIconCircle,
                            { backgroundColor: isCredit ? '#F0FDF4' : '#EFF6FF' },
                          ]}
                        >
                          {isCredit ? (
                            <ArrowDownRight size={15} color="#16A34A" />
                          ) : (
                            <ArrowUpRight size={15} color="#2563EB" />
                          )}
                        </View>
                        <View>
                          <Text style={styles.cardInvoice}>{getTitle()}</Text>
                          <Text style={styles.cardBillAmount} numberOfLines={1}>
                            {t.description || (isCredit ? 'Credited to wallet' : 'Transferred to account')}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.cardReward, { color: isCredit ? '#16A34A' : '#0F172A' }]}>
                          {isCredit ? '+' : '-'}{Math.abs(Number(t.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points
                        </Text>
                        <Text style={styles.ledgerDate}>
                          {new Date(t.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </Text>
                      </View>
                    </View>

                    {t.balanceAfter != null && !isNaN(Number(t.balanceAfter)) && (
                      <View style={styles.cardFooterRow}>
                        <Text style={styles.balanceAfterText}>
                          Balance After: {Number(t.balanceAfter).toLocaleString('en-IN')} Points
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scroll: {
    flex: 1,
  },
  heroSummaryCard: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroSub: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  heroValue: {
    fontSize: 34,
    fontWeight: '900',
    color: '#ffffff',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  heroGiftImg: {
    width: 75,
    height: 65,
  },
  heroMetricsGrid: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 16,
    paddingVertical: 12,
    marginTop: 18,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  metricVal: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
    marginTop: 2,
  },
  tabSwitchContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
  },
  tabSwitchBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  tabSwitchBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabSwitchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  tabSwitchTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  historySection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  historySectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardInvoice: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardRewardGreen: {
    fontSize: 16,
    fontWeight: '900',
    color: '#16A34A',
  },
  cardReward: {
    fontSize: 15,
    fontWeight: '800',
  },
  ledgerDate: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  ledgerIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 8,
  },
  cardBillAmount: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  balanceAfterText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  approvedPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  approvedPillText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyImg: {
    width: 100,
    height: 90,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});
