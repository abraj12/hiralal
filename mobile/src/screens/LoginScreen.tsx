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
  ArrowLeft,
  Lock,
  Shield,
  AlertCircle,
  CheckCircle2,
  Phone,
  Eye,
  EyeOff,
  User,
  KeyRound,
} from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

type LoginState =
  | 'IDLE'
  | 'VALIDATING'
  | 'SUBMITTING_CREDENTIALS'
  | 'WAITING_FOR_OTP'
  | 'VERIFYING_OTP'
  | 'AUTHENTICATED'
  | 'ERROR';

export default function LoginScreen() {
  const { setCurrentScreen, login, loginAdminSession } = useApp();

  // Unified Single Input Fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Explicit Authentication State Machine
  const [loginState, setLoginState] = useState<LoginState>('IDLE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Administrator OTP Verification State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [adminOtp, setAdminOtp] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Forgot Password modal state (Real 3-step sequence)
  const [showForgot, setShowForgot] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotMobile, setForgotMobile] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotToken, setForgotToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  // Cooldown countdown timer for OTP resend
  useEffect(() => {
    let timer: any;
    if (cooldownRemaining > 0) {
      timer = setInterval(() => {
        setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  // ========================================================
  // UNIFIED LOGIN SUBMIT HANDLER
  // Backend classifies ordinary user vs configured admin identifier
  // ========================================================
  const handleUnifiedLogin = async () => {
    if (loginState === 'VALIDATING' || loginState === 'SUBMITTING_CREDENTIALS') {
      return; // Prevent duplicate submissions
    }

    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setErrorMsg('Please enter your mobile number.');
      setLoginState('ERROR');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      setLoginState('ERROR');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoginState('SUBMITTING_CREDENTIALS');

    try {
      const res = await login(trimmedId, password);

      if (res?.requiresOtp) {
        // Backend detected valid admin identifier + verified password. Issued OTP challenge.
        setChallengeToken(res.challengeToken || null);
        setAdminOtp('');
        setOtpError(null);
        setOtpInfo(res.message || 'Verification code dispatched to your registered mobile number.');
        setCooldownRemaining(res.cooldownSeconds || 60);
        setShowOtpModal(true);
        setLoginState('WAITING_FOR_OTP');
      } else {
        setLoginState('AUTHENTICATED');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid login credentials. Please check your details and try again.');
      setLoginState('ERROR');
    }
  };

  // ========================================================
  // ADMIN OTP VERIFY HANDLER
  // ========================================================
  const handleVerifyAdminOtp = async () => {
    if (loginState === 'VERIFYING_OTP') return;

    const cleanOtp = adminOtp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }

    const cleanAdminId = identifier.trim().toUpperCase().replace(/\s+/g, '');
    setOtpError(null);
    setLoginState('VERIFYING_OTP');

    try {
      const res = await MobileApiClient.verifyAdminOtp(cleanAdminId, cleanOtp, challengeToken || undefined);

      if (res.token && res.user) {
        await loginAdminSession(res.user, res.token);
        setShowOtpModal(false);
        setLoginState('AUTHENTICATED');
      } else {
        throw new Error('Failed to establish administrator session. Please retry.');
      }
    } catch (err: any) {
      setOtpError(err.message || 'Invalid or expired verification code. Please check and retry.');
      setLoginState('WAITING_FOR_OTP');
    }
  };

  // Resend Admin OTP
  const handleResendAdminOtp = async () => {
    if (cooldownRemaining > 0) return;
    const cleanAdminId = identifier.trim().toUpperCase().replace(/\s+/g, '');

    try {
      setOtpError(null);
      setOtpInfo('Requesting a new verification code...');
      const res = await MobileApiClient.requestAdminOtp(cleanAdminId, password);
      const token = res.challengeToken || res.verificationToken;
      setChallengeToken(token);
      setCooldownRemaining(res.cooldownSeconds || 60);
      setOtpInfo(res.message || 'New verification code dispatched.');
    } catch (err: any) {
      setOtpError(err.message || 'Failed to resend verification code.');
    }
  };

  // Safe Cancel / Reset from Admin OTP Challenge
  const handleCancelAdminOtp = () => {
    setShowOtpModal(false);
    setChallengeToken(null);
    setAdminOtp('');
    setOtpError(null);
    setOtpInfo(null);
    setLoginState('IDLE');
  };

  // ========================================================
  // FORGOT PASSWORD FLOW HANDLERS (Real Backend API)
  // ========================================================
  const handleSendForgotOtp = async () => {
    const clean = forgotMobile.replace(/\D/g, '').slice(-10);
    if (clean.length !== 10) {
      setForgotError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotMsg(null);

    try {
      const res = await MobileApiClient.requestPasswordReset(clean);
      setForgotStep(2);
      setForgotMsg(res.message || 'Verification OTP sent to your mobile number.');
    } catch (e: any) {
      setForgotError(e.message || 'Failed to send OTP.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleVerifyForgotOtp = async () => {
    const clean = forgotMobile.replace(/\D/g, '').slice(-10);
    if (!forgotOtp || forgotOtp.trim().length !== 6) {
      setForgotError('Please enter a valid 6-digit OTP code.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotMsg(null);

    try {
      const res = await MobileApiClient.verifyPasswordResetOtp(clean, forgotOtp.trim());
      setForgotToken(res.verificationToken);
      setForgotStep(3);
      setForgotMsg('Code verified. Enter your new password below.');
    } catch (e: any) {
      setForgotError(e.message || 'Invalid or expired OTP code.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleCompleteForgot = async () => {
    const clean = forgotMobile.replace(/\D/g, '').slice(-10);
    if (!newPassword || newPassword.length < 6) {
      setForgotError('New password must be at least 6 characters.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotMsg(null);

    try {
      const res = await MobileApiClient.completePasswordReset({
        mobile: clean,
        verificationToken: forgotToken,
        newPassword,
      });
      setShowForgot(false);
      setInfoMsg(res.message || 'Password reset successfully. Please login.');
      setIdentifier(clean);
      setPassword('');
      setLoginState('IDLE');
    } catch (e: any) {
      setForgotError(e.message || 'Password reset failed. Please retry.');
    } finally {
      setForgotLoading(false);
    }
  };

  const isSubmitting = loginState === 'SUBMITTING_CREDENTIALS' || loginState === 'VALIDATING';

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => setCurrentScreen('WELCOME')}
          activeOpacity={0.8}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Sign In</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Hiralal & Sons Branding */}
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/brand_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.brandTitle}>HIRALAL AND SONS</Text>
            <Text style={styles.brandSub}>REWARDS PLATFORM</Text>
          </View>
        </View>

        {/* Heading & Subtitle */}
        <View style={styles.welcomeBox}>
          <Text style={styles.welcomeHeading}>Welcome Back!</Text>
          <Text style={styles.welcomeDesc}>
            Sign in with your mobile number to access your account.
          </Text>
        </View>

        {/* Error Notification Banner */}
        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertCircle size={16} color="#DC2626" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Success / Info Notification Banner */}
        {infoMsg && (
          <View style={styles.infoBox}>
            <CheckCircle2 size={16} color="#059669" />
            <Text style={styles.infoText}>{infoMsg}</Text>
          </View>
        )}

        {/* Unified Login Form */}
        <View style={styles.form}>
          {/* 1. Unified Identifier Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mobile Number</Text>
            <View style={styles.inputWrapper}>
              <View style={styles.prefixBox}>
                <Text style={styles.prefixText}>🇮🇳 +91</Text>
              </View>
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={(val) => {
                  setIdentifier(val);
                  setErrorMsg(null);
                  if (loginState === 'ERROR') setLoginState('IDLE');
                }}
                placeholder="Enter your mobile number"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                maxLength={30}
                editable={!isSubmitting}
              />
            </View>
          </View>

          {/* 2. Password Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <View style={styles.iconBox}>
                <Lock size={16} color="#64748B" />
              </View>
              <TextInput
                style={[styles.input, { paddingLeft: 8 }]}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  setErrorMsg(null);
                  if (loginState === 'ERROR') setLoginState('IDLE');
                }}
                placeholder="Enter your password"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                editable={!isSubmitting}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(!showPassword)}
                activeOpacity={0.7}
              >
                {showPassword ? (
                  <EyeOff size={18} color="#64748B" />
                ) : (
                  <Eye size={18} color="#64748B" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* 3. Forgot Password Link */}
          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={() => {
              setShowForgot(true);
              setForgotStep(1);
              setForgotMobile(identifier.replace(/\D/g, '').slice(-10));
              setForgotError(null);
              setForgotMsg(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          {/* 4. Primary Sign In Button */}
          <TouchableOpacity
            style={[styles.loginBtn, isSubmitting && styles.loginBtnDisabled]}
            onPress={handleUnifiedLogin}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* 5. Create Account Navigation */}
          <View style={styles.createAccountRow}>
            <Text style={styles.noAccountText}>Don't have an account yet? </Text>
            <TouchableOpacity onPress={() => setCurrentScreen('REGISTER')}>
              <Text style={styles.createAccountLink}>Register Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* ======================================================== */}
      {/* 2-FACTOR SECURITY VERIFICATION MODAL                      */}
      {/* Sequence: Password verified -> OTP verification -> Session*/}
      {/* ======================================================== */}
      <Modal visible={showOtpModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.shieldIconWrap}>
                <Shield size={20} color="#1E60D5" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Security Verification</Text>
                <Text style={styles.modalSubTitle}>Two-Factor Security Verification</Text>
              </View>
            </View>

            <Text style={styles.modalDesc}>
              A 6-digit security code was dispatched to the mobile number associated with your account.
            </Text>

            {otpError && (
              <View style={[styles.errorBox, { marginBottom: 12 }]}>
                <AlertCircle size={14} color="#DC2626" />
                <Text style={styles.errorText}>{otpError}</Text>
              </View>
            )}

            {otpInfo && !otpError && (
              <View style={[styles.infoBox, { marginBottom: 12 }]}>
                <CheckCircle2 size={14} color="#059669" />
                <Text style={styles.infoText}>{otpInfo}</Text>
              </View>
            )}

            {/* OTP Code Input */}
            <View style={styles.otpInputWrap}>
              <TextInput
                style={styles.otpInput}
                value={adminOtp}
                onChangeText={(val) => {
                  setAdminOtp(val.replace(/\D/g, ''));
                  setOtpError(null);
                }}
                placeholder="------"
                placeholderTextColor="#CBD5E1"
                keyboardType="numeric"
                maxLength={6}
                autoFocus={true}
              />
            </View>

            {/* Resend OTP Timer Action */}
            <View style={styles.resendRow}>
              {cooldownRemaining > 0 ? (
                <Text style={styles.resendCooldownText}>
                  Resend code in {cooldownRemaining}s
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResendAdminOtp}>
                  <Text style={styles.resendActiveText}>Resend Security Code</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Verify & Sign In Action */}
            <TouchableOpacity
              style={[styles.modalBtn, loginState === 'VERIFYING_OTP' && styles.loginBtnDisabled]}
              onPress={handleVerifyAdminOtp}
              disabled={loginState === 'VERIFYING_OTP'}
              activeOpacity={0.85}
            >
              {loginState === 'VERIFYING_OTP' ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.modalBtnText}>Verify & Sign In</Text>
              )}
            </TouchableOpacity>

            {/* Cancel & Return Safely to Login */}
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={handleCancelAdminOtp}
              disabled={loginState === 'VERIFYING_OTP'}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ======================================================== */}
      {/* FORGOT PASSWORD MODAL (Real 3-Step Verification Sequence) */}
      {/* ======================================================== */}
      {showForgot && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Reset Password</Text>
              <Text style={styles.modalDesc}>
                {forgotStep === 1 && 'Enter your registered mobile number to receive a verification OTP.'}
                {forgotStep === 2 && 'Enter the 6-digit OTP code sent to your mobile.'}
                {forgotStep === 3 && 'Enter your new account password.'}
              </Text>

              {forgotError && (
                <View style={[styles.errorBox, { marginBottom: 12 }]}>
                  <AlertCircle size={14} color="#DC2626" />
                  <Text style={styles.errorText}>{forgotError}</Text>
                </View>
              )}

              {forgotMsg && (
                <View style={[styles.infoBox, { marginBottom: 12 }]}>
                  <CheckCircle2 size={14} color="#059669" />
                  <Text style={styles.infoText}>{forgotMsg}</Text>
                </View>
              )}

              {forgotStep === 1 && (
                <>
                  <TextInput
                    style={styles.modalInput}
                    value={forgotMobile}
                    onChangeText={setForgotMobile}
                    placeholder="Enter 10-digit mobile number"
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                  <TouchableOpacity
                    style={styles.modalBtn}
                    onPress={handleSendForgotOtp}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.modalBtnText}>Send Verification Code</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {forgotStep === 2 && (
                <>
                  <TextInput
                    style={styles.modalInput}
                    value={forgotOtp}
                    onChangeText={setForgotOtp}
                    placeholder="Enter 6-digit OTP"
                    keyboardType="numeric"
                    maxLength={6}
                  />
                  <TouchableOpacity
                    style={styles.modalBtn}
                    onPress={handleVerifyForgotOtp}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.modalBtnText}>Verify Code</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {forgotStep === 3 && (
                <>
                  <TextInput
                    style={styles.modalInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password (min 6 chars)"
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={styles.modalBtn}
                    onPress={handleCompleteForgot}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.modalBtnText}>Save New Password</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowForgot(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 16,
  },
  logo: {
    width: 44,
    height: 44,
    marginRight: 12,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 1,
  },
  welcomeBox: {
    marginBottom: 20,
  },
  welcomeHeading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  welcomeDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  prefixBox: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  prefixText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  iconBox: {
    paddingLeft: 12,
    paddingRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  eyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: -4,
  },
  forgotText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  loginBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnDisabled: {
    opacity: 0.65,
  },
  loginBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  createAccountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  noAccountText: {
    fontSize: 13,
    color: '#64748B',
  },
  createAccountLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E60D5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  shieldIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 16,
  },
  otpInputWrap: {
    alignItems: 'center',
    marginBottom: 14,
  },
  otpInput: {
    width: '80%',
    borderWidth: 2,
    borderColor: '#1E60D5',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: 10,
    backgroundColor: '#F8FAFC',
  },
  resendRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resendCooldownText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  resendActiveText: {
    fontSize: 12,
    color: '#1E60D5',
    fontWeight: '700',
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    marginBottom: 14,
  },
  modalBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalCancelBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  modalCancelText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
});
