import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import {
  User,
  ShieldCheck,
  CreditCard,
  FileCheck,
  Lock,
  Headphones,
  FileText,
  Shield,
  LogOut,
  ChevronRight,
  X,
  Phone,
  Mail,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react-native';
import Header from '../components/Header';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function ProfileScreen() {
  const { user, theme, logout, refreshData } = useApp();
  const [eligibility, setEligibility] = useState<any>(null);

  // Modals state
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [infoModalTitle, setInfoModalTitle] = useState('');
  const [infoModalContent, setInfoModalContent] = useState('');

  // Edit Name State
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  const fetchEligibility = () => {
    MobileApiClient.getPayoutEligibility()
      .then((res) => setEligibility(res))
      .catch(() => {});
  };

  React.useEffect(() => {
    fetchEligibility();
  }, []);

  const openEditNameModal = () => {
    setFirstName(user?.firstName || (user?.fullName ? user.fullName.split(' ')[0] : ''));
    setMiddleName(user?.middleName || '');
    setLastName(user?.lastName || (user?.fullName && user.fullName.split(' ').length > 1 ? user.fullName.split(' ').slice(1).join(' ') : ''));
    setNameError('');
    setNameModalVisible(true);
  };

  const handleSaveName = async () => {
    if (!firstName.trim()) {
      setNameError('First name is required.');
      return;
    }

    try {
      setSavingName(true);
      setNameError('');
      const res = await MobileApiClient.updateProfileName({
        firstName: firstName.trim(),
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });

      if (res.success || res.user) {
        await refreshData();
        fetchEligibility();
        setNameModalVisible(false);
        Alert.alert('Success', 'Profile name updated successfully.');
      } else {
        setNameError(res.message || 'Failed to update name.');
      }
    } catch (err: any) {
      setNameError(err.message || 'Failed to update name.');
    } finally {
      setSavingName(false);
    }
  };

  const handlePasswordResetPrompt = () => {
    Alert.alert(
      'Change Security Password',
      `Would you like to send a password reset verification code to registered mobile +91 ${user?.mobile}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Code',
          onPress: async () => {
            try {
              if (user?.mobile) {
                await MobileApiClient.requestOtp(user.mobile, 'FORGOT_PASSWORD');
                Alert.alert(
                  'Code Dispatched',
                  'A verification code has been dispatched to your mobile number. You can complete password reset using the Forgot Password option.'
                );
              }
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Unable to dispatch reset code.');
            }
          },
        },
      ]
    );
  };

  const hasKyc = !!eligibility?.verifiedKyc;
  const hasAccount = !!eligibility?.verifiedAccount;
  const isNameLocked = Boolean(user?.isNameLocked);

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Worker Hero Profile Card */}
        <View style={styles.profileHeaderCard}>
          <Image
            source={theme.workerAsset}
            style={styles.avatarImage}
            resizeMode="cover"
          />

          <View style={styles.profileDetails}>
            <Text style={styles.userName}>{user?.fullName || 'Member'}</Text>
            <Text style={styles.userMobile}>+91 {user?.mobile || '----------'}</Text>
            <View style={[styles.professionPill, { backgroundColor: theme.primaryLight }]}>
              <Text style={[styles.professionPillText, { color: theme.primaryColor }]}>
                {theme.displayName}
              </Text>
            </View>
          </View>
        </View>

        {/* Verification Status Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Verification Status</Text>

          <TouchableOpacity
            style={styles.statusRow}
            activeOpacity={0.7}
            onPress={() => {
              if (hasKyc) {
                Alert.alert(
                  'PAN Identity Verified',
                  `PAN: ${eligibility.verifiedKyc.maskedPan}\nStatus: Verified\nVerified Name: ${eligibility.verifiedKyc.panName || user?.fullName}`
                );
              } else {
                Alert.alert(
                  'PAN Verification Required',
                  'To redeem rewards, please complete your PAN verification during payout redemption.'
                );
              }
            }}
          >
            <View style={styles.statusLeft}>
              <ShieldCheck size={18} color={hasKyc ? '#16A34A' : '#94A3B8'} />
              <View>
                <Text style={styles.statusTitle}>PAN Identity KYC</Text>
                <Text style={styles.statusSub}>
                  {hasKyc ? eligibility.verifiedKyc.maskedPan : 'Not verified yet'}
                </Text>
              </View>
            </View>
            <View style={hasKyc ? styles.greenBadge : styles.pendingBadge}>
              <Text style={hasKyc ? styles.greenBadgeText : styles.pendingBadgeText}>
                {hasKyc ? '✓ Verified' : 'Action Required'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.statusRow}
            activeOpacity={0.7}
            onPress={() => {
              if (hasAccount) {
                Alert.alert(
                  'Disbursement Account',
                  `Type: ${eligibility.verifiedAccount.accountType}\nAccount: ${eligibility.verifiedAccount.maskedInfo}\nStatus: Verified`
                );
              } else {
                Alert.alert(
                  'Payment Account Required',
                  'Add and verify a bank account or UPI ID to receive direct bank payouts.'
                );
              }
            }}
          >
            <View style={styles.statusLeft}>
              <CreditCard size={18} color={hasAccount ? '#16A34A' : '#94A3B8'} />
              <View>
                <Text style={styles.statusTitle}>Disbursement Account</Text>
                <Text style={styles.statusSub}>
                  {hasAccount
                    ? eligibility.verifiedAccount.maskedInfo
                    : 'Add bank account or UPI'}
                </Text>
              </View>
            </View>
            <View style={hasAccount ? styles.greenBadge : styles.pendingBadge}>
              <Text style={hasAccount ? styles.greenBadgeText : styles.pendingBadgeText}>
                {hasAccount ? '✓ Verified' : 'Action Required'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Menu Options */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Account & Support</Text>

          {/* 1. My Personal Details */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => setDetailsModalVisible(true)}
          >
            <View style={styles.menuItemLeft}>
              <User size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>My Personal Details</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 2. Payment Account Setup */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              if (hasAccount) {
                Alert.alert(
                  'Active Disbursement Method',
                  `Payment Type: ${eligibility.verifiedAccount.accountType}\nDetails: ${eligibility.verifiedAccount.maskedInfo}\nStatus: Active for 100% balance payouts.`
                );
              } else {
                Alert.alert(
                  'Setup Disbursement Account',
                  'You can add your Bank Account (IFSC) or UPI VPA directly on the Rewards Redemption tab when requesting a payout.'
                );
              }
            }}
          >
            <View style={styles.menuItemLeft}>
              <CreditCard size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>Payment Account Setup</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 3. PAN Verification */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              if (hasKyc) {
                Alert.alert(
                  'KYC Verification Status',
                  `Status: Verified\nMasked PAN: ${eligibility.verifiedKyc.maskedPan}\nYour identity is verified in accordance with Indian financial compliance.`
                );
              } else {
                Alert.alert(
                  'PAN Identity KYC',
                  'PAN verification is required before initiating rewards payouts. You can complete verification in the Rewards tab.'
                );
              }
            }}
          >
            <View style={styles.menuItemLeft}>
              <FileCheck size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>PAN Verification</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 4. Change Security Password */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={handlePasswordResetPrompt}
          >
            <View style={styles.menuItemLeft}>
              <Lock size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>Change Security Password</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 5. Help & Toll-Free Support */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => setSupportModalVisible(true)}
          >
            <View style={styles.menuItemLeft}>
              <Headphones size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>Help & Toll-Free Support</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 6. Terms & Conditions */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              setInfoModalTitle('Terms & Conditions');
              setInfoModalContent(
                'HIRALAL AND SONS SALES PVT. LTD. - REWARDS PROGRAM TERMS\n\n' +
                '1. Participation: Open to genuine plumbers and tile installation craftsmen.\n\n' +
                '2. Invoices: Invoices uploaded must represent genuine purchases of eligible materials. Duplicate or forged bills will result in immediate suspension.\n\n' +
                '3. Verification: Rewards are credited after automated GST and administrative verification.\n\n' +
                '4. Payouts: Redemptions are processed at 100% full balance to verified bank accounts or UPI IDs following PAN identity matching.\n\n' +
                '5. Fraud Protection: Any attempt to exploit system vulnerabilities or misrepresent credentials will trigger automatic account lock and audit investigation.'
              );
              setInfoModalVisible(true);
            }}
          >
            <View style={styles.menuItemLeft}>
              <FileText size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>Terms & Conditions</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          {/* 7. Privacy Policy */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              setInfoModalTitle('Privacy Policy');
              setInfoModalContent(
                'HIRALAL AND SONS SALES PVT. LTD. - PRIVACY POLICY\n\n' +
                '1. Data Collection: We collect your mobile number, full name, profession, invoice uploads, PAN details, and bank account information exclusively for rewards fulfillment and statutory tax compliance.\n\n' +
                '2. Encryption & Security: Sensitive financial information including PAN and bank accounts are encrypted with AES-256-GCM. Passwords are hash-protected with bcrypt.\n\n' +
                '3. Disclosure: We do not sell or share personal information with third parties except verified payment gateways (RazorpayX) and government tax authorities as mandated by law.\n\n' +
                '4. Session Security: Single active session enforcement protects worker accounts against unauthorized simultaneous access.'
              );
              setInfoModalVisible(true);
            }}
          >
            <View style={styles.menuItemLeft}>
              <Shield size={18} color="#64748B" />
              <Text style={styles.menuItemLabel}>Privacy Policy</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
            <LogOut size={18} color="#DC2626" />
            <Text style={styles.logoutText}>Log Out from Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* MODAL 1: Personal Details */}
      <Modal visible={detailsModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Personal Details</Text>
              <TouchableOpacity onPress={() => setDetailsModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Full Name</Text>
              <Text style={styles.detailValue}>{user?.fullName || 'Not set'}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Registered Mobile</Text>
              <Text style={styles.detailValue}>+91 {user?.mobile || '----------'}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Profession</Text>
              <Text style={styles.detailValue}>{theme.displayName}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Name Lock Status</Text>
              <Text style={[styles.detailValue, { color: isNameLocked ? '#15803D' : '#64748B' }]}>
                {isNameLocked ? '🔒 Locked (KYC Verified)' : 'Unlocked'}
              </Text>
            </View>

            <View style={{ marginTop: 20 }}>
              <TouchableOpacity
                style={[
                  styles.modalActionBtn,
                  { backgroundColor: isNameLocked ? '#E2E8F0' : theme.primaryColor },
                ]}
                disabled={isNameLocked}
                onPress={() => {
                  setDetailsModalVisible(false);
                  openEditNameModal();
                }}
              >
                <Text
                  style={[
                    styles.modalActionBtnText,
                    { color: isNameLocked ? '#94A3B8' : '#ffffff' },
                  ]}
                >
                  {isNameLocked ? 'Name Locked via KYC' : 'Edit Profile Name'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: Edit Name Modal */}
      <Modal visible={nameModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile Name</Text>
              <TouchableOpacity onPress={() => setNameModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Ensure your name matches your government PAN card for seamless payout verification.
            </Text>

            {nameError ? (
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color="#DC2626" />
                <Text style={styles.errorBannerText}>{nameError}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>First Name *</Text>
              <TextInput
                style={styles.textInput}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First Name"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Middle Name (Optional)</Text>
              <TextInput
                style={styles.textInput}
                value={middleName}
                onChangeText={setMiddleName}
                placeholder="Middle Name"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Last Name (Optional)</Text>
              <TextInput
                style={styles.textInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last Name"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <TouchableOpacity
              style={[styles.modalActionBtn, { backgroundColor: theme.primaryColor, marginTop: 14 }]}
              onPress={handleSaveName}
              disabled={savingName}
            >
              {savingName ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.modalActionBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL 3: Toll-Free Helpline & Support */}
      <Modal visible={supportModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Hiralal & Sons Support</Text>
              <TouchableOpacity onPress={() => setSupportModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.supportCard}>
              <Phone size={20} color="#2563EB" />
              <View>
                <Text style={styles.supportLabel}>Toll-Free Helpline</Text>
                <Text style={styles.supportValue}>1800-202-6000</Text>
                <Text style={styles.supportTime}>Mon – Sat, 9:00 AM – 7:00 PM IST</Text>
              </View>
            </View>

            <View style={styles.supportCard}>
              <Mail size={20} color="#16A34A" />
              <View>
                <Text style={styles.supportLabel}>Email Support</Text>
                <Text style={styles.supportValue}>support@hiralalandsons.com</Text>
                <Text style={styles.supportTime}>Response within 24 hours</Text>
              </View>
            </View>

            <View style={styles.supportCard}>
              <ShieldCheck size={20} color="#D97706" />
              <View>
                <Text style={styles.supportLabel}>Corporate Office</Text>
                <Text style={styles.supportValue}>Hiralal & Sons Sales Pvt. Ltd.</Text>
                <Text style={styles.supportTime}>Patna, Bihar, India (CIN: U51909BR2020PTC046116)</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.modalActionBtn, { backgroundColor: '#334155', marginTop: 16 }]}
              onPress={() => setSupportModalVisible(false)}
            >
              <Text style={styles.modalActionBtnText}>Close Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL 4: Information Modal (Terms / Privacy) */}
      <Modal visible={infoModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{infoModalTitle}</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ marginTop: 10, marginBottom: 16 }}>
              <Text style={styles.infoModalText}>{infoModalContent}</Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalActionBtn, { backgroundColor: '#334155' }]}
              onPress={() => setInfoModalVisible(false)}
            >
              <Text style={styles.modalActionBtnText}>Understood</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  profileDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  userMobile: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  professionPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  professionPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 14,
    borderRadius: 16,
    marginBottom: 8,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  greenBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  greenBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803D',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    marginTop: 6,
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 16,
  },
  detailRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  modalActionBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalActionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorBannerText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
    flex: 1,
  },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#F8FAFC',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  supportLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  supportValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  supportTime: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  infoModalText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
});
