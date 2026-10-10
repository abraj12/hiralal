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
} from 'react-native';
import { CheckCircle2, XCircle, LogOut, CreditCard, RefreshCw, TrendingUp } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function OperationsDashboardScreen() {
  const { user, logout } = useApp();
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Reject modal
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchPayouts = async () => {
    setLoading(true);
    try {
      const res = await MobileApiClient.getAdminPayouts('ALL');
      if (res && res.payouts) {
        setPayouts(res.payouts);
      }
    } catch (e: any) {
      console.warn('Failed to fetch payouts:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, []);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await MobileApiClient.handleAdminPayout(id, 'APPROVE');
      await fetchPayouts();
    } catch (e: any) {
      Alert.alert('Payout Approval Failed', e.message || 'Could not approve payout.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectId || !rejectReason.trim()) {
      Alert.alert('Rejection Reason Required', 'Please enter a valid rejection reason.');
      return;
    }

    setActionLoading(rejectId);
    try {
      await MobileApiClient.handleAdminPayout(rejectId, 'REJECT', rejectReason.trim());
      setRejectId(null);
      setRejectReason('');
      await fetchPayouts();
    } catch (e: any) {
      Alert.alert('Payout Rejection Failed', e.message || 'Could not reject payout.');
    } finally {
      setActionLoading(null);
    }
  };

  const pendingCount = payouts.filter(p => p.status === 'PENDING').length;
  const totalDisbursed = payouts
    .filter(p => p.status === 'SUCCESS')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const renderPayout = ({ item }: { item: any }) => {
    const isPending = item.status === 'PENDING';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.userName}>{item.userName || 'Craftsman'}</Text>
            <Text style={styles.userSub}>{item.profession || ''} • {item.userMobile || ''}</Text>
          </View>
          <View style={[styles.statusBadge, isPending ? styles.badgePending : item.status === 'SUCCESS' ? styles.badgeSuccess : styles.badgeFailed]}>
            <Text style={[styles.statusText, isPending ? styles.statusPendingText : item.status === 'SUCCESS' ? styles.statusSuccessText : styles.statusFailedText]}>
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <View>
            <Text style={styles.detailLabel}>Disbursement Account</Text>
            <Text style={styles.detailVal}>{item.paymentType}: {item.maskedAccount || 'Default'}</Text>
            <Text style={styles.detailSub}>{item.bankName || ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.detailLabel}>Amount</Text>
            <Text style={styles.amountVal}>₹{Number(item.amount || 0).toLocaleString('en-IN')}</Text>
          </View>
        </View>

        {isPending && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.btnAction, styles.btnApprove]}
              onPress={() => handleApprove(item.id)}
              disabled={actionLoading === item.id}
            >
              {actionLoading === item.id ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <CheckCircle2 size={16} color="#ffffff" />
                  <Text style={styles.btnActionText}>Approve Disbursement</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnAction, styles.btnReject]}
              onPress={() => setRejectId(item.id)}
              disabled={actionLoading === item.id}
            >
              <XCircle size={16} color="#DC2626" />
              <Text style={[styles.btnActionText, { color: '#DC2626' }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Operations Admin</Text>
          <Text style={styles.headerSub}>Payouts & Rewards • {user?.mobile || ''}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity style={styles.iconBtn} onPress={fetchPayouts}>
            <RefreshCw size={18} color="#475569" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: '#FEE2E2' }]} onPress={logout}>
            <LogOut size={18} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Overview Metric Cards */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricCard, { backgroundColor: '#EFF6FF' }]}>
          <CreditCard size={20} color="#2563EB" />
          <Text style={styles.metricVal}>{pendingCount}</Text>
          <Text style={styles.metricLabel}>Pending Payouts</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: '#ECFDF5' }]}>
          <TrendingUp size={20} color="#059669" />
          <Text style={[styles.metricVal, { color: '#059669' }]}>₹{totalDisbursed.toLocaleString('en-IN')}</Text>
          <Text style={styles.metricLabel}>Total Disbursed</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={{ marginTop: 12, color: '#64748B' }}>Loading payouts...</Text>
        </View>
      ) : (
        <FlatList
          data={payouts}
          keyExtractor={(item) => item.id}
          renderItem={renderPayout}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <CreditCard size={48} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No Payouts Found</Text>
              <Text style={styles.emptyDesc}>No withdrawal redemption requests available.</Text>
            </View>
          }
        />
      )}

      {/* Rejection Modal */}
      {rejectId && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Reject Payout</Text>
              <Text style={styles.modalDesc}>Please provide a reason. The amount will be refunded to the user's wallet.</Text>
              <TextInput
                style={styles.modalInput}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="e.g. Account name mismatch / KYC verification required"
                multiline
                numberOfLines={3}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#F1F5F9' }]}
                  onPress={() => { setRejectId(null); setRejectReason(''); }}
                >
                  <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#DC2626', flex: 1 }]}
                  onPress={handleConfirmReject}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>Reject & Refund</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  metricCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
  },
  metricVal: {
    fontSize: 20,
    fontWeight: '900',
    color: '#2563EB',
    marginTop: 8,
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  userSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgePending: {
    backgroundColor: '#FEF3C7',
  },
  badgeSuccess: {
    backgroundColor: '#D1FAE5',
  },
  badgeFailed: {
    backgroundColor: '#FEE2E2',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPendingText: {
    color: '#D97706',
  },
  statusSuccessText: {
    color: '#059669',
  },
  statusFailedText: {
    color: '#DC2626',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  detailSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  amountVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btnAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnApprove: {
    backgroundColor: '#059669',
  },
  btnReject: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  btnActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
