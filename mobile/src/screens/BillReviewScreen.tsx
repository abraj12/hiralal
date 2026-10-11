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
  Linking,
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
  ExternalLink,
  Eye,
} from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

interface GstRuleOption {
  id: string;
  ratePercentage: number;
  description?: string;
  isDefault?: boolean;
}

interface BillReviewConfig {
  billId: string;
  invoiceDate: string;
  profession: string;
  rewardRule: {
    id: string;
    profession: string;
    version: number;
    rewardPercentage: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
  };
  gstRules: GstRuleOption[];
}

export default function BillReviewScreen() {
  const { user, logout } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Document preview state
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Rejection modal state
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Per-bill Approval Review Modal state
  const [reviewBill, setReviewBill] = useState<any | null>(null);
  const [reviewConfig, setReviewConfig] = useState<BillReviewConfig | null>(null);
  const [reviewConfigLoading, setReviewConfigLoading] = useState(false);
  const [reviewConfigError, setReviewConfigError] = useState<string | null>(null);
  const [reviewGstIncluded, setReviewGstIncluded] = useState<boolean>(false);
  const [reviewGstRate, setReviewGstRate] = useState<number | undefined>(undefined);
  const [reviewGstRuleId, setReviewGstRuleId] = useState<string | undefined>(undefined);
  const [reviewGstOverrideReason, setReviewGstOverrideReason] = useState<string>('');

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

  const openReviewModal = async (bill: any) => {
    setReviewBill(bill);
    setDocUrl(bill.fileUrl || null);
    setDocError(null);
    setDocLoading(false);
    setReviewGstIncluded(false);
    setReviewGstOverrideReason('');
    setReviewConfig(null);
    setReviewConfigError(null);
    setReviewConfigLoading(true);

    try {
      const res = await MobileApiClient.getAdminBillReviewConfig(bill.id);
      setReviewConfig(res);
      if (res && res.gstRules && res.gstRules.length > 0) {
        const defaultRule = res.gstRules.find((r: GstRuleOption) => r.isDefault) || res.gstRules[0];
        setReviewGstRuleId(defaultRule.id);
        setReviewGstRate(Number(defaultRule.ratePercentage));
      } else {
        setReviewGstRuleId(undefined);
        setReviewGstRate(undefined);
      }
    } catch (err: any) {
      setReviewConfigError(err?.message || 'Failed to load bill review rules.');
    } finally {
      setReviewConfigLoading(false);
    }
  };

  const handleSelectGstRule = (ruleId: string) => {
    const selectedRule = reviewConfig?.gstRules.find(
      (rule: GstRuleOption) => rule.id === ruleId
    );

    if (!selectedRule) {
      setReviewGstRuleId(undefined);
      setReviewGstRate(undefined);
      return;
    }

    setReviewGstRuleId(selectedRule.id);
    setReviewGstRate(Number(selectedRule.ratePercentage));
  };

  const handleRefreshDocumentUrl = async () => {
    if (!reviewBill) return;
    setDocLoading(true);
    setDocError(null);
    try {
      const res = await MobileApiClient.getAdminBillDocumentUrl(reviewBill.id);
      if (res && res.documentUrl) {
        setDocUrl(res.documentUrl);
      } else {
        setDocError('Document URL is unavailable.');
      }
    } catch (err: any) {
      setDocError(err.message || 'Failed to refresh document link.');
    } finally {
      setDocLoading(false);
    }
  };

  const handleOpenExternal = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot Open URL', 'No application available to open this link.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to open link.');
    }
  };

  const handleConfirmApprove = async () => {
    if (!reviewBill) return;

    if (reviewConfigLoading || !reviewConfig || rewardRate === undefined) {
      Alert.alert('Configuration Missing', 'Cannot approve bill: applicable rules are unavailable.');
      return;
    }

    if (reviewGstIncluded && !reviewGstRuleId) {
      Alert.alert('GST Rule Required', 'Please select an applicable GST rule.');
      return;
    }

    setActionLoading(reviewBill.id);
    try {
      await MobileApiClient.verifyAdminBill(reviewBill.id, {
        action: 'APPROVE',
        gstIncluded: reviewGstIncluded,
        gstRate: reviewGstIncluded ? (reviewGstRate ?? 0) : 0,
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
  const currentGstRate = reviewGstRate ?? 0;
  const calculatedGst = reviewBill && reviewGstIncluded && currentGstRate > 0
    ? Math.round(((grossAmount * currentGstRate) / (100 + currentGstRate)) * 100) / 100
    : 0.0;
  const eligibleAmount = Math.max(0, Math.round((grossAmount - calculatedGst) * 100) / 100);
  const rewardRate = reviewConfig?.rewardRule?.rewardPercentage;
  const calculatedReward = rewardRate !== undefined
    ? Math.round(eligibleAmount * (rewardRate / 100) * 100) / 100
    : 0.0;

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

                {/* Document preview section */}
                <View style={styles.docSection}>
                  <View style={styles.docHeaderRow}>
                    <Text style={styles.docHeaderTitle}>Invoice Document</Text>
                    <TouchableOpacity
                      style={styles.refreshDocBtn}
                      onPress={handleRefreshDocumentUrl}
                      disabled={docLoading}
                    >
                      {docLoading ? (
                        <ActivityIndicator size="small" color="#2563EB" />
                      ) : (
                        <>
                          <RefreshCw size={13} color="#2563EB" />
                          <Text style={styles.refreshDocBtnText}>Refresh Link</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  {docLoading ? (
                    <View style={styles.docLoadingBox}>
                      <ActivityIndicator size="small" color="#2563EB" />
                      <Text style={styles.docLoadingText}>Loading secure document link...</Text>
                    </View>
                  ) : docError ? (
                    <View style={styles.docErrorBox}>
                      <AlertCircle size={16} color="#DC2626" />
                      <Text style={styles.docErrorText}>{docError}</Text>
                      <TouchableOpacity
                        style={styles.docRetryBtn}
                        onPress={handleRefreshDocumentUrl}
                      >
                        <Text style={styles.docRetryBtnText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : !docUrl ? (
                    <View style={styles.noDocBox}>
                      <FileText size={28} color="#94A3B8" />
                      <Text style={styles.noDocText}>No document preview loaded</Text>
                      <TouchableOpacity
                        style={styles.loadDocBtn}
                        onPress={handleRefreshDocumentUrl}
                        disabled={docLoading}
                      >
                        <Text style={styles.loadDocBtnText}>Fetch Document Link</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (docUrl.toLowerCase().includes('.pdf') || reviewBill.fileType === 'application/pdf') ? (
                    <View style={styles.pdfDocCard}>
                      <FileText size={32} color="#DC2626" />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.pdfCardTitle}>PDF Invoice Attached</Text>
                        <Text style={styles.pdfCardSub}>Tap below to view full document</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.openPdfBtn}
                        onPress={() => handleOpenExternal(docUrl)}
                      >
                        <ExternalLink size={14} color="#ffffff" />
                        <Text style={styles.openPdfBtnText}>Open</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.imagePreviewWrapper}>
                      <Image
                        source={{ uri: docUrl }}
                        style={styles.invoiceImagePreview}
                        resizeMode="contain"
                        onError={() => setDocError('Failed to load image. The signed URL may have expired.')}
                      />
                      <TouchableOpacity
                        style={styles.enlargeBtn}
                        onPress={() => setFullscreenImage(docUrl)}
                      >
                        <Eye size={14} color="#ffffff" />
                        <Text style={styles.enlargeBtnText}>View Fullscreen</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

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
                        ? `Deducting embedded ${reviewGstRate ?? 0}% GST via reverse formula.`
                        : 'GST deducted = ₹0. Full bill amount eligible for reward.'}
                    </Text>
                  </View>
                </TouchableOpacity>

                {reviewConfigLoading && (
                  <View style={{ padding: 12, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color="#2563EB" />
                    <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>Loading applicable rules for invoice date...</Text>
                  </View>
                )}

                {reviewConfigError && (
                  <View style={[styles.docErrorBox, { marginBottom: 12 }]}>
                    <AlertCircle size={16} color="#DC2626" />
                    <Text style={styles.docErrorText}>{reviewConfigError}</Text>
                  </View>
                )}

                {/* GST Rate Selector & Override Reason if GST is included */}
                {reviewGstIncluded && (
                  <View style={styles.gstConfigSection}>
                    <Text style={styles.rateLabel}>Applicable GST Rate:</Text>
                    {reviewConfig?.gstRules && reviewConfig.gstRules.length > 0 ? (
                      <View style={styles.rateChipsRow}>
                        {reviewConfig.gstRules.map((rule) => {
                          const isSelected = reviewGstRuleId === rule.id;
                          return (
                            <TouchableOpacity
                              key={rule.id}
                              style={[styles.rateChip, isSelected && styles.rateChipActive]}
                              onPress={() => handleSelectGstRule(rule.id)}
                            >
                              <Text style={[styles.rateChipText, isSelected && styles.rateChipTextActive]}>
                                {rule.ratePercentage}%
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={{ fontSize: 12, color: '#DC2626' }}>No GST rules available for this invoice date.</Text>
                    )}

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
                      {reviewGstIncluded ? `₹${calculatedGst.toFixed(2)} (${reviewGstRate ?? 0}%)` : '₹0.00'}
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
                      Estimated Reward ({rewardRate !== undefined ? `${rewardRate}%` : 'Unavailable'}):
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
                  style={[
                    styles.modalBtn,
                    {
                      backgroundColor: (
                        actionLoading === reviewBill.id ||
                        reviewConfigLoading ||
                        !reviewConfig ||
                        rewardRate === undefined ||
                        (reviewGstIncluded && !reviewGstRuleId)
                      ) ? '#94A3B8' : '#059669',
                      flex: 1,
                    },
                  ]}
                  onPress={handleConfirmApprove}
                  disabled={
                    actionLoading === reviewBill.id ||
                    reviewConfigLoading ||
                    !reviewConfig ||
                    rewardRate === undefined ||
                    (reviewGstIncluded && !reviewGstRuleId)
                  }
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

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.fullscreenModalOverlay}>
            <TouchableOpacity
              style={styles.fullscreenCloseBtn}
              onPress={() => setFullscreenImage(null)}
            >
              <X size={24} color="#ffffff" />
            </TouchableOpacity>
            <Image
              source={{ uri: fullscreenImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
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
  docSection: {
    marginBottom: 12,
  },
  docHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  docHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
  },
  refreshDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  refreshDocBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  docLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    gap: 8,
  },
  docLoadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  docErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  docErrorText: {
    flex: 1,
    fontSize: 12,
    color: '#B91C1C',
  },
  docRetryBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  docRetryBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  noDocBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noDocText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
    marginBottom: 8,
  },
  loadDocBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  loadDocBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  pdfDocCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  pdfCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  pdfCardSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  openPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  openPdfBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  enlargeBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  enlargeBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  fullscreenModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  fullscreenCloseBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },
  fullscreenImage: {
    width: '100%',
    height: '90%',
  },
});
