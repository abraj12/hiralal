import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

interface AnimatedSplashScreenProps {
  onFinish: () => void;
}

export default function AnimatedSplashScreen({ onFinish }: AnimatedSplashScreenProps) {
  // Animation drivers
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(24)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const subtextTranslateY = useRef(new Animated.Value(18)).current;
  const subtextOpacity = useRef(new Animated.Value(0)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Entrance animation sequence
    Animated.sequence([
      // Stage A: Logo pops in smoothly
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 45,
          useNativeDriver: true,
        }),
      ]),

      // Stage B: Main Title "HIRALAL AND SONS" slides in
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ]),

      // Stage C: Subtitle "REWARDS PROGRAM" slides in
      Animated.parallel([
        Animated.timing(subtextOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(subtextTranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(badgeOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ]),

      // Stage D: Gentle breathing pulse for premium feel
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.04,
          duration: 350,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseScale, {
          toValue: 1.0,
          duration: 350,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),

      // Stage E: Brief hold then elegant fade out
      Animated.delay(400),
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      }),
    ]).start(() => {
      onFinish();
    });
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <View style={styles.centerBox}>
        {/* Clean Logo without any red boundary or circle */}
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: Animated.multiply(logoScale, pulseScale) }],
            },
          ]}
        >
          <Animated.Image
            source={require('../../assets/brand_logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Brand Name: HIRALAL AND SONS */}
        <Animated.View
          style={[
            styles.textWrap,
            {
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
            },
          ]}
        >
          <Text style={styles.brandTitle}>HIRALAL AND SONS</Text>
        </Animated.View>

        {/* Subtitle: REWARDS PROGRAM */}
        <Animated.View
          style={[
            styles.textWrap,
            {
              opacity: subtextOpacity,
              transform: [{ translateY: subtextTranslateY }],
            },
          ]}
        >
          <Text style={styles.brandSubtitle}>REWARDS PROGRAM</Text>
          <View style={styles.goldLine} />
        </Animated.View>

        {/* Quality Craftsmen Pill Badge */}
        <Animated.View style={[styles.badge, { opacity: badgeOpacity }]}>
          <Text style={styles.badgeText}>Plumbers & Tile Craftsmen Platform</Text>
        </Animated.View>
      </View>

      {/* Corporate CIN footer */}
      <Animated.View style={[styles.footer, { opacity: badgeOpacity }]}>
        <Text style={styles.footerText}>HIRALAL AND SONS SALES PVT. LTD.</Text>
        <Text style={styles.cinText}>Gopalganj, Bihar • CIN: U51909BR2020PTC046116</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: Math.min(width * 0.45, 170),
    height: Math.min(width * 0.45, 170),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    // Pure clean emblem, zero red borders or backgrounds
    backgroundColor: 'transparent',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  textWrap: {
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 4,
  },
  brandSubtitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B45309', // Royal Amber / Gold accent
    letterSpacing: 3,
    textAlign: 'center',
    marginTop: 2,
  },
  goldLine: {
    width: 48,
    height: 3,
    backgroundColor: '#D97706',
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 16,
  },
  badge: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    marginTop: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    letterSpacing: 0.4,
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  cinText: {
    fontSize: 9,
    fontWeight: '500',
    color: '#CBD5E1',
    marginTop: 3,
  },
});
