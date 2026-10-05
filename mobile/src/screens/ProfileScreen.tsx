import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
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
  RefreshCw,
} from 'lucide-react-native';
import Header from '../components/Header';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function ProfileScreen() {
  const { user, theme, logout } = useApp();
  const [eligibility, setEligibility] = React.useState<any>(null);

  React.useEffect(() => {
    let mounted = true;
    MobileApiClient.getPayoutEligibility()
      .then((res) => {
        if (mounted) setEligibility(res);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const hasKyc = !!eligibility?.verifiedKyc;
  const hasAccount = !!eligibility?.verifiedAccount;

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

          <View style={styles.statusRow}>
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
          </View>

          <View style={styles.statusRow}>
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
          </View>
        </View>

        {/* Menu Options */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Account & Support</Text>

          {[
            { label: 'My Personal Details', icon: User },
            { label: 'Payment Account Setup', icon: CreditCard },
            { label: 'PAN Verification', icon: FileCheck },
            { label: 'Change Security Password', icon: Lock },
            { label: 'Help & Toll-Free Support', icon: Headphones },
            { label: 'Terms & Conditions', icon: FileText },
            { label: 'Privacy Policy', icon: Shield },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity key={i} style={styles.menuItem} activeOpacity={0.7}>
                <View style={styles.menuItemLeft}>
                  <Icon size={18} color="#64748B" />
                  <Text style={styles.menuItemLabel}>{item.label}</Text>
                </View>
                <ChevronRight size={16} color="#CBD5E1" />
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
            <LogOut size={18} color="#DC2626" />
            <Text style={styles.logoutText}>Log Out from Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  themeSwitcherBox: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
  },
  themeSwitcherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  themeSwitcherTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  themeSwitcherDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 10,
  },
  themeButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  themeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
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
});
