import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Wallet, ArrowDownRight, ArrowUpRight, ShieldCheck, CheckCircle2 } from 'lucide-react-native';
import Header from '../components/Header';
import RedemptionModal from '../components/RedemptionModal';
import { useApp } from '../context/AppContext';

export default function WalletScreen() {
  const { theme, wallet } = useApp();
  const [showRedeemModal, setShowRedeemModal] = useState(false);

  const canRedeem = wallet.availableBalance >= 500;

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Main Balance Box */}
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

          {/* Primary CTA: Redeem Rewards */}
          <TouchableOpacity
            style={[
              styles.redeemBtn,
              { backgroundColor: theme.primaryColor },
              !canRedeem && { opacity: 0.6 },
            ]}
            onPress={() => setShowRedeemModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.redeemBtnText}>Redeem Rewards</Text>
          </TouchableOpacity>

          {!canRedeem && (
            <Text style={styles.minRedeemNotice}>
              Minimum balance of ₹500 required for payout
            </Text>
          )}
        </View>

        {/* Ledger Transaction History */}
        <View style={styles.ledgerSection}>
          <Text style={styles.ledgerTitle}>Transaction History</Text>

          <View style={styles.txList}>
            {/* Seeded / sample transactions */}
            <View style={styles.txItem}>
              <View style={[styles.txIconBox, { backgroundColor: '#F0FDF4' }]}>
                <ArrowDownRight size={18} color="#16A34A" />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txTitle}>Reward Credited</Text>
                <Text style={styles.txDesc}>Approved Bill INV-2026-001</Text>
              </View>
              <View style={styles.txAmountCol}>
                <Text style={[styles.txAmount, { color: '#16A34A' }]}>+₹250.00</Text>
                <Text style={styles.txDate}>02 Oct 2026</Text>
              </View>
            </View>

            <View style={styles.txItem}>
              <View style={[styles.txIconBox, { backgroundColor: '#F0FDF4' }]}>
                <ArrowDownRight size={18} color="#16A34A" />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txTitle}>Reward Credited</Text>
                <Text style={styles.txDesc}>Approved Bill INV-2026-003</Text>
              </View>
              <View style={styles.txAmountCol}>
                <Text style={[styles.txAmount, { color: '#16A34A' }]}>+₹125.00</Text>
                <Text style={styles.txDate}>28 Sep 2026</Text>
              </View>
            </View>

            <View style={styles.txItem}>
              <View style={[styles.txIconBox, { backgroundColor: '#EFF6FF' }]}>
                <ArrowUpRight size={18} color="#2563EB" />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txTitle}>Payout Redeemed</Text>
                <Text style={styles.txDesc}>Transferred via UPI</Text>
              </View>
              <View style={styles.txAmountCol}>
                <Text style={[styles.txAmount, { color: '#0F172A' }]}>-₹1,000.00</Text>
                <Text style={styles.txDate}>25 Sep 2026</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Redemption Wizard Modal */}
      <RedemptionModal
        visible={showRedeemModal}
        onClose={() => setShowRedeemModal(false)}
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
    marginBottom: 18,
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
