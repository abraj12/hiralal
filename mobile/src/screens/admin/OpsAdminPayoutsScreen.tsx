import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Image,
  RefreshControl,
  ScrollView,
} from 'react-native';
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Building,
  Phone,
  Calendar,
  X,
  Wallet,
} from 'lucide-react-native';
import { MobileApiClient } from '../../services/api';

export default function OpsAdminPayoutsScreen() {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED'>('ALL');
  const [professionFilter, setProfessionFilter] = useState<'ALL' | 'PLUMBER' | 'TILE_INSTALLER'>('ALL');

  // Reject Modal
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchPayouts = async () => {
    try {
      const res = await MobileApiClient.getAdminPayouts(statusFilter, professionFilter);
      if (res && res.payouts) {
        setPayouts(res.payouts);
      }
    } catch (e: any) {
      console.warn('Failed to fetch payouts:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, [statusFilter, professionFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPayouts();
  };

  const handleApprove = async (id: string) => {
    Alert.alert(
      'Authorize Disbursement',
      'Are you sure you want to approve this cash disbursement via RazorpayX?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Authorize',
          onPress: async () => {
            setActionLoading(id);
            try {
              await MobileApiClient.handleAdminPayout(id, 'APPROVE');
              Alert.alert('Success', 'Disbursement authorized and queued for bank settlement.');
              await fetchPayouts();
            } catch (e: any) {
              Alert.alert('Approval Failed', e?.message || 'Could not approve payout.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleConfirmReject = async () => {
    if (!rejectId || !rejectReason.trim()) {
      Alert.alert('Reason Required', 'Please enter a valid rejection reason.');
      return;
    }

    setActionLoading(rejectId);
    try {
      await MobileApiClient.handleAdminPayout(rejectId, 'REJECT', rejectReason.trim());
      Alert.alert('Payout Rejected', 'Payout was declined and reward points refunded to craftsman.');
      setRejectId(null);
      setRejectReason('');
      await fetchPayouts();
    } catch (e: any) {
      Alert.alert('Rejection Failed', e?.message || 'Could not reject payout.');
    } finally {
      setActionLoading(null);
    }
  };

  const pendingCount = payouts.filter(p => p.status === 'PENDING').length;
  const pendingTotal = payouts
    .filter(p => p.status === 'PENDING')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return (
    <View style={styles.container}>
      {/* 1. Header Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, styles.summaryCardAmber]}>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>Pending Requests</Text>
            <Clock size={15} color="#D97706" />
          </View>
          <Text style={[styles.summaryValue, { color: '#B45309' }]}>
            ₹{pendingTotal.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.summaryDesc}>{pendingCount} craftsman requests</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardGreen]}>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>Settlement Engine</Text>
            <CreditCard size={15} color="#16A34A" />
          </View>
          <Text style={[styles.summaryValue, { color: '#15803D' }]}>RazorpayX</Text>
          <Text style={styles.summaryDesc}>Instant IMPS & UPI Live</Text>
        </View>
      </View>

      {/* 2. Filter Pills */}
      <View style={styles.filterPillsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'] as const).map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.filterPill, statusFilter === s && styles.filterPillActive]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.filterPillText, statusFilter === s && styles.filterPillTextActive]}>
                {s === 'ALL' ? 'All Status' : s}
              </Text>
            </TouchableOpacity>
          ))}

          <View style={styles.filterDivider} />

          {(['ALL', 'PLUMBER', 'TILE_INSTALLER'] as const).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.filterPill, professionFilter === p && styles.filterPillActiveProf]}
              onPress={() => setProfessionFilter(p)}
            >
              <Text style={[styles.filterPillText, professionFilter === p && styles.filterPillTextActiveProf]}>
                {p === 'ALL' ? 'All Trades' : p === 'PLUMBER' ? 'Plumbers' : 'Tile Artisans'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 3. Payouts List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#DC2626" />
          <Text style={styles.loadingText}>Loading payout batches...</Text>
        </View>
      ) : (
        <FlatList
          data={payouts}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Image
                source={require('../../../assets/state_payouts_settled.png')}
                style={styles.emptyImg}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>All Disbursements Settled</Text>
              <Text style={styles.emptySub}>
                There are no pending withdrawal redemption requests in the queue.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isPending = item.status === 'PENDING';
            const isApproved = item.status === 'APPROVED' || item.status === 'SUCCESS';
            const isRejected = item.status === 'REJECTED';

            const statusColor = isPending ? '#D97706' : isApproved ? '#16A34A' : '#DC2626';
            const statusBg = isPending ? '#FEF3C7' : isApproved ? '#F0FDF4' : '#FEF2F2';

            return (
              <View style={styles.payoutCard}>
                <View style={styles.payoutTop}>
                  <View>
                    <Text style={styles.craftsmanName}>{item.user?.fullName || 'Craftsman'}</Text>
                    <View style={styles.phoneRow}>
                      <Phone size={11} color="#64748B" />
                      <Text style={styles.phoneText}>{item.user?.mobile} • {item.user?.profession}</Text>
                    </View>
                  </View>

                  <View style={[styles.statusBadge, { backgroundColor: statusBg, borderColor: statusColor }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                      {item.status}
                    </Text>
                  </View>
                </View>

                {/* Account Details Box */}
                <View style={styles.accountBox}>
                  <Building size={14} color="#475569" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountTitle}>
                      {item.accountType === 'UPI' ? 'UPI Disbursement' : 'Bank Account (IMPS)'}
                    </Text>
                    <Text style={styles.accountDetail}>
                      {item.accountNumber || item.upiId || 'Direct Bank Settlement'}
                    </Text>
                  </View>
                  <Text style={styles.payoutAmountText}>
                    ₹{Number(item.amount || 0).toLocaleString('en-IN')}
                  </Text>
                </View>

                {/* Actions Row */}
                {isPending && (
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={styles.rejectBtn}
                      onPress={() => {
                        setRejectId(item.id);
                        setRejectReason('');
                      }}
                      disabled={actionLoading === item.id}
                      activeOpacity={0.8}
                    >
                      <XCircle size={15} color="#DC2626" />
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={() => handleApprove(item.id)}
                      disabled={actionLoading === item.id}
                      activeOpacity={0.8}
                    >
                      {actionLoading === item.id ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <CheckCircle2 size={15} color="#FFFFFF" />
                          <Text style={styles.approveBtnText}>Approve & Disburse</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* 4. Reject Modal */}
      <Modal visible={!!rejectId} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reject Payout Request</Text>
              <TouchableOpacity onPress={() => setRejectId(null)}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>

            <View style={{ padding: 16 }}>
              <Text style={styles.rejectPrompt}>
                Please provide an explanation for rejecting this disbursement. The claimed cashback points will be automatically refunded back to the craftsman's rewards wallet.
              </Text>

              <TextInput
                style={styles.rejectInput}
                placeholder="e.g. Bank IFSC invalid or craftsman requested postponement"
                placeholderTextColor="#94A3B8"
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setRejectId(null)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.confirmRejectBtn}
                  onPress={handleConfirmReject}
                  disabled={actionLoading === rejectId}
                >
                  {actionLoading === rejectId ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmRejectBtnText}>Confirm Rejection</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  summaryRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  summaryCardAmber: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  summaryCardGreen: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  summaryDesc: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  filterPillsRow: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 8,
  },
  filterScroll: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  filterPillActive: {
    backgroundColor: '#DC2626',
  },
  filterPillText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillActiveProf: {
    backgroundColor: '#0F172A',
  },
  filterPillTextActiveProf: {
    color: '#FFFFFF',
  },
  filterDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 4,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  emptyWrap: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyImg: {
    width: 140,
    height: 140,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
  },
  payoutCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  payoutTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  craftsmanName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  phoneText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  accountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  accountTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  accountDetail: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  payoutAmountText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  rejectBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  approveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#16A34A',
  },
  approveBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  rejectPrompt: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 12,
  },
  rejectInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 12.5,
    backgroundColor: '#F8FAFC',
    height: 80,
    textAlignVertical: 'top',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  confirmRejectBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRejectBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
