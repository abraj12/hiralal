import React, { useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  BackHandler,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import { ShieldAlert, Settings, Power, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { openDeveloperSettings } from '../services/security.service';

interface DeveloperModeBlockerProps {
  visible: boolean;
}

/**
 * Non-dismissible full-screen security blocker overlay.
 * Displayed on Android release builds when Developer Options or USB Debugging is detected.
 */
export const DeveloperModeBlocker: React.FC<DeveloperModeBlockerProps> = ({ visible }) => {
  useEffect(() => {
    if (!visible) return;

    // Intercept hardware back button press to safely exit app
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });

    return () => backHandler.remove();
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handleOpenSettings = async () => {
    await openDeveloperSettings();
  };

  const handleExitApp = () => {
    BackHandler.exitApp();
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleExitApp}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Security Shield Icon Header */}
          <View style={styles.iconContainer}>
            <View style={styles.outerGlow}>
              <View style={styles.innerCircle}>
                <ShieldAlert size={56} color="#DC2626" strokeWidth={2.2} />
              </View>
            </View>
          </View>

          {/* Status Badge */}
          <View style={styles.badgeWrapper}>
            <View style={styles.badge}>
              <AlertTriangle size={14} color="#B45309" strokeWidth={2.5} />
              <Text style={styles.badgeText}>BANKING-GRADE SECURITY LOCKOUT</Text>
            </View>
          </View>

          {/* Alert Title */}
          <Text style={styles.title}>Security Warning: Developer Options Active</Text>

          {/* Required Policy Description */}
          <Text style={styles.description}>
            For the safety of your rewards and wallet transactions, Hiralal Rewards cannot run
            while Developer Options or USB Debugging is active on this device. Please turn them off
            to continue.
          </Text>

          {/* Resolution Steps Card */}
          <View style={styles.stepsCard}>
            <Text style={styles.stepsHeading}>How to unlock this app:</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <Text style={styles.stepText}>
                Tap <Text style={styles.boldText}>Open Settings</Text> below to navigate directly to
                Android Developer Options.
              </Text>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <Text style={styles.stepText}>
                Turn off the toggle for <Text style={styles.boldText}>Developer options</Text> or{' '}
                <Text style={styles.boldText}>USB debugging</Text>.
              </Text>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <Text style={styles.stepText}>
                Switch back to Hiralal Rewards. The app will{' '}
                <Text style={styles.boldText}>automatically unlock</Text> without restarting.
              </Text>
            </View>
          </View>

          {/* Trust Banner */}
          <View style={styles.trustBanner}>
            <ShieldCheck size={18} color="#059669" />
            <Text style={styles.trustBannerText}>
              Your account, KYC data, and wallet balance remain 100% safe and intact.
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.85}
              onPress={handleOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Open Developer Settings"
            >
              <Settings size={20} color="#ffffff" style={styles.buttonIcon} />
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.7}
              onPress={handleExitApp}
              accessibilityRole="button"
              accessibilityLabel="Close App"
            >
              <Power size={18} color="#475569" style={styles.buttonIcon} />
              <Text style={styles.secondaryButtonText}>Close App</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

export default DeveloperModeBlocker;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  iconContainer: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerGlow: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FECACA',
  },
  innerCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWrapper: {
    marginBottom: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
  },
  description: {
    fontSize: 14.5,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  stepsCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  stepsHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E60D5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  stepText: {
    flex: 1,
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 20,
  },
  boldText: {
    fontWeight: '700',
    color: '#0F172A',
  },
  trustBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 26,
    gap: 8,
    width: '100%',
  },
  trustBannerText: {
    flex: 1,
    fontSize: 12.5,
    color: '#065F46',
    lineHeight: 18,
    fontWeight: '500',
  },
  actionContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: '#1E60D5',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonIcon: {
    marginRight: 8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  secondaryButtonText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '600',
  },
});
