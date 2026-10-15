import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  RefreshControl,
  Linking,
  ActivityIndicator,
} from 'react-native';
import {
  FileText,
  Calendar,
  DollarSign,
  X,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Eye,
} from 'lucide-react-native';
import Header from '../components/Header';
import { useApp } from '../context/AppContext';
import { resolveDocumentUrl } from '../services/api';

export default function BillsScreen() {
  const { theme, bills, setCurrentScreen, refreshData } = useApp();
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  const filteredBills = bills.filter(b => {
    if (filter === 'ALL') return true;
    if (filter === 'PENDING') return b.status === 'PENDING' || b.status === 'UNDER_REVIEW';
    return b.status === filter;
  });

  return (
    <View style={styles.container}>
      <Header />

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(tab => {
          const isActive = filter === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[
                styles.filterTab,
                isActive && { backgroundColor: theme.primaryColor },
              ]}
              onPress={() => setFilter(tab)}
            >
              <Text
                style={[
                  styles.filterTabText,
                  isActive && { color: '#ffffff', fontWeight: '800' },
                ]}
              >
                {tab === 'ALL' ? 'All' : tab === 'PENDING' ? 'Processing' : tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredBills.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Image
              source={require('../../assets/state_no_bills.png')}
              style={styles.emptyImage}
              resizeMode="contain"
            />
            <Text style={styles.emptyTitle}>No Bills in this section</Text>
            <Text style={styles.emptySubtitle}>Upload an invoice to see your rewards</Text>
            <TouchableOpacity
              style={[styles.uploadCta, { backgroundColor: theme.primaryColor }]}
              onPress={() => setCurrentScreen('UPLOAD_BILL')}
            >
              <Text style={styles.uploadCtaText}>+ Upload New Bill</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredBills.map((b: any) => {
            const isApproved = b.status === 'APPROVED';
            const isRejected = b.status === 'REJECTED';

            return (
              <TouchableOpacity
                key={b.id}
                style={styles.billCard}
                onPress={() => setSelectedBill(b)}
                activeOpacity={0.8}
              >
                <View style={styles.billCardHeader}>
                  <View style={styles.invoiceLeft}>
                    <FileText size={18} color={theme.primaryColor} />
                    <Text style={styles.invoiceNumber}>{b.invoiceNumber}</Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: isApproved
                          ? '#DCFCE7'
                          : isRejected
                          ? '#FEE2E2'
                          : '#FFEDD5',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color: isApproved
                            ? '#15803D'
                            : isRejected
                            ? '#B91C1C'
                            : '#C2410C',
                        },
                      ]}
                    >
                      {b.status}
                    </Text>
                  </View>
                </View>

                <View style={styles.billCardBody}>
                  <View>
                    <Text style={styles.billAmountLabel}>Bill Amount</Text>
                    <Text style={styles.billAmountValue}>
                      ₹{b.billAmount.toLocaleString('en-IN')}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.billAmountLabel}>
                      {isApproved ? 'Reward Earned' : isRejected ? 'Status' : 'Reward Status'}
                    </Text>
                    <Text
                      style={[
                        styles.rewardValue,
                        {
                          color: isApproved
                            ? '#16A34A'
                            : isRejected
                            ? '#DC2626'
                            : '#EA580C',
                        },
                      ]}
                    >
                      {isApproved
                        ? `+${Number(b.calculatedReward || 0).toLocaleString('en-IN')} Points`
                        : isRejected
                        ? 'Rejected'
                        : 'Awaiting Review'}
                    </Text>
                  </View>
                </View>

                <View style={styles.billCardFooter}>
                  <Text style={styles.dateText}>
                    Date: {new Date(b.invoiceDate).toLocaleDateString('en-IN')}
                  </Text>
                  <Text style={styles.tapDetailsText}>Tap for details →</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Bill Details Modal */}
      {selectedBill && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalInvoice}>{selectedBill.invoiceNumber}</Text>
                  <Text style={styles.modalDate}>
                    Submitted: {new Date(selectedBill.createdAt || selectedBill.invoiceDate).toLocaleDateString('en-IN')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedBill(null)} style={styles.modalClose}>
                  <X size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                <View style={styles.detailGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Invoice Amount</Text>
                    <Text style={styles.detailValue}>₹{selectedBill.billAmount.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Reward Status</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        {
                          color:
                            selectedBill.status === 'APPROVED'
                              ? '#16A34A'
                              : selectedBill.status === 'REJECTED'
                              ? '#DC2626'
                              : '#EA580C',
                        },
                      ]}
                    >
                      {selectedBill.status === 'APPROVED'
                        ? `+${Number(selectedBill.calculatedReward || 0).toLocaleString('en-IN')} Points`
                        : selectedBill.status === 'REJECTED'
                        ? 'Rejected'
                        : 'Pending Verification'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        {
                          color:
                            selectedBill.status === 'APPROVED'
                              ? '#16A34A'
                              : selectedBill.status === 'REJECTED'
                              ? '#DC2626'
                              : '#EA580C',
                        },
                      ]}
                    >
                      {selectedBill.status}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Invoice Date</Text>
                    <Text style={styles.detailValue}>
                      {new Date(selectedBill.invoiceDate).toLocaleDateString('en-IN')}
                    </Text>
                  </View>
                </View>

                {selectedBill.rejectionReason && (
                  <View style={styles.rejectionBox}>
                    <AlertTriangle size={16} color="#DC2626" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rejectionLabel}>Rejection Reason:</Text>
                      <Text style={styles.rejectionText}>{selectedBill.rejectionReason}</Text>
                    </View>
                  </View>
                )}

                {selectedBill.remarks && (
                  <View style={styles.remarksBox}>
                    <Text style={styles.remarksLabel}>Remarks:</Text>
                    <Text style={styles.remarksText}>{selectedBill.remarks}</Text>
                  </View>
                )}

                {/* Attached Document Preview / Viewer */}
                {selectedBill.fileUrl && (() => {
                  const docUrl = resolveDocumentUrl(selectedBill.fileUrl);
                  const isPdf = docUrl?.toLowerCase().includes('.pdf');
                  return (
                    <View style={styles.receiptSection}>
                      <Text style={styles.receiptSectionTitle}>Attached Receipt</Text>
                      {isPdf ? (
                        <View style={styles.pdfCard}>
                          <FileText size={28} color="#DC2626" />
                          <View style={styles.pdfCardInfo}>
                            <Text style={styles.pdfCardTitle}>PDF Invoice Document</Text>
                            <Text style={styles.pdfCardSub}>Tap below to open full document</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.openPdfBtn}
                            onPress={() => docUrl && Linking.openURL(docUrl)}
                          >
                            <ExternalLink size={14} color="#ffffff" />
                            <Text style={styles.openPdfBtnText}>Open</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.imageReceiptBox}>
                          <Image
                            source={{ uri: docUrl! }}
                            style={styles.receiptThumbnail}
                            resizeMode="contain"
                          />
                          <View style={styles.receiptBtnRow}>
                            <TouchableOpacity
                              style={styles.viewFullBtn}
                              onPress={() => setFullscreenImage(docUrl)}
                            >
                              <Eye size={14} color="#2563EB" />
                              <Text style={styles.viewFullText}>Fullscreen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.viewExternalBtn}
                              onPress={() => docUrl && Linking.openURL(docUrl)}
                            >
                              <ExternalLink size={14} color="#64748B" />
                              <Text style={styles.viewExternalText}>Open Link</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })()}

                <TouchableOpacity
                  style={[styles.closeActionBtn, { backgroundColor: theme.primaryColor }]}
                  onPress={() => setSelectedBill(null)}
                >
                  <Text style={styles.closeActionText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Fullscreen Image Preview Modal */}
      {fullscreenImage && (
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.fullscreenModalBackdrop}>
            <TouchableOpacity
              style={styles.fullscreenCloseBtn}
              onPress={() => setFullscreenImage(null)}
            >
              <X size={24} color="#ffffff" />
            </TouchableOpacity>
            <Image
              source={{ uri: fullscreenImage }}
              style={styles.fullscreenImg}
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
    backgroundColor: '#ffffff',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  filterTabText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  billCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  billCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  invoiceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  billCardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F8FAFC',
  },
  billAmountLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  billAmountValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  rewardValue: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  billCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  dateText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  tapDetailsText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyImage: {
    width: 120,
    height: 110,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  uploadCta: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 14,
  },
  uploadCtaText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 14,
  },
  modalInvoice: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
  },
  modalDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  modalClose: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 18,
    rowGap: 14,
  },
  detailItem: {
    width: '50%',
  },
  detailLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
  },
  rejectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991B1B',
  },
  rejectionText: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 2,
  },
  remarksBox: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 12,
    marginBottom: 18,
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  remarksText: {
    fontSize: 12,
    color: '#334155',
    marginTop: 2,
  },
  closeActionBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  closeActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  receiptSection: {
    marginTop: 8,
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  receiptSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  pdfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  pdfCardInfo: {
    flex: 1,
  },
  pdfCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
  },
  pdfCardSub: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
  },
  openPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    gap: 4,
  },
  openPdfBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  imageReceiptBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  receiptThumbnail: {
    width: '100%',
    height: 180,
    backgroundColor: '#0F172A',
  },
  receiptBtnRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#ffffff',
  },
  viewFullBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    borderRightWidth: 1,
    borderRightColor: '#F1F5F9',
  },
  viewFullText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  viewExternalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  viewExternalText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  fullscreenModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullscreenImg: {
    width: '94%',
    height: '80%',
  },
});
