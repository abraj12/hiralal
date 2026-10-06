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
  Platform,
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function WelcomeScreen() {
  const { setCurrentScreen } = useApp();

  return (
    <View style={styles.root}>
      {/* 1. Background image covering full screen */}
      <Image
        source={require('../../assets/welcome_bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />

      {/* 2. Plumber Plate Overlay - locked directly onto the Blue Plate on background */}
      <View style={styles.bluePlateOverlay} pointerEvents="none">
        <View style={styles.plateHeaderRow}>
          <Wrench size={18} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={styles.plateForText}>FOR</Text>
        </View>
        <Text style={styles.plateMainText}>FOR PLUMBERS</Text>
      </View>

      {/* 3. Tile Installer Plate Overlay - locked directly onto the Orange Plate on background */}
      <View style={styles.orangePlateOverlay} pointerEvents="none">
        <View style={styles.plateHeaderRow}>
          <Grid size={18} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={styles.plateForText}>FOR</Text>
        </View>
        <Text style={styles.plateMainText}>TILE INSTALLERS</Text>
      </View>

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top content container */}
          <View style={styles.topContent}>
            {/* 4. Brand Header: Centered Crest Logo + Centered Company Name + Red Program Subtitle */}
            <View style={styles.brandHeader}>
              <Image
                source={require('../../assets/brand_logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.brandName}>HIRALAL AND SONS</Text>
              <View style={styles.subRow}>
                <View style={styles.subLine} />
                <Text style={styles.brandSub}>REWARDS PROGRAM</Text>
                <View style={styles.subLine} />
              </View>
            </View>

            {/* 5. Main Headline: Left aligned with 'More Rewards' in red */}
            <View style={styles.headlineContainer}>
              <Text style={styles.headlineDark}>Your Work</Text>
              <Text style={styles.headlineDark}>Deserves</Text>
              <Text style={styles.headlineRed}>More Rewards</Text>
              <Text style={styles.headlineSub}>
                Earn exciting rewards on genuine purchases from Hiralal & Sons.
              </Text>
            </View>

            {/* 6. Value Proposition Cards: Left column, soft colored backgrounds */}
            <View style={styles.cardsContainer}>
              {/* Card 1: Upload Bills */}
              <View style={[styles.card, styles.cardBlue]}>
                <View style={[styles.iconBox, styles.iconBlue]}>
                  <FileText size={18} color="#1E60D5" strokeWidth={2.2} />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={styles.cardTitle}>Upload Bills</Text>
                  <Text style={styles.cardSub}>Submit genuine purchase bills</Text>
                </View>
              </View>

              {/* Card 2: Earn Rewards */}
              <View style={[styles.card, styles.cardPink]}>
                <View style={[styles.iconBox, styles.iconPink]}>
                  <Gift size={18} color="#DC2626" strokeWidth={2.2} />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={styles.cardTitle}>Earn Rewards</Text>
                  <Text style={styles.cardSub}>Get rewarded for your purchases</Text>
                </View>
              </View>

              {/* Card 3: Safe & Verified */}
              <View style={[styles.card, styles.cardGreen]}>
                <View style={[styles.iconBox, styles.iconGreen]}>
                  <ShieldCheck size={18} color="#16A34A" strokeWidth={2.2} />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={styles.cardTitle}>Safe & Verified</Text>
                  <Text style={styles.cardSub}>Trusted and secure platform</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 7. Action Buttons at the bottom */}
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
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 10 : 4,
    paddingBottom: 24,
    minHeight: '100%',
    justifyContent: 'space-between',
  },
  topContent: {
    flex: 1,
  },

  // Locked directly onto the Blue Plate shape on the background
  bluePlateOverlay: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.23,
    right: SCREEN_WIDTH * 0.04,
    width: SCREEN_WIDTH * 0.32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  // Locked directly onto the Orange Plate shape on the background
  orangePlateOverlay: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.535,
    right: SCREEN_WIDTH * 0.04,
    width: SCREEN_WIDTH * 0.32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  plateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 2,
  },
  plateForText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  plateMainText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  // Brand Header: Logo centered above text
  brandHeader: {
    alignItems: 'center',
    width: SCREEN_WIDTH * 0.58,
    marginTop: 8,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  logo: {
    width: 60,
    height: 60,
    marginBottom: 6,
  },
  brandName: {
    fontSize: 14.5,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
    gap: 5,
  },
  subLine: {
    width: 12,
    height: 1,
    backgroundColor: '#DC2626',
  },
  brandSub: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1.2,
    textAlign: 'center',
  },

  // Headline
  headlineContainer: {
    width: SCREEN_WIDTH * 0.58,
    marginBottom: 16,
  },
  headlineDark: {
    fontSize: 27,
    fontWeight: '900',
    color: '#0F172A',
    lineHeight: 33,
    letterSpacing: -0.3,
  },
  headlineRed: {
    fontSize: 27,
    fontWeight: '900',
    color: '#DC2626',
    lineHeight: 35,
    letterSpacing: -0.3,
  },
  headlineSub: {
    fontSize: 12,
    color: '#475569',
    marginTop: 8,
    lineHeight: 17,
    fontWeight: '500',
  },

  // 3 Feature Cards
  cardsContainer: {
    width: SCREEN_WIDTH * 0.58,
    gap: 10,
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 16,
    gap: 8,
  },
  cardBlue: {
    backgroundColor: '#EFF6FF',
  },
  cardPink: {
    backgroundColor: '#FFF1F2',
  },
  cardGreen: {
    backgroundColor: '#F0FDF4',
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBlue: {
    backgroundColor: '#DBEAFE',
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
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: 9.5,
    color: '#64748B',
    marginTop: 1,
  },

  // Action Buttons
  actionsContainer: {
    width: '100%',
    gap: 12,
    paddingBottom: 8,
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
    shadowOpacity: 0.35,
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
