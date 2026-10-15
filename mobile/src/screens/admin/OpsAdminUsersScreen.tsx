import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import {
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  XCircle,
  CreditCard,
  Wallet,
  ShieldCheck,
  Edit2,
  X,
  Phone,
  Calendar,
} from 'lucide-react-native';
import { MobileApiClient } from '../../services/api';

export default function OpsAdminUsersScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [professionFilter, setProfessionFilter] = useState<'ALL' | 'PLUMBER' | 'TILE_INSTALLER'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');

  // Selected User Modal
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Edit Name Modal
  const [editNameModal, setEditNameModal] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editReason, setEditReason] = useState('');
  const [savingName, setSavingName] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await MobileApiClient.getAdminUsers(professionFilter, statusFilter, search);
      if (res && res.users) {
        setUsers(res.users);
      }
    } catch (e: any) {
      console.warn('Failed to fetch users:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [professionFilter, statusFilter]);

  const handleSearchSubmit = () => {
    fetchUsers();
  };

  const handleOpenDetails = async (user: any) => {
    setSelectedUser(user);
    setDetailsLoading(true);
    try {
      const res = await MobileApiClient.getAdminUserDetails(user.id);
      if (res && res.user) {
        setSelectedUser({
          ...res.user,
          wallet: res.wallet,
          kycRecords: res.kyc,
          paymentAccounts: res.paymentAccounts,
          bills: res.bills,
          payouts: res.payouts,
          ledger: res.ledger,
        });
      }
    } catch (e: any) {
      console.warn('Failed to load user details:', e?.message);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleStartEditName = () => {
    if (!selectedUser) return;
    setEditFullName(selectedUser.fullName || '');
    setEditReason('');
    setEditNameModal(true);
  };

  const handleSaveName = async () => {
    if (!selectedUser) return;
    if (!editFullName.trim()) {
      Alert.alert('Name Required', 'Please enter a valid full name.');
      return;
    }
    if (!editReason.trim()) {
      Alert.alert('Reason Required', 'An audit reason is required for legal name adjustments.');
      return;
    }

    setSavingName(true);
    try {
      await MobileApiClient.updateAdminUserName(selectedUser.id, {
        fullName: editFullName.trim(),
        reason: editReason.trim(),
      });
      Alert.alert('Success', 'Craftsman name updated successfully.');
      setEditNameModal(false);
      // Refresh current user and list
      setSelectedUser((prev: any) => ({ ...prev, fullName: editFullName.trim() }));
      fetchUsers();
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update name.');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* 1. Search Bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <Search size={16} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by craftsman name or mobile..."
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
          />
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearchSubmit}>
          <Text style={styles.searchBtnText}>Find</Text>
        </TouchableOpacity>
      </View>

      {/* 2. Filter Tabs */}
      <View style={styles.filterPillsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['ALL', 'PLUMBER', 'TILE_INSTALLER'] as const).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.filterPill, professionFilter === p && styles.filterPillActive]}
              onPress={() => setProfessionFilter(p)}
            >
              <Text style={[styles.filterPillText, professionFilter === p && styles.filterPillTextActive]}>
                {p === 'ALL' ? 'All Trades' : p === 'PLUMBER' ? 'Plumbers' : 'Tile Installers'}
              </Text>
            </TouchableOpacity>
          ))}

          <View style={styles.filterDivider} />

          {(['ALL', 'ACTIVE', 'SUSPENDED'] as const).map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.filterPill, statusFilter === s && styles.filterPillActiveStatus]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.filterPillText, statusFilter === s && styles.filterPillTextActiveStatus]}>
                {s === 'ALL' ? 'All Status' : s}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 3. Users List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#DC2626" />
          <Text style={styles.loadingText}>Loading craftsmen directory...</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Users size={36} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No Craftsmen Found</Text>
              <Text style={styles.emptySub}>Try adjusting your search query or trade filter.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isPlumber = item.profession === 'PLUMBER';
            const kycVerified = (item.kycRecords || []).some((k: any) => k.panStatus === 'VERIFIED');
            const hasBank = (item.paymentAccounts || []).some((p: any) => p.isVerified);

            return (
              <TouchableOpacity
                style={styles.userCard}
                onPress={() => handleOpenDetails(item)}
                activeOpacity={0.8}
              >
                <View style={styles.userCardHeader}>
                  <View style={styles.userInfoCol}>
                    <Text style={styles.userName}>{item.fullName || 'Registered Craftsman'}</Text>
                    <View style={styles.userPhoneRow}>
                      <Phone size={11} color="#64748B" />
                      <Text style={styles.userPhone}>{item.mobile}</Text>
                    </View>
                  </View>

                  <View style={[styles.tradeBadge, { backgroundColor: isPlumber ? '#EFF6FF' : '#FFF7ED', borderColor: isPlumber ? '#2563EB' : '#EA580C' }]}>
                    <Text style={[styles.tradeBadgeText, { color: isPlumber ? '#2563EB' : '#EA580C' }]}>
                      {isPlumber ? 'PLUMBER' : 'TILE INSTALLER'}
                    </Text>
                  </View>
                </View>

                <View style={styles.userCardDetails}>
                  <View style={styles.userStatusPills}>
                    {/* KYC Badge */}
                    <View style={[styles.kycChip, { backgroundColor: kycVerified ? '#F0FDF4' : '#FEF3C7' }]}>
                      {kycVerified ? <CheckCircle2 size={11} color="#16A34A" /> : <AlertCircle size={11} color="#D97706" />}
                      <Text style={[styles.kycChipText, { color: kycVerified ? '#15803D' : '#B45309' }]}>
                        {kycVerified ? 'KYC Verified' : 'KYC Pending'}
                      </Text>
                    </View>

                    {/* Bank Status */}
                    <View style={[styles.kycChip, { backgroundColor: hasBank ? '#EFF6FF' : '#F1F5F9' }]}>
                      <CreditCard size={11} color={hasBank ? '#2563EB' : '#64748B'} />
                      <Text style={[styles.kycChipText, { color: hasBank ? '#1D4ED8' : '#475569' }]}>
                        {hasBank ? 'Bank Linked' : 'No Account'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.userWalletCol}>
                    <Text style={styles.walletBalText}>
                      Points: <Text style={{ fontWeight: '800', color: '#0F172A' }}>{Number(item.wallet?.availableBalance || 0).toLocaleString('en-IN')}</Text>
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* 4. Detailed User Modal */}
      <Modal visible={!!selectedUser && !editNameModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedUser?.fullName || 'Craftsman Profile'}</Text>
                <Text style={styles.modalSub}>{selectedUser?.mobile} • {selectedUser?.profession}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedUser(null)} style={styles.modalCloseBtn}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {detailsLoading ? (
                <ActivityIndicator size="small" color="#DC2626" style={{ marginVertical: 30 }} />
              ) : (
                <>
                  {/* Account Summary */}
                  <View style={styles.modalSectionCard}>
                    <Text style={styles.modalSectionTitle}>Wallet & Activity</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Available Cashback</Text>
                      <Text style={styles.detailValue}>
                        {Number(selectedUser?.wallet?.availableBalance || 0).toLocaleString('en-IN')} Points
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Lifetime Rewards</Text>
                      <Text style={styles.detailValue}>
                        {Number(selectedUser?.wallet?.totalEarned || 0).toLocaleString('en-IN')} Points
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Total Bills Uploaded</Text>
                      <Text style={styles.detailValue}>{selectedUser?.bills?.length || 0}</Text>
                    </View>
                  </View>

                  {/* KYC Records */}
                  <View style={styles.modalSectionCard}>
                    <Text style={styles.modalSectionTitle}>PAN Identity Verification</Text>
                    {selectedUser?.kycRecords && selectedUser.kycRecords.length > 0 ? (
                      selectedUser.kycRecords.map((kyc: any) => (
                        <View key={kyc.id} style={styles.kycRow}>
                          <View>
                            <Text style={styles.kycPanNumber}>{kyc.panNumber || 'PAN Record'}</Text>
                            <Text style={styles.kycName}>{kyc.panHolderName || selectedUser.fullName}</Text>
                          </View>
                          <View style={[styles.statusChip, { backgroundColor: kyc.panStatus === 'VERIFIED' ? '#F0FDF4' : '#FEF3C7' }]}>
                            <Text style={[styles.statusChipText, { color: kyc.panStatus === 'VERIFIED' ? '#16A34A' : '#D97706' }]}>
                              {kyc.panStatus}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptySectionText}>No PAN identity documents uploaded.</Text>
                    )}
                  </View>

                  {/* Bank Accounts */}
                  <View style={styles.modalSectionCard}>
                    <Text style={styles.modalSectionTitle}>Disbursement Account</Text>
                    {selectedUser?.paymentAccounts && selectedUser.paymentAccounts.length > 0 ? (
                      selectedUser.paymentAccounts.map((acc: any) => (
                        <View key={acc.id} style={styles.bankRow}>
                          <View>
                            <Text style={styles.bankAccountType}>{acc.accountType} • {acc.accountNumber || acc.upiId}</Text>
                            <Text style={styles.bankName}>{acc.bankName || acc.accountHolderName}</Text>
                          </View>
                          <View style={[styles.statusChip, { backgroundColor: acc.isVerified ? '#F0FDF4' : '#FEF3C7' }]}>
                            <Text style={[styles.statusChipText, { color: acc.isVerified ? '#16A34A' : '#D97706' }]}>
                              {acc.isVerified ? 'VERIFIED' : 'PENDING'}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptySectionText}>No disbursement bank account linked.</Text>
                    )}
                  </View>

                  {/* Actions */}
                  <TouchableOpacity
                    style={styles.editNameBtn}
                    onPress={handleStartEditName}
                    activeOpacity={0.8}
                  >
                    <Edit2 size={16} color="#1D4ED8" />
                    <Text style={styles.editNameBtnText}>Correct Craftsman Legal Name</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 5. Edit Name Modal */}
      <Modal visible={editNameModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContainer, { maxHeight: 380 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Correct Craftsman Name</Text>
              <TouchableOpacity onPress={() => setEditNameModal(false)}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>

            <View style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>Full Legal Name *</Text>
              <TextInput
                style={styles.modalTextInput}
                value={editFullName}
                onChangeText={setEditFullName}
                placeholder="e.g. Raj Kumar Sharma"
              />

              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Audit Reason *</Text>
              <TextInput
                style={styles.modalTextInput}
                value={editReason}
                onChangeText={setEditReason}
                placeholder="e.g. Corrected spelling per PAN card"
              />

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setEditNameModal(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveName}
                  disabled={savingName}
                >
                  {savingName ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Update Name</Text>
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
  searchRow: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 38,
    fontSize: 12.5,
    color: '#0F172A',
  },
  searchBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
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
  filterPillActiveStatus: {
    backgroundColor: '#0F172A',
  },
  filterPillTextActiveStatus: {
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
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  userCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  userInfoCol: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  userPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  userPhone: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  tradeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  tradeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  userCardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 8,
  },
  userStatusPills: {
    flexDirection: 'row',
    gap: 6,
  },
  kycChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kycChipText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  userWalletCol: {
    alignItems: 'flex-end',
  },
  walletBalText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  emptyWrap: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
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
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: 16,
  },
  modalSectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalSectionTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  kycRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kycPanNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  kycName: {
    fontSize: 11,
    color: '#64748B',
  },
  bankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bankAccountType: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  bankName: {
    fontSize: 11,
    color: '#64748B',
  },
  emptySectionText: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  editNameBtn: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginVertical: 10,
    marginBottom: 30,
  },
  editNameBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 4,
  },
  modalTextInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    backgroundColor: '#F8FAFC',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
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
  saveBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
