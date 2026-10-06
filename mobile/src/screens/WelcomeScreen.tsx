import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import {
  FileText,
  Gift,
  ShieldCheck,
  LogIn,
  User,
  ChevronRight,
  Wrench,
  Grid,
} from 'lucide-react-native';
import { useApp } from '../context/AppContext';

const { width } = Dimensions.get('window');

export default function WelcomeScreen() {
  const { setCurrentScreen } = useApp();

  return (
    <View style={styles.root}>
      {/* 1. Background image with plumber fittings and floor tiles */}
      <Image
        source={require('../../assets/welcome_bg.png')}
        style={styles.bgImage}
        resizeMode="cover"
      />

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* 2. Top-Right Floating Badges inside the Blue & Orange Shapes */}
          <View style={styles.badgePlumber} pointerEvents="none">
            <Wrench size={22} color="#FFFFFF" />
            <Text style={styles.badgeLabelSmall}>FOR</Text>
            <Text style={styles.badgeLabelBold}>PLUMBERS</Text>
          </View>

          <View style={styles.badgeTiles} pointerEvents="none">
            <Grid size={22} color="#FFFFFF" />
            <Text style={styles.badgeLabelSmall}>FOR</Text>
            <Text style={styles.badgeLabelBold}>TILE INSTALLERS</Text>
          </View>

          {/* 3. Top-Left Brand Header */}
          <View style={styles.brandHeader}>
            <Image
              source={require('../../assets/brand_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={styles.brandTextWrap}>
              <Text style={styles.brandName}>HIRALAL AND SONS</Text>
              <View style={styles.subRow}>
                <View style={styles.subLine} />
                <Text style={styles.brandSub}>REWARDS PROGRAM</Text>
                <View style={styles.subLine} />
              </View>
            </View>
          </View>

          {/* 4. Main Headline */}
          <View style={styles.headlineContainer}>
            <Text style={styles.headlineDark}>Your Work</Text>
            <Text style={styles.headlineDark}>Deserves</Text>
            <Text style={styles.headlineRed}>More Rewards</Text>
            <Text style={styles.headlineSub}>
              Earn exciting rewards on genuine purchases from Hiralal & Sons.
            </Text>
          </View>

          {/* 5. Left Value Proposition Cards */}
          <View style={styles.cardsContainer}>
            {/* Card 1: Upload Bills */}
            <View style={[styles.card, styles.cardBlue]}>
              <View style={[styles.iconBox, styles.iconBlue]}>
                <FileText size={20} color="#1E60D5" />
              </View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>Upload Bills</Text>
                <Text style={styles.cardSub}>Submit genuine purchase bills</Text>
              </View>
            </View>

            {/* Card 2: Earn Rewards */}
            <View style={[styles.card, styles.cardPink]}>
              <View style={[styles.iconBox, styles.iconPink]}>
                <Gift size={20} color="#DC2626" />
              </View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>Earn Rewards</Text>
                <Text style={styles.cardSub}>Get rewarded for your purchases</Text>
              </View>
            </View>

            {/* Card 3: Safe & Verified */}
            <View style={[styles.card, styles.cardGreen]}>
              <View style={[styles.iconBox, styles.iconGreen]}>
                <ShieldCheck size={20} color="#16A34A" />
              </View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>Safe & Verified</Text>
                <Text style={styles.cardSub}>Trusted and secure platform</Text>
              </View>
            </View>
          </View>

          {/* 6. Primary Action Buttons */}
          <View style={styles.actionsContainer}>
            {/* Login Button */}
            <TouchableOpacity
              style={styles.loginBtn}
              onPress={() => setCurrentScreen('LOGIN')}
              activeOpacity={0.85}
            >
              <LogIn size={20} color="#FFFFFF" />
              <Text style={styles.loginBtnText}>Login</Text>
              <ChevronRight size={20} color="#FFFFFF" />
            </TouchableOpacity>

            {/* Create New Account Button */}
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => setCurrentScreen('REGISTER')}
              activeOpacity={0.85}
            >
              <User size={20} color="#1E60D5" />
              <Text style={styles.createBtnText}>Create New Account</Text>
              <ChevronRight size={20} color="#1E60D5" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    minHeight: '100%',
    justifyContent: 'space-between',
  },

  // Floating Overlay Badges on Blue & Orange Shapes
  badgePlumber: {
    position: 'absolute',
    top: 96,
    right: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  badgeTiles: {
    position: 'absolute',
    top: 316,
    right: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    maxWidth: 100,
  },
  badgeLabelSmall: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
    letterSpacing: 0.8,
  },
  badgeLabelBold: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // Brand Header
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
    maxWidth: width * 0.65,
  },
  logo: {
    width: 44,
    height: 44,
  },
  brandTextWrap: {
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  subLine: {
    width: 10,
    height: 1,
    backgroundColor: '#DC2626',
  },
  brandSub: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1,
  },

  // Main Headline
  headlineContainer: {
    maxWidth: width * 0.64,
    marginBottom: 16,
  },
  headlineDark: {
    fontSize: 27,
    fontWeight: '900',
    color: '#0F172A',
    lineHeight: 33,
  },
  headlineRed: {
    fontSize: 27,
    fontWeight: '900',
    color: '#DC2626',
    lineHeight: 33,
  },
  headlineSub: {
    fontSize: 12.5,
    color: '#475569',
    marginTop: 8,
    lineHeight: 18,
    fontWeight: '500',
  },

  // Left Value Proposition Cards
  cardsContainer: {
    maxWidth: width * 0.66,
    gap: 10,
    marginVertical: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 10,
  },
  cardBlue: {
    backgroundColor: '#F0F7FF',
  },
  cardPink: {
    backgroundColor: '#FFF1F2',
  },
  cardGreen: {
    backgroundColor: '#F0FDF4',
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBlue: {
    backgroundColor: '#E0EFFF',
  },
  iconPink: {
    backgroundColor: '#FFE4E6',
  },
  iconGreen: {
    backgroundColor: '#DCFCE7',
  },
  cardTextWrap: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },

  // Primary Action Buttons
  actionsContainer: {
    marginTop: 20,
    gap: 12,
  },
  loginBtn: {
    backgroundColor: '#1E60D5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    height: 52,
    borderRadius: 26,
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  createBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#1E60D5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    height: 50,
    borderRadius: 26,
  },
  createBtnText: {
    color: '#1E60D5',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
