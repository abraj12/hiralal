import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { Wallet, ArrowDownRight, ArrowUpRight, ShieldAlert, CheckCircle2, Clock } from 'lucide-react-native';
import Header from '../components/Header';
import RedemptionModal from '../components/RedemptionModal';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function WalletScreen() {
  const { theme, wallet, transactions, refreshData } = useApp();
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [eligibility, setEligibility] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEligibility = async () => {
    try {
      const res = await MobileApiClient.getPayoutEligibility();
      setEligibility(res);
    } catch (e) {
      // Ignore
    }
  };

  useEffect(() => {
    fetchEligibility();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshData(), fetchEligibility()]);
    setRefreshing(false);
  };

  const isWindowOpen = eligibility?.windowSettings?.isEnabled ?? false;
  const minAmount = eligibility?.minimumAmount ?? 500;
  const canRedeem = (wallet.availableBalance >= minAmount) && isWindowOpen;

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Main Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>₹{wallet.availableBalance.toLocaleString('en-IN')}</Text>

          <View style={styles.balanceSubRow}>
            <View style={styles.balanceSubItem}>
              <Text style={styles.subLabel}>Processing</Text>
              <Text style={styles.subVal}>₹{wallet.processingAmount.toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceSubItem}>
              <Text style={styles.subLabel}>Total Redeemed</Text>
              <Text style={styles.subVal}>₹{wallet.totalRedeemed.toLocaleString('en-IN')}</Text>
            </View>
          </View>

          {/* Redemption Window Info Banner */}
          <View
            style={[
              styles.windowBanner,
              { backgroundColor: isWindowOpen ? '#F0FDF4' : '#FEF2F2', borderColor: isWindowOpen ? '#BBF7D0' : '#FECACA' },
            ]}
          >
            <View style={styles.windowBannerHeader}>
              {isWindowOpen ? (
                <CheckCircle2 size={16} color="#16A34A" />
              ) : (
                <Clock size={16} color="#DC2626" />
              )}
              <Text
                style={[
                  styles.windowBannerTitle,
                  { color: isWindowOpen ? '#15803D' : '#B91C1C' },
                ]}
              >
                {isWindowOpen ? 'Redemption Window Active' : 'Redemption Window Inactive'}
              </Text>
            </View>
            <Text style={styles.windowBannerMessage}>
              {eligibility?.windowSettings?.message ||
                (isWindowOpen
                  ? `Min payout: ₹${minAmount} • Direct transfer to verified account`
                  : 'Payout requests are currently disabled by administration.')}
            </Text>
          </View>

          {/* Primary CTA: Redeem Rewards */}
          <TouchableOpacity
            style={[
              styles.redeemBtn,
              { backgroundColor: theme.primaryColor },
              (!canRedeem) && { opacity: 0.6 },
            ]}
            onPress={() => setShowRedeemModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.redeemBtnText}>Redeem Rewards</Text>
          </TouchableOpacity>

          {!isWindowOpen && (
            <Text style={styles.minRedeemNotice}>
              Redemption is currently closed by administration
            </Text>
          )}
          {isWindowOpen && wallet.availableBalance < minAmount && (
            <Text style={styles.minRedeemNotice}>
              Minimum balance of ₹{minAmount} required for payout
            </Text>
          )}
        </View>

        {/* Ledger Transaction History */}
        <View style={styles.ledgerSection}>
          <Text style={styles.ledgerTitle}>Transaction History</Text>

          {transactions.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Image
                source={require('../../assets/state_no_transactions.png')}
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>No Transactions Yet</Text>
              <Text style={styles.emptySubtitle}>Approved reward points and payouts will appear here</Text>
            </View>
          ) : (
            <View style={styles.txList}>
              {transactions.map((t: any) => {
                const isCredit = t.type === 'CREDIT' || t.type === 'REWARD' || t.type === 'REFUND';
                return (
                  <View key={t.id} style={styles.txItem}>
                    <View
                      style={[
                        styles.txIconBox,
                        { backgroundColor: isCredit ? '#F0FDF4' : '#EFF6FF' },
                      ]}
                    >
                      {isCredit ? (
                        <ArrowDownRight size={18} color="#16A34A" />
                      ) : (
                        <ArrowUpRight size={18} color="#2563EB" />
                      )}
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txTitle}>
                        {t.type === 'CREDIT' || t.type === 'REWARD'
                          ? 'Reward Credited'
                          : t.type === 'REFUND'
                          ? 'Payout Reversed / Refunded'
                          : 'Payout Disbursed'}
                      </Text>
                      <Text style={styles.txDesc} numberOfLines={1}>
                        {t.description || (isCredit ? 'Reward earned' : 'Transferred to account')}
                      </Text>
                    </View>
                    <View style={styles.txAmountCol}>
                      <Text
                        style={[
                          styles.txAmount,
                          { color: isCredit ? '#16A34A' : '#0F172A' },
                        ]}
                      >
                        {isCredit ? '+' : '-'}₹{Number(t.amount).toFixed(2)}
                      </Text>
                      <Text style={styles.txDate}>
                        {new Date(t.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Redemption Wizard Modal */}
      <RedemptionModal
        visible={showRedeemModal}
        onClose={() => {
          setShowRedeemModal(false);
          fetchEligibility();
        }}
      />
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
  balanceCard: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceValue: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0F172A',
    marginVertical: 6,
    letterSpacing: -0.5,
  },
  balanceSubRow: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingVertical: 12,
    marginTop: 14,
    marginBottom: 16,
  },
  balanceSubItem: {
    flex: 1,
    alignItems: 'center',
  },
  subLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  subVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  balanceDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
  },
  windowBanner: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  windowBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  windowBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  windowBannerMessage: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  redeemBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  redeemBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  minRedeemNotice: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
    fontWeight: '500',
  },
  ledgerSection: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  ledgerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyImage: {
    width: 110,
    height: 110,
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  txList: {},
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 10,
  },
  txIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  txInfo: {
    flex: 1,
  },
  txTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  txDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  txAmountCol: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  txDate: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
});
