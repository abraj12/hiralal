import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { ArrowUpRight, CheckCircle2, Clock, XCircle, FileText } from 'lucide-react-native';
import Header from '../components/Header';
import RewardCard from '../components/RewardCard';
import StatusCards from '../components/StatusCards';
import QuickActions from '../components/QuickActions';
import ProfessionHeroBanner from '../components/ProfessionHeroBanner';
import { useApp } from '../context/AppContext';

export default function HomeScreen() {
  const { theme, bills, setActiveTab, setCurrentScreen } = useApp();

  const handleOpenUpload = () => {
    setCurrentScreen('UPLOAD_BILL');
  };

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Main Reward Card */}
        <RewardCard onPress={() => setActiveTab('WALLET')} />

        {/* Status Cards (Processing & Available) */}
        <StatusCards />

        {/* Quick Actions Shortcuts */}
        <QuickActions onUploadPress={handleOpenUpload} />

        {/* Dynamic Profession Hero Banner */}
        <ProfessionHeroBanner onUploadPress={handleOpenUpload} />

        {/* Recent Activity Section */}
        <View style={styles.recentSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{theme.recentActivityTitle}</Text>
            <TouchableOpacity onPress={() => setActiveTab('BILLS')} style={styles.viewAllBtn}>
              <Text style={[styles.viewAllText, { color: theme.primaryColor }]}>View All</Text>
              <ArrowUpRight size={14} color={theme.primaryColor} />
            </TouchableOpacity>
          </View>

          {bills.length === 0 ? (
            <View style={styles.emptyState}>
              <Image
                source={require('../../assets/state_no_bills.png')}
                style={styles.emptyImg}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>No Bills Submitted Yet</Text>
              <Text style={styles.emptySubtitle}>Upload your first bill to start earning rewards</Text>
            </View>
          ) : (
            bills.slice(0, 3).map((item: any) => {
              const isApproved = item.status === 'APPROVED';
              const isRejected = item.status === 'REJECTED';

              return (
                <View key={item.id} style={styles.billItem}>
                  <View style={styles.billLeft}>
                    <View
                      style={[
                        styles.billIconCircle,
                        {
                          backgroundColor: isApproved
                            ? '#F0FDF4'
                            : isRejected
                            ? '#FEF2F2'
                            : '#FFF7ED',
                        },
                      ]}
                    >
                      <FileText
                        size={18}
                        color={isApproved ? '#16A34A' : isRejected ? '#DC2626' : '#EA580C'}
                      />
                    </View>
                    <View>
                      <Text style={styles.billInvoiceNumber}>{item.invoiceNumber}</Text>
                      <Text style={styles.billDate}>
                        ₹{item.billAmount.toLocaleString('en-IN')} • {new Date(item.invoiceDate).toLocaleDateString('en-IN')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.billRight}>
                    <Text style={[styles.rewardAmount, { color: isApproved ? '#16A34A' : '#64748B' }]}>
                      +₹{item.calculatedReward}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
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
                          styles.statusBadgeText,
                          {
                            color: isApproved
                              ? '#15803D'
                              : isRejected
                              ? '#B91C1C'
                              : '#C2410C',
                          },
                        ]}
                      >
                        {item.status}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
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
  recentSection: {
    paddingHorizontal: 20,
    marginTop: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '700',
  },
  billItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  billLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  billIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  billInvoiceNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  billDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  billRight: {
    alignItems: 'flex-end',
  },
  rewardAmount: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
  },
  emptyImg: {
    width: 90,
    height: 80,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
});
