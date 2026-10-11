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
  ScrollView,
  Image,
} from 'react-native';
import {
  CheckCircle2,
  XCircle,
  LogOut,
  FileText,
  AlertCircle,
  RefreshCw,
  CheckSquare,
  Square,
  X,
} from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function BillReviewScreen() {
  const { user, logout } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Rejection modal state
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Per-bill Approval Review Modal state
  const [reviewBill, setReviewBill] = useState<any | null>(null);
  const [reviewGstIncluded, setReviewGstIncluded] = useState<boolean>(false);
  const [reviewGstRate, setReviewGstRate] = useState<number>(18.0);
  const [reviewGstRuleId, setReviewGstRuleId] = useState<string | undefined>(undefined);
  const [reviewGstOverrideReason, setReviewGstOverrideReason] = useState<string>('');
  const [gstRules, setGstRules] = useState<any[]>([]);

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

  const fetchGstRules = async () => {
    try {
      const res = await MobileApiClient.getGstRules();
      if (res && res.rules && res.rules.length > 0) {
        setGstRules(res.rules);
        const defaultRule = res.rules.find((r: any) => r.isDefault) || res.rules[0];
        if (defaultRule) {
          setReviewGstRate(Number(defaultRule.ratePercentage));
          setReviewGstRuleId(defaultRule.id);
        }
      }
    } catch (e: any) {
      console.warn('Failed to fetch GST rules:', e?.message);
    }
  };

  useEffect(() => {
    fetchBills();
    fetchGstRules();
  }, []);

  const openReviewModal = (bill: any) => {
    setReviewBill(bill);
    setReviewGstIncluded(false);
    const defaultRule = gstRules.find((r: any) => r.isDefault) || gstRules[0];
    if (defaultRule) {
      setReviewGstRate(Number(defaultRule.ratePercentage));
      setReviewGstRuleId(defaultRule.id);
    } else {
      setReviewGstRate(18.0);
      setReviewGstRuleId(undefined);
    }
    setReviewGstOverrideReason('');
  };

  const handleConfirmApprove = async () => {
    if (!reviewBill) return;

    setActionLoading(reviewBill.id);
    try {
      await MobileApiClient.verifyAdminBill(reviewBill.id, {
        action: 'APPROVE',
        gstIncluded: reviewGstIncluded,
        gstRate: reviewGstIncluded ? reviewGstRate : 0,
        gstRuleId: reviewGstIncluded ? reviewGstRuleId : undefined,
        gstOverrideReason: reviewGstOverrideReason.trim() || undefined,
      });
      setReviewBill(null);
      await fetchBills();
      Alert.alert('Bill Approved', 'The bill has been verified and reward credited.');
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

  // Live calculation for review modal
  const grossAmount = reviewBill ? Number(reviewBill.grossBillAmount || reviewBill.billAmount || 0) : 0;
  const calculatedGst = reviewBill && reviewGstIncluded && reviewGstRate > 0
    ? Math.round(((grossAmount * reviewGstRate) / (100 + reviewGstRate)) * 100) / 100
    : 0.0;
  const eligibleAmount = Math.max(0, Math.round((grossAmount - calculatedGst) * 100) / 100);
  const workerProfession = reviewBill?.user?.profession || 'PLUMBER';
  const rewardRate = workerProfession === 'PLUMBER' ? 0.50 : 0.75;
  const calculatedReward = Math.round(eligibleAmount * (rewardRate / 100) * 100) / 100;

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
              onPress={() => openReviewModal(item)}
              disabled={actionLoading === item.id}
            >
              {actionLoading === item.id ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <CheckCircle2 size={16} color="#ffffff" />
                  <Text style={styles.btnActionText}>Review & Approve</Text>
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

      {/* Per-Bill Review & Approval Modal */}
      {reviewBill && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '90%' }]}>
              <View style={styles.modalHeaderRow}>
                <View>
                  <Text style={styles.modalTitle}>Review & Verify Bill</Text>
                  <Text style={styles.modalDesc}>
                    Invoice #{reviewBill.invoiceNumber || reviewBill.id?.slice(0, 8)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setReviewBill(null)}
                  style={styles.closeIconBtn}
                >
                  <X size={18} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
                {/* Craftsman summary */}
                <View style={styles.reviewWorkerCard}>
                  <Text style={styles.reviewWorkerName}>
                    {reviewBill.user?.fullName || 'N/A'}
                  </Text>
                  <Text style={styles.reviewWorkerSub}>
                    {reviewBill.user?.profession || 'PLUMBER'} • {reviewBill.user?.mobile || ''}
                  </Text>
                  <Text style={styles.reviewGrossText}>
                    Gross Bill Total: ₹{grossAmount.toLocaleString('en-IN')}
                  </Text>
                </View>

                {/* Invoice image preview if available */}
                {reviewBill.fileUrl && (
                  <View style={styles.imagePreviewWrapper}>
                    <Image
                      source={{ uri: reviewBill.fileUrl }}
                      style={styles.invoiceImagePreview}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {/* Worker remarks if present */}
                {reviewBill.remarks && (
                  <View style={styles.remarksBox}>
                    <Text style={styles.remarksLabel}>Worker Remarks:</Text>
                    <Text style={styles.remarksContent}>{reviewBill.remarks}</Text>
                  </View>
                )}

                {/* Accessible GST Checkbox */}
                <TouchableOpacity
                  style={styles.checkboxContainer}
                  onPress={() => setReviewGstIncluded(!reviewGstIncluded)}
                  activeOpacity={0.7}
                >
                  {reviewGstIncluded ? (
                    <CheckSquare size={20} color="#2563EB" />
                  ) : (
                    <Square size={20} color="#94A3B8" />
                  )}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.checkboxLabel}>
                      GST is included in this bill total — deduct GST before calculating the reward.
                    </Text>
                    <Text style={styles.checkboxSub}>
                      {reviewGstIncluded
                        ? `Deducting embedded ${reviewGstRate}% GST via reverse formula.`
                        : 'GST deducted = ₹0. Full bill amount eligible for reward.'}
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* GST Rate Selector & Override Reason if GST is included */}
                {reviewGstIncluded && (
                  <View style={styles.gstConfigSection}>
                    <Text style={styles.rateLabel}>Applicable GST Rate:</Text>
                    <View style={styles.rateChipsRow}>
                      {[5, 12, 18, 28].map((rate) => {
                        const isSelected = reviewGstRate === rate;
                        return (
                          <TouchableOpacity
                            key={rate}
                            style={[styles.rateChip, isSelected && styles.rateChipActive]}
                            onPress={() => {
                              setReviewGstRate(rate);
                              const matched = gstRules.find((r: any) => Number(r.ratePercentage) === rate);
                              if (matched) setReviewGstRuleId(matched.id);
                            }}
                          >
                            <Text style={[styles.rateChipText, isSelected && styles.rateChipTextActive]}>
                              {rate}%
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.rateLabel, { marginTop: 10 }]}>Override Reason (Optional):</Text>
                    <TextInput
                      style={styles.overrideInput}
                      value={reviewGstOverrideReason}
                      onChangeText={setReviewGstOverrideReason}
                      placeholder="e.g. Verified tax breakdown on invoice"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>
                )}

                {/* Financial Calculation Breakdown Table */}
                <View style={styles.breakdownCard}>
                  <Text style={styles.breakdownHeader}>Calculation Breakdown</Text>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownRowLabel}>GST Deducted:</Text>
                    <Text style={styles.breakdownRowValue}>
                      {reviewGstIncluded ? `₹${calculatedGst.toFixed(2)} (${reviewGstRate}%)` : '₹0.00'}
                    </Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownRowLabel}>Eligible Reward Amount:</Text>
                    <Text style={[styles.breakdownRowValue, { color: '#2563EB' }]}>
                      ₹{eligibleAmount.toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 6 }]}>
                    <Text style={[styles.breakdownRowLabel, { fontWeight: '700' }]}>
                      Estimated Reward ({rewardRate}%):
                    </Text>
                    <Text style={[styles.breakdownRowValue, { color: '#059669', fontWeight: '800' }]}>
                      ₹{calculatedReward.toFixed(2)}
                    </Text>
                  </View>
                </View>
              </ScrollView>

              {/* Action Buttons */}
              <View style={styles.reviewModalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#F1F5F9' }]}
                  onPress={() => setReviewBill(null)}
                  disabled={actionLoading === reviewBill.id}
                >
                  <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#059669', flex: 1 }]}
                  onPress={handleConfirmApprove}
                  disabled={actionLoading === reviewBill.id}
                >
                  {actionLoading === reviewBill.id ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={{ color: '#ffffff', fontWeight: '700' }}>Confirm & Approve</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  closeIconBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  reviewWorkerCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  reviewWorkerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  reviewWorkerSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  reviewGrossText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2563EB',
    marginTop: 6,
  },
  imagePreviewWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 12,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  invoiceImagePreview: {
    width: '100%',
    height: '100%',
  },
  remarksBox: {
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  remarksContent: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  checkboxLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 17,
  },
  checkboxSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
  },
  gstConfigSection: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  rateLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  rateChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rateChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  rateChipActive: {
    backgroundColor: '#2563EB',
  },
  rateChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  rateChipTextActive: {
    color: '#ffffff',
  },
  overrideInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#0F172A',
  },
  breakdownCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  breakdownHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  breakdownRowLabel: {
    fontSize: 12,
    color: '#475569',
  },
  breakdownRowValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  reviewModalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
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
