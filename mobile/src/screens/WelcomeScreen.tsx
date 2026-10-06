import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import { Gift, ShieldCheck, Award } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

export default function WelcomeScreen() {
  const { setCurrentScreen } = useApp();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Brand Header */}
      <View style={styles.brandHeader}>
        <Image
          source={require('../../assets/brand_logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>HIRALAL AND SONS</Text>
        <Text style={styles.brandSub}>REWARDS PROGRAM</Text>
      </View>

      {/* Main Headline */}
      <View style={styles.headlineBox}>
        <Text style={styles.headlineMain}>
          More Work. <Text style={styles.headlineHighlight}>More Rewards.</Text>
        </Text>
        <Text style={styles.headlineDesc}>
          Earn exciting rewards on genuine purchases from Hiralal & Sons.
        </Text>
      </View>

      {/* 3 Value Proposition Badges */}
      <View style={styles.featuresRow}>
        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Gift size={20} color="#1E60D5" />
          </View>
          <Text style={styles.featureTitle}>Upload Bills & Earn Points</Text>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Award size={20} color="#1E60D5" />
          </View>
          <Text style={styles.featureTitle}>Redeem Exciting Rewards</Text>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <ShieldCheck size={20} color="#1E60D5" />
          </View>
          <Text style={styles.featureTitle}>100% Secure & Verified</Text>
        </View>
      </View>

      {/* Primary Action Buttons */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.primaryLoginBtn}
          onPress={() => setCurrentScreen('LOGIN')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryLoginBtnText}>Login</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.createAccountBtn}
          onPress={() => setCurrentScreen('REGISTER')}
          activeOpacity={0.85}
        >
          <Text style={styles.createAccountBtnText}>Create New Account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  brandHeader: {
    alignItems: 'center',
    paddingTop: 36,
    paddingBottom: 16,
  },
  logoImage: {
    width: 60,
    height: 50,
    marginBottom: 8,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 1,
  },
  headlineBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 10,
    marginBottom: 16,
  },
  headlineMain: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
  },
  headlineHighlight: {
    color: '#DC2626',
  },
  headlineDesc: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  featuresRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 32,
  },
  featureItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  featureTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
    lineHeight: 14,
  },
  actionsContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  primaryLoginBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryLoginBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  createAccountBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  createAccountBtnText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  demoPreviewRow: {
    marginTop: 14,
    alignItems: 'center',
  },
  demoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
  },
  demoButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  demoBtnPlumber: {
    backgroundColor: '#1E60D5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  demoBtnTiles: {
    backgroundColor: '#E65100',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  demoBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
});
