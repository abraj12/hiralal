import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { Gift, CheckCircle2, Clock, FileCheck, DollarSign } from 'lucide-react-native';
import Header from '../components/Header';
import { useApp } from '../context/AppContext';

export default function RewardsScreen() {
  const { theme, wallet, bills } = useApp();

  const totalRewards = wallet.availableBalance + wallet.totalRedeemed;
  const approvedBills = bills.filter(b => b.status === 'APPROVED');
  const pendingBills = bills.filter(b => b.status === 'PENDING' || b.status === 'UNDER_REVIEW');

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Top Summary Card */}
        <View style={[styles.heroSummaryCard, { backgroundColor: theme.primaryColor }]}>
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.heroSub}>{theme.myRewardsTitle}</Text>
              <Text style={styles.heroValue}>₹{totalRewards.toLocaleString('en-IN')}</Text>
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
              <Text style={styles.metricVal}>₹{wallet.processingAmount.toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Available</Text>
              <Text style={styles.metricVal}>₹{wallet.availableBalance.toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Approved Bills</Text>
              <Text style={styles.metricVal}>{approvedBills.length}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Pending Bills</Text>
              <Text style={styles.metricVal}>{pendingBills.length}</Text>
            </View>
          </View>
        </View>

        {/* Reward History Section */}
        <View style={styles.historySection}>
          <Text style={styles.historySectionTitle}>Reward Ledger History</Text>

          {bills.length === 0 ? (
            <View style={styles.emptyBox}>
              <Image
                source={require('../../assets/state_no_transactions.png')}
                style={styles.emptyImg}
                resizeMode="contain"
              />
              <Text style={styles.emptyText}>No reward credits yet</Text>
            </View>
          ) : (
            bills.map((item: any) => {
              const isApproved = item.status === 'APPROVED';
              return (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.cardHeaderLeft}>
                      <Gift size={16} color={theme.primaryColor} />
                      <Text style={styles.cardInvoice}>{item.invoiceNumber}</Text>
                    </View>
                    <Text style={[styles.cardReward, { color: isApproved ? '#16A34A' : '#EA580C' }]}>
                      +₹{item.calculatedReward}
                    </Text>
                  </View>

                  <View style={styles.cardFooterRow}>
                    <Text style={styles.cardBillAmount}>
                      Bill Amount: ₹{item.billAmount.toLocaleString('en-IN')} (0.5%)
                    </Text>
                    <Text
                      style={[
                        styles.cardStatus,
                        { color: isApproved ? '#16A34A' : '#EA580C' },
                      ]}
                    >
                      {item.status}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
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
  historySection: {
    paddingHorizontal: 20,
    marginTop: 24,
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
  },
  cardInvoice: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardReward: {
    fontSize: 16,
    fontWeight: '900',
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
  cardStatus: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyImg: {
    width: 100,
    height: 90,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
});
