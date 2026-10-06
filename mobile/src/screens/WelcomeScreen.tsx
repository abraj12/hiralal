import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  useWindowDimensions,
  LayoutChangeEvent,
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

// Natural dimensions of welcome_bg.png
const BG_ORIGINAL_WIDTH = 504;
const BG_ORIGINAL_HEIGHT = 1024;
const BG_ASPECT_RATIO = BG_ORIGINAL_WIDTH / BG_ORIGINAL_HEIGHT;

// Center coordinates in 504x1024 coordinate system:
// Blue plate center (For Plumbers): X = 415, Y = 258
const BLUE_PLATE_CENTER_X = 415;
const BLUE_PLATE_CENTER_Y = 258;

// Orange plate center (For Tile Installers): X = 415, Y = 560
const ORANGE_PLATE_CENTER_X = 415;
const ORANGE_PLATE_CENTER_Y = 560;

export default function WelcomeScreen() {
  const { setCurrentScreen } = useApp();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [containerSize, setContainerSize] = useState({
    width: windowWidth,
    height: windowHeight,
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setContainerSize({ width, height });
    }
  };

  const currentW = containerSize.width || windowWidth;
  const currentH = containerSize.height || windowHeight;

  // Responsive scale factor based on container height
  const scale = currentH / BG_ORIGINAL_HEIGHT;
  const imgWidth = currentH * BG_ASPECT_RATIO;

  // Blue plate overlay positioning (pinned to right: 0)
  const blueCenterFromRight = (BG_ORIGINAL_WIDTH - BLUE_PLATE_CENTER_X) * scale;
  const blueCenterFromTop = BLUE_PLATE_CENTER_Y * scale;
  const blueBoxWidth = 140 * scale;
  const blueBoxHeight = 72 * scale;

  // Orange plate overlay positioning (pinned to right: 0)
  const orangeCenterFromRight = (BG_ORIGINAL_WIDTH - ORANGE_PLATE_CENTER_X) * scale;
  const orangeCenterFromTop = ORANGE_PLATE_CENTER_Y * scale;
  const orangeBoxWidth = 140 * scale;
  const orangeBoxHeight = 72 * scale;

  // Safe content column width ensuring it never intersects the right-side artwork
  const maxContentWidth = Math.min(currentW * 0.58, 290 * scale);

  // Scaled typography and sizing
  const headlineFontSize = Math.max(24, Math.round(28 * Math.min(scale, 1.1)));
  const headlineLineHeight = Math.round(headlineFontSize * 1.22);
  const subFontSize = Math.max(11, Math.round(12 * Math.min(scale, 1.1)));
  const subLineHeight = Math.round(subFontSize * 1.45);

  const logoSize = Math.max(50, Math.round(58 * Math.min(scale, 1.1)));
  const brandNameSize = Math.max(13, Math.round(15 * Math.min(scale, 1.1)));
  const brandSubSize = Math.max(8.5, Math.round(9.5 * Math.min(scale, 1.1)));

  const cardPadV = Math.max(7, Math.round(9 * Math.min(scale, 1.05)));
  const cardPadH = Math.max(8, Math.round(10 * Math.min(scale, 1.05)));
  const iconBoxSize = Math.max(28, Math.round(32 * Math.min(scale, 1.05)));
  const cardTitleSize = Math.max(11, Math.round(12 * Math.min(scale, 1.05)));
  const cardSubSize = Math.max(8.5, Math.round(9.5 * Math.min(scale, 1.05)));

  return (
    <View style={styles.root} onLayout={onLayout}>
      {/* 1. Background image: anchored to right edge so artwork is never cropped */}
      <Image
        source={require('../../assets/welcome_bg.png')}
        style={[
          styles.bgImage,
          {
            width: imgWidth,
            height: currentH,
          },
        ]}
        resizeMode="cover"
      />

      {/* 2. Plumber Plate Overlay: Locked directly onto the Blue Plate shape */}
      <View
        style={[
          styles.plateOverlay,
          {
            top: blueCenterFromTop - blueBoxHeight / 2,
            right: blueCenterFromRight - blueBoxWidth / 2,
            width: blueBoxWidth,
            height: blueBoxHeight,
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.plateHeaderRow}>
          <Wrench
            size={Math.max(13, Math.round(15 * Math.min(scale, 1.1)))}
            color="#FFFFFF"
            strokeWidth={2.4}
          />
          <Text
            style={[
              styles.plateForText,
              { fontSize: Math.max(8.5, Math.round(10 * Math.min(scale, 1.1))) },
            ]}
          >
            FOR
          </Text>
        </View>
        <Text
          style={[
            styles.plateMainText,
            { fontSize: Math.max(9.5, Math.round(11 * Math.min(scale, 1.1))) },
          ]}
          numberOfLines={1}
        >
          PLUMBERS
        </Text>
      </View>

      {/* 3. Tile Installer Plate Overlay: Locked directly onto the Orange Plate shape */}
      <View
        style={[
          styles.plateOverlay,
          {
            top: orangeCenterFromTop - orangeBoxHeight / 2,
            right: orangeCenterFromRight - orangeBoxWidth / 2,
            width: orangeBoxWidth,
            height: orangeBoxHeight,
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.plateHeaderRow}>
          <Grid
            size={Math.max(13, Math.round(15 * Math.min(scale, 1.1)))}
            color="#FFFFFF"
            strokeWidth={2.4}
          />
          <Text
            style={[
              styles.plateForText,
              { fontSize: Math.max(8.5, Math.round(10 * Math.min(scale, 1.1))) },
            ]}
          >
            FOR
          </Text>
        </View>
        <Text
          style={[
            styles.plateMainText,
            { fontSize: Math.max(9, Math.round(10.5 * Math.min(scale, 1.1))) },
          ]}
          numberOfLines={1}
        >
          TILE INSTALLERS
        </Text>
      </View>

      {/* 4. Foreground Content Column */}
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top content container bounded within left content column */}
          <View style={[styles.topContent, { maxWidth: maxContentWidth }]}>
            {/* Brand Header */}
            <View style={styles.brandHeader}>
              <Image
                source={require('../../assets/brand_logo.png')}
                style={{ width: logoSize, height: logoSize, marginBottom: 6 }}
                resizeMode="contain"
              />
              <Text style={[styles.brandName, { fontSize: brandNameSize }]}>
                HIRALAL AND SONS
              </Text>
              <View style={styles.subRow}>
                <View style={styles.subLine} />
                <Text style={[styles.brandSub, { fontSize: brandSubSize }]}>
                  REWARDS PROGRAM
                </Text>
                <View style={styles.subLine} />
              </View>
            </View>

            {/* Hero Headline */}
            <View style={styles.headlineContainer}>
              <Text
                style={[
                  styles.headlineDark,
                  { fontSize: headlineFontSize, lineHeight: headlineLineHeight },
                ]}
              >
                Your Work
              </Text>
              <Text
                style={[
                  styles.headlineDark,
                  { fontSize: headlineFontSize, lineHeight: headlineLineHeight },
                ]}
              >
                Deserves
              </Text>
              <Text
                style={[
                  styles.headlineRed,
                  { fontSize: headlineFontSize, lineHeight: headlineLineHeight },
                ]}
              >
                More Rewards
              </Text>
              <Text
                style={[
                  styles.headlineSub,
                  { fontSize: subFontSize, lineHeight: subLineHeight },
                ]}
              >
                Earn exciting rewards on genuine purchases from Hiralal & Sons.
              </Text>
            </View>

            {/* 3 Value Proposition Cards */}
            <View style={styles.cardsContainer}>
              {/* Card 1: Upload Bills */}
              <View
                style={[
                  styles.card,
                  styles.cardBlue,
                  { paddingVertical: cardPadV, paddingHorizontal: cardPadH },
                ]}
              >
                <View
                  style={[
                    styles.iconBox,
                    styles.iconBlue,
                    { width: iconBoxSize, height: iconBoxSize },
                  ]}
                >
                  <FileText
                    size={Math.round(iconBoxSize * 0.55)}
                    color="#1E60D5"
                    strokeWidth={2.2}
                  />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={[styles.cardTitle, { fontSize: cardTitleSize }]}>
                    Upload Bills
                  </Text>
                  <Text style={[styles.cardSub, { fontSize: cardSubSize }]}>
                    Submit genuine purchase bills
                  </Text>
                </View>
              </View>

              {/* Card 2: Earn Rewards */}
              <View
                style={[
                  styles.card,
                  styles.cardPink,
                  { paddingVertical: cardPadV, paddingHorizontal: cardPadH },
                ]}
              >
                <View
                  style={[
                    styles.iconBox,
                    styles.iconPink,
                    { width: iconBoxSize, height: iconBoxSize },
                  ]}
                >
                  <Gift
                    size={Math.round(iconBoxSize * 0.55)}
                    color="#DC2626"
                    strokeWidth={2.2}
                  />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={[styles.cardTitle, { fontSize: cardTitleSize }]}>
                    Earn Rewards
                  </Text>
                  <Text style={[styles.cardSub, { fontSize: cardSubSize }]}>
                    Get rewarded for your purchases
                  </Text>
                </View>
              </View>

              {/* Card 3: Safe & Verified */}
              <View
                style={[
                  styles.card,
                  styles.cardGreen,
                  { paddingVertical: cardPadV, paddingHorizontal: cardPadH },
                ]}
              >
                <View
                  style={[
                    styles.iconBox,
                    styles.iconGreen,
                    { width: iconBoxSize, height: iconBoxSize },
                  ]}
                >
                  <ShieldCheck
                    size={Math.round(iconBoxSize * 0.55)}
                    color="#16A34A"
                    strokeWidth={2.2}
                  />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={[styles.cardTitle, { fontSize: cardTitleSize }]}>
                    Safe & Verified
                  </Text>
                  <Text style={[styles.cardSub, { fontSize: cardSubSize }]}>
                    Trusted and secure platform
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Action Buttons spanning full width */}
          <View style={styles.actionsContainer}>
            {/* Login Button */}
            <TouchableOpacity
              style={styles.loginBtn}
              onPress={() => setCurrentScreen('LOGIN')}
              activeOpacity={0.85}
            >
              <LogIn size={20} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.loginBtnText}>Login</Text>
              <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.5} />
            </TouchableOpacity>

            {/* Create New Account Button */}
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => setCurrentScreen('REGISTER')}
              activeOpacity={0.85}
            >
              <User size={20} color="#1E60D5" strokeWidth={2.2} />
              <Text style={styles.createBtnText}>Create New Account</Text>
              <ChevronRight size={20} color="#1E60D5" strokeWidth={2.5} />
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
    overflow: 'hidden',
  },
  bgImage: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 52 : 38,
    paddingBottom: 20,
    minHeight: '100%',
    justifyContent: 'space-between',
  },
  topContent: {
    flex: 1,
  },

  // Locked directly onto the Blue & Orange Plates on the background
  plateOverlay: {
    position: 'absolute',
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
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  plateMainText: {
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  // Brand Header: Logo centered above text
  brandHeader: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 44,
  },
  brandName: {
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
    width: 14,
    height: 1.5,
    backgroundColor: '#DC2626',
  },
  brandSub: {
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1.2,
    textAlign: 'center',
  },

  // Hero Headline
  headlineContainer: {
    width: '100%',
    marginBottom: 32,
  },
  headlineDark: {
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headlineRed: {
    fontWeight: '900',
    color: '#DC2626',
    letterSpacing: -0.3,
  },
  headlineSub: {
    color: '#475569',
    marginTop: 8,
    fontWeight: '500',
  },

  // 3 Feature Cards
  cardsContainer: {
    width: '100%',
    gap: 12,
    marginBottom: 32,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSub: {
    color: '#64748B',
    marginTop: 1,
  },

  // Action Buttons
  actionsContainer: {
    width: '100%',
    gap: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 88 : 72,
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
