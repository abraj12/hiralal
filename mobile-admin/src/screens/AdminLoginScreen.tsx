import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  Lock,
  Shield,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Phone,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react-native';
import { useAdminApp } from '../context/AdminAppContext';
import { MobileApiClient } from '../services/api';

export default function AdminLoginScreen() {
  const { loginAdmin, verifyAdminOtp } = useAdminApp();

  // Multi-tier Administrative Authentication Flow:
  // Step 1: Administrator Security Prefix Gate (masked with * like password)
  // Step 2: Registered Mobile Number & Password (unlocked ONLY after prefix verification)
  // Step 3: Two-Factor Authentication (OTP Challenge)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Prefix State
  const [prefix, setPrefix] = useState('');
  const [showPrefix, setShowPrefix] = useState(false);
  const [verifiedPrefix, setVerifiedPrefix] = useState('');
  const [tier1Token, setTier1Token] = useState<string | null>(null);
  const [isVerifyingPrefix, setIsVerifyingPrefix] = useState(false);

  // Step 2: Credentials State
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmittingCredentials, setIsSubmittingCredentials] = useState(false);

  // Step 3: 2FA OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [adminOtp, setAdminOtp] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // General Feedback State
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: any;
    if (cooldownRemaining > 0) {
      timer = setInterval(() => {
        setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  // Step 1: Verify Prefix
  const handleVerifyPrefix = async () => {
    const cleanPrefix = prefix.trim().toUpperCase();
    if (!cleanPrefix) {
      setErrorMsg('Please enter your administrator security prefix.');
      return;
    }

    setIsVerifyingPrefix(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const res = await MobileApiClient.verifyPrefix(cleanPrefix);
      if (res?.verified || res?.success) {
        setVerifiedPrefix(cleanPrefix);
        if (res?.tier1Token) {
          setTier1Token(res.tier1Token);
        }
        setInfoMsg('Security prefix verified. Please enter your administrator credentials.');
        setStep(2);
      } else {
        setErrorMsg('Invalid administrator security prefix. Access denied.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid administrator security prefix. Access denied.');
    } finally {
      setIsVerifyingPrefix(false);
    }
  };

  // Step 2: Verify Credentials & Request 2FA OTP
  const handleSubmitCredentials = async () => {
    const cleanMobile = mobile.replace(/\D/g, '');
    if (!cleanMobile || cleanMobile.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit registered mobile number.');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your administrator password.');
      return;
    }

    const fullIdentifier = `${verifiedPrefix}${cleanMobile}`;
    setErrorMsg(null);
    setInfoMsg(null);
    setIsSubmittingCredentials(true);

    try {
      const res = await loginAdmin(fullIdentifier, password, tier1Token || undefined);

      if (res?.requiresOtp) {
        setChallengeToken(res.challengeToken || null);
        setAdminOtp('');
        setOtpError(null);
        setOtpInfo(res.message || `Verification code sent to registered mobile (${res.mobileMasked || '***'}).`);
        setCooldownRemaining(res.cooldownSeconds || 60);
        setShowOtpModal(true);
        setStep(3);
      } else if (res?.user) {
        // Direct session established
      } else {
        throw new Error('Authentication challenge required.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid administrator credentials. Access denied.');
    } finally {
      setIsSubmittingCredentials(false);
    }
  };

  // Step 3: Verify 2FA OTP
  const handleVerifyOtp = async () => {
    if (isVerifyingOtp) return;

    const cleanOtp = adminOtp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }

    const fullIdentifier = `${verifiedPrefix}${mobile.replace(/\D/g, '')}`;
    setOtpError(null);
    setIsVerifyingOtp(true);

    try {
      await verifyAdminOtp(fullIdentifier, cleanOtp, challengeToken || undefined);
      setShowOtpModal(false);
    } catch (err: any) {
      setOtpError(err.message || 'Invalid or expired verification code.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Step 3: Resend OTP
  const handleResendOtp = async () => {
    if (cooldownRemaining > 0) return;
    const fullIdentifier = `${verifiedPrefix}${mobile.replace(/\D/g, '')}`;

    try {
      setOtpInfo('Requesting new verification code...');
      const res = await MobileApiClient.requestAdminOtp(fullIdentifier, password);
      setChallengeToken(res.challengeToken || res.verificationToken);
      setCooldownRemaining(res.cooldownSeconds || 60);
      setOtpInfo(res.message || 'New verification code dispatched.');
      setOtpError(null);
    } catch (err: any) {
      setOtpError(err.message || 'Failed to resend verification code.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.headerArea}>
        <View style={styles.logoBadge}>
          <ShieldCheck size={36} color="#D32F2F" />
        </View>
        <Text style={styles.title}>Hiralal & Sons</Text>
        <Text style={styles.subtitle}>Administrative Operations & Bill Verification Portal</Text>
        <View style={styles.roleTag}>
          <Text style={styles.roleTagText}>AUTHORIZED PERSONNEL ONLY</Text>
        </View>
      </View>

      {/* Step Indicators */}
      <View style={styles.stepIndicatorRow}>
        <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
        <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]} />
        <View style={[styles.stepDot, step >= 3 && styles.stepDotActive]} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Administrator Sign In</Text>
        <Text style={styles.cardSub}>
          Supports <Text style={styles.boldText}>Bill Admin</Text> and{' '}
          <Text style={styles.boldText}>Operations Admin</Text> credentials.
        </Text>

        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertCircle size={18} color="#D32F2F" style={{ marginRight: 8 }} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {infoMsg && (
          <View style={styles.infoBox}>
            <CheckCircle2 size={18} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={styles.infoText}>{infoMsg}</Text>
          </View>
        )}

        {/* STEP 1: Secret Admin Prefix Gate */}
        {step === 1 && (
          <View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>ADMINISTRATOR SECURITY PREFIX</Text>
              <View style={styles.inputWrapper}>
                <Shield size={20} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { letterSpacing: 4 }]}
                  placeholder="Enter secret role prefix"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPrefix}
                  value={prefix}
                  onChangeText={setPrefix}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!isVerifyingPrefix}
                  autoFocus
                />
                <TouchableOpacity
                  onPress={() => setShowPrefix(!showPrefix)}
                  style={styles.eyeBtn}
                >
                  {showPrefix ? <EyeOff size={18} color="#64748B" /> : <Eye size={18} color="#64748B" />}
                </TouchableOpacity>
              </View>
              <Text style={styles.helperText}>
                Prefix input is masked for security. Click Verify to unlock credentials input.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, isVerifyingPrefix && styles.buttonDisabled]}
              onPress={handleVerifyPrefix}
              disabled={isVerifyingPrefix}
            >
              {isVerifyingPrefix ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View style={styles.buttonInner}>
                  <Text style={styles.submitButtonText}>Verify Prefix & Continue</Text>
                  <ShieldCheck size={18} color="#ffffff" style={{ marginLeft: 8 }} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 2: Phone Number & Password (Unlocked ONLY after Prefix is verified) */}
        {step >= 2 && (
          <View>
            {/* Verified Prefix Chip */}
            <View style={styles.prefixVerifiedChip}>
              <View style={styles.prefixVerifiedLeft}>
                <ShieldCheck size={16} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={styles.prefixVerifiedText}>
                  Security Prefix: <Text style={{ letterSpacing: 2, fontWeight: '800' }}>••••</Text> (Verified)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setStep(1);
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
              >
                <Text style={styles.changePrefixBtnText}>Change</Text>
              </TouchableOpacity>
            </View>

            {/* Registered Mobile Number */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>REGISTERED MOBILE NUMBER</Text>
              <View style={styles.inputWrapper}>
                <Phone size={20} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-digit mobile number"
                  placeholderTextColor="#94A3B8"
                  value={mobile}
                  onChangeText={(val) => setMobile(val.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                  maxLength={10}
                  autoCorrect={false}
                  editable={!isSubmittingCredentials}
                  autoFocus
                />
              </View>
            </View>

            {/* Administrator Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>ADMINISTRATOR PASSWORD</Text>
              <View style={styles.inputWrapper}>
                <Lock size={20} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter administrator password"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmittingCredentials}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  {showPassword ? <EyeOff size={18} color="#64748B" /> : <Eye size={18} color="#64748B" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit Credentials Button */}
            <TouchableOpacity
              style={[styles.submitButton, isSubmittingCredentials && styles.buttonDisabled]}
              onPress={handleSubmitCredentials}
              disabled={isSubmittingCredentials}
            >
              {isSubmittingCredentials ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View style={styles.buttonInner}>
                  <Text style={styles.submitButtonText}>Verify & Proceed to 2FA</Text>
                  <ArrowRight size={18} color="#ffffff" style={{ marginLeft: 8 }} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Security Notice */}
      <View style={styles.securityNotice}>
        <Shield size={14} color="#64748B" style={{ marginRight: 6 }} />
        <Text style={styles.securityNoticeText}>
          Protected by Prefix Gate, Hardware SecureStore & 2FA Enforcement
        </Text>
      </View>

      {/* 2FA OTP Challenge Modal */}
      <Modal visible={showOtpModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderIcon}>
              <KeyRound size={28} color="#D32F2F" />
            </View>
            <Text style={styles.modalTitle}>Two-Factor Authentication</Text>
            <Text style={styles.modalSub}>
              {otpInfo || 'Enter the 6-digit security code dispatched to your registered device.'}
            </Text>

            {otpError && (
              <View style={styles.modalErrorBox}>
                <AlertCircle size={16} color="#D32F2F" style={{ marginRight: 6 }} />
                <Text style={styles.modalErrorText}>{otpError}</Text>
              </View>
            )}

            <TextInput
              style={styles.otpInput}
              placeholder="000000"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              value={adminOtp}
              onChangeText={setAdminOtp}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.modalVerifyBtn, isVerifyingOtp && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={isVerifyingOtp}
            >
              {isVerifyingOtp ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.modalVerifyBtnText}>Establish Administrator Session</Text>
              )}
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={handleResendOtp}
                disabled={cooldownRemaining > 0}
                style={styles.resendBtn}
              >
                <Text style={[styles.resendText, cooldownRemaining > 0 && styles.resendDisabled]}>
                  {cooldownRemaining > 0 ? `Resend code in ${cooldownRemaining}s` : 'Resend Code'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowOtpModal(false);
                  setStep(2);
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0F172A',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(211, 47, 47, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(211, 47, 47, 0.4)',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 6,
    textAlign: 'center',
  },
  roleTag: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(211, 47, 47, 0.2)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(211, 47, 47, 0.5)',
  },
  roleTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  stepDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
  },
  stepDotActive: {
    backgroundColor: '#38BDF8',
    width: 36,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardSub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    marginBottom: 18,
  },
  boldText: {
    color: '#F1F5F9',
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(211, 47, 47, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    color: '#6EE7B7',
    fontSize: 13,
    flex: 1,
  },
  prefixVerifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 18,
  },
  prefixVerifiedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prefixVerifiedText: {
    color: '#BAE6FD',
    fontSize: 12,
    fontWeight: '600',
  },
  changePrefixBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 48,
    color: '#F8FAFC',
    fontSize: 14,
  },
  eyeBtn: {
    padding: 8,
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
  },
  submitButton: {
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  securityNoticeText: {
    color: '#64748B',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeaderIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(211, 47, 47, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  modalErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(211, 47, 47, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    width: '100%',
  },
  modalErrorText: {
    color: '#FCA5A5',
    fontSize: 12,
    flex: 1,
  },
  otpInput: {
    width: '100%',
    height: 56,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D32F2F',
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalVerifyBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalVerifyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalActions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  resendBtn: {
    padding: 6,
  },
  resendText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  resendDisabled: {
    color: '#64748B',
  },
  cancelBtn: {
    padding: 6,
  },
  cancelText: {
    color: '#94A3B8',
    fontSize: 12,
  },
});
