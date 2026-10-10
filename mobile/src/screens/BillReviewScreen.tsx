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
import { CheckCircle2, XCircle, LogOut, FileText, AlertCircle, RefreshCw } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function BillReviewScreen() {
  const { user, logout } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Reject modal
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await MobileApiClient.getAdminBills('ALL');
      if (res && res.bills) {
        setBills(res.bills);
      }
    } catch (e: any) {
      console.warn('Failed to fetch bills:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, []);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await MobileApiClient.verifyAdminBill(id, 'APPROVE');
      await fetchBills();
    } catch (e: any) {
      Alert.alert('Approval Failed', e.message || 'Could not approve bill.');
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
      await MobileApiClient.verifyAdminBill(rejectId, 'REJECT', rejectReason.trim());
      setRejectId(null);
      setRejectReason('');
      await fetchBills();
    } catch (e: any) {
      Alert.alert('Rejection Failed', e.message || 'Could not reject bill.');
    } finally {
      setActionLoading(null);
    }
  };

  const renderBill = ({ item }: { item: any }) => {
    const isPending = item.status === 'PENDING' || item.status === 'UNDER_REVIEW';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.invoiceNo}>Invoice #{item.invoiceNumber || item.id?.slice(0, 8)}</Text>
            <Text style={styles.dateText}>{item.invoiceDate || new Date(item.createdAt).toLocaleDateString('en-IN')}</Text>
          </View>
          <View style={[styles.statusBadge, isPending ? styles.badgePending : item.status === 'APPROVED' ? styles.badgeApproved : styles.badgeRejected]}>
            <Text style={[styles.statusText, isPending ? styles.statusPendingText : item.status === 'APPROVED' ? styles.statusApprovedText : styles.statusRejectedText]}>
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <View>
            <Text style={styles.detailLabel}>Craftsman</Text>
            <Text style={styles.detailVal}>{item.user?.fullName || 'N/A'}</Text>
            <Text style={styles.detailSub}>{item.user?.profession || ''} • {item.user?.mobile || ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.detailLabel}>Bill Amount</Text>
            <Text style={styles.amountVal}>₹{Number(item.billAmount || 0).toLocaleString('en-IN')}</Text>
            <Text style={styles.rewardVal}>Reward: ₹{Number(item.calculatedReward || 0).toLocaleString('en-IN')}</Text>
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
                  <Text style={styles.btnActionText}>Approve</Text>
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
          <Text style={styles.headerTitle}>Bill Review Admin</Text>
          <Text style={styles.headerSub}>Hiralal & Sons Portal • {user?.mobile || ''}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity style={styles.iconBtn} onPress={fetchBills}>
            <RefreshCw size={18} color="#475569" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: '#FEE2E2' }]} onPress={logout}>
            <LogOut size={18} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={{ marginTop: 12, color: '#64748B' }}>Loading bills...</Text>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(item) => item.id}
          renderItem={renderBill}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <FileText size={48} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No Bills to Review</Text>
              <Text style={styles.emptyDesc}>All uploaded invoices have been verified.</Text>
            </View>
          }
        />
      )}

      {/* Rejection Modal */}
      {rejectId && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Reject Bill</Text>
              <Text style={styles.modalDesc}>Please provide a reason for rejecting this bill invoice.</Text>
              <TextInput
                style={styles.modalInput}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="e.g. Unclear invoice photo / invalid GST"
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
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>Confirm Rejection</Text>
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
  invoiceNo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  dateText: {
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
  badgeApproved: {
    backgroundColor: '#D1FAE5',
  },
  badgeRejected: {
    backgroundColor: '#FEE2E2',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPendingText: {
    color: '#D97706',
  },
  statusApprovedText: {
    color: '#059669',
  },
  statusRejectedText: {
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
  rewardVal: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    marginTop: 1,
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
