import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
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
} from 'lucide-react-native';
import { useAdminApp } from '../context/AdminAppContext';
import { MobileApiClient } from '../services/api';

type LoginState =
  | 'IDLE'
  | 'SUBMITTING_CREDENTIALS'
  | 'WAITING_FOR_OTP'
  | 'VERIFYING_OTP'
  | 'AUTHENTICATED'
  | 'ERROR';

export default function AdminLoginScreen() {
  const { loginAdmin, verifyAdminOtp } = useAdminApp();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loginState, setLoginState] = useState<LoginState>('IDLE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 2FA OTP Challenge Modal State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [adminOtp, setAdminOtp] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    let timer: any;
    if (cooldownRemaining > 0) {
      timer = setInterval(() => {
        setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleSubmitCredentials = async () => {
    if (loginState === 'SUBMITTING_CREDENTIALS') return;

    const trimmedId = identifier.trim().toUpperCase();
    if (!trimmedId) {
      setErrorMsg('Please enter your Administrator ID or registered mobile.');
      setLoginState('ERROR');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your administrator password.');
      setLoginState('ERROR');
      return;
    }

    setErrorMsg(null);
    setLoginState('SUBMITTING_CREDENTIALS');

    try {
      const res = await loginAdmin(trimmedId, password);

      if (res?.requiresOtp) {
        setChallengeToken(res.challengeToken || null);
        setAdminOtp('');
        setOtpError(null);
        setOtpInfo(res.message || 'Verification code dispatched to your registered device.');
        setCooldownRemaining(res.cooldownSeconds || 60);
        setShowOtpModal(true);
        setLoginState('WAITING_FOR_OTP');
      } else if (res?.user) {
        // Direct session returned
        setLoginState('AUTHENTICATED');
      } else {
        throw new Error('Authentication challenge required.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid administrator credentials. Access denied.');
      setLoginState('ERROR');
    }
  };

  const handleVerifyOtp = async () => {
    if (loginState === 'VERIFYING_OTP') return;

    const cleanOtp = adminOtp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }

    const cleanAdminId = identifier.trim().toUpperCase();
    setOtpError(null);
    setLoginState('VERIFYING_OTP');

    try {
      await verifyAdminOtp(cleanAdminId, cleanOtp, challengeToken || undefined);
      setShowOtpModal(false);
      setLoginState('AUTHENTICATED');
    } catch (err: any) {
      setOtpError(err.message || 'Invalid or expired verification code.');
      setLoginState('WAITING_FOR_OTP');
    }
  };

  const handleResendOtp = async () => {
    if (cooldownRemaining > 0) return;
    const cleanAdminId = identifier.trim().toUpperCase();

    try {
      setOtpInfo('Requesting new verification code...');
      const res = await MobileApiClient.requestAdminOtp(cleanAdminId, password);
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

        {/* Admin ID / Mobile Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>ADMINISTRATOR IDENTIFIER</Text>
          <View style={styles.inputWrapper}>
            <Shield size={20} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="e.g. BA9876543210 or OP9876543210"
              placeholderTextColor="#94A3B8"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={loginState !== 'SUBMITTING_CREDENTIALS'}
            />
          </View>
        </View>

        {/* Password Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>PASSWORD</Text>
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
              editable={loginState !== 'SUBMITTING_CREDENTIALS'}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeBtn}
            >
              {showPassword ? <EyeOff size={18} color="#64748B" /> : <Eye size={18} color="#64748B" />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, loginState === 'SUBMITTING_CREDENTIALS' && styles.buttonDisabled]}
          onPress={handleSubmitCredentials}
          disabled={loginState === 'SUBMITTING_CREDENTIALS'}
        >
          {loginState === 'SUBMITTING_CREDENTIALS' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>Verify & Proceed to 2FA</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Security Notice */}
      <View style={styles.securityNotice}>
        <Shield size={14} color="#64748B" style={{ marginRight: 6 }} />
        <Text style={styles.securityNoticeText}>
          Protected by Hardware SecureStore, Play Integrity & 2FA Enforcement
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
              {otpInfo || 'Enter the 6-digit security code dispatched to your registered phone.'}
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
              style={[styles.modalVerifyBtn, loginState === 'VERIFYING_OTP' && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={loginState === 'VERIFYING_OTP'}
            >
              {loginState === 'VERIFYING_OTP' ? (
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
                onPress={() => setShowOtpModal(false)}
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
    marginBottom: 28,
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
    marginBottom: 20,
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
  inputGroup: {
    marginBottom: 18,
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
  submitButton: {
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
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
