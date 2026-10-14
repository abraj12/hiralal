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
  Platform,
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
import { AdminPrefixes, validateAdminPrefixes } from '../services/adminPrefixes';
import { MobileIntegrityService, PreAuthRecoveryAttestation } from '../services/integrity.service';
import { generateSecureRequestSalt, createPasswordResetCommitment } from '../services/integrityRequestHash';

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

  // Mode & Administrator Role Selection
  const [authMode, setAuthMode] = useState<'WORKER' | 'ADMIN'>('WORKER');
  const [adminRoleChoice, setAdminRoleChoice] = useState<'BILL_ADMIN' | 'OPERATIONS_ADMIN'>('BILL_ADMIN');
  const [adminPrefixes, setAdminPrefixes] = useState<AdminPrefixes | null>(null);
  const [adminPrefixesLoading, setAdminPrefixesLoading] = useState(true);
  const [adminPrefixesError, setAdminPrefixesError] = useState<string | null>(null);

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

  // Load configured administrator prefixes dynamically from server
  const fetchAdminPrefixes = async () => {
    setAdminPrefixesLoading(true);
    setAdminPrefixesError(null);
    try {
      const res = await MobileApiClient.getAdminPrefixes();
      if (!res || !res.prefixes) {
        throw new Error('Failed to retrieve administrator prefix configuration.');
      }
      const validated = validateAdminPrefixes(res.prefixes);
      setAdminPrefixes(validated);
    } catch (err: any) {
      setAdminPrefixes(null);
      setAdminPrefixesError(
        err.message || 'Unable to retrieve administrator prefix configuration. Please tap Retry.'
      );
    } finally {
      setAdminPrefixesLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminPrefixes();
  }, []);

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
  // Worker uses mobile directly; Admin builds identifier with configured role prefix
  // ========================================================
  const handleUnifiedLogin = async () => {
    if (loginState === 'VALIDATING' || loginState === 'SUBMITTING_CREDENTIALS') {
      return; // Prevent duplicate submissions
    }

    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setErrorMsg(authMode === 'ADMIN' ? 'Please enter your administrator mobile number.' : 'Please enter your mobile number.');
      setLoginState('ERROR');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      setLoginState('ERROR');
      return;
    }

    let finalId = trimmedId;
    if (authMode === 'ADMIN') {
      if (!adminPrefixes) {
        setErrorMsg('Administrator prefix configuration is not loaded. Please tap Retry.');
        setLoginState('ERROR');
        return;
      }
      const activePrefix =
        adminRoleChoice === 'BILL_ADMIN' ? adminPrefixes.billAdmin : adminPrefixes.operationsAdmin;
      const cleanDigits = trimmedId.replace(/\D/g, '').slice(-10);
      if (trimmedId.toUpperCase().startsWith(activePrefix.toUpperCase())) {
        finalId = trimmedId.toUpperCase();
      } else if (cleanDigits.length === 10) {
        finalId = `${activePrefix}${cleanDigits}`;
      } else {
        setErrorMsg('Please enter a valid 10-digit registered mobile number.');
        setLoginState('ERROR');
        return;
      }
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoginState('SUBMITTING_CREDENTIALS');

    try {
      const res = await login(finalId, password);

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

    if (!adminPrefixes) {
      setOtpError('Administrator prefix configuration is not loaded.');
      return;
    }

    const cleanOtp = adminOtp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError('Please enter the 6-digit verification code.');
      return;
    }

    const activePrefix =
      adminRoleChoice === 'BILL_ADMIN' ? adminPrefixes.billAdmin : adminPrefixes.operationsAdmin;
    const cleanDigits = identifier.replace(/\D/g, '').slice(-10);
    const cleanAdminId = identifier.toUpperCase().startsWith(activePrefix.toUpperCase())
      ? identifier.trim().toUpperCase()
      : `${activePrefix}${cleanDigits}`;

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

    if (!adminPrefixes) {
      setOtpError('Administrator prefix configuration is not loaded.');
      return;
    }

    const activePrefix =
      adminRoleChoice === 'BILL_ADMIN' ? adminPrefixes.billAdmin : adminPrefixes.operationsAdmin;
    const cleanDigits = identifier.replace(/\D/g, '').slice(-10);
    const cleanAdminId = identifier.toUpperCase().startsWith(activePrefix.toUpperCase())
      ? identifier.trim().toUpperCase()
      : `${activePrefix}${cleanDigits}`;

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
      let attestation: PreAuthRecoveryAttestation | undefined;
      if (Platform.OS === 'android') {
        try {
          const salt = await generateSecureRequestSalt();
          const requestHash = await createPasswordResetCommitment('FORGOT_PASSWORD_REQUEST', {
            mobile: clean,
            integrityRequestSalt: salt,
          });
          attestation = await MobileIntegrityService.performPreAuthActionAttestation(
            'FORGOT_PASSWORD_REQUEST',
            requestHash,
            salt
          );
        } catch (integrityErr: any) {
          console.error('[MOBILE-INTEGRITY] Pre-auth recovery request attestation failed:', integrityErr?.message);
          throw new Error(`Device integrity attestation failed: ${integrityErr?.message || 'Unknown error'}`);
        }
      }

      const res = await MobileApiClient.requestPasswordReset(clean, attestation);
      setForgotStep(2);
      setForgotMsg(res.message || 'If an eligible account exists, a verification code will be sent.');
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
      let attestation: PreAuthRecoveryAttestation | undefined;
      if (Platform.OS === 'android') {
        try {
          const salt = await generateSecureRequestSalt();
          const requestHash = await createPasswordResetCommitment('FORGOT_PASSWORD_VERIFY', {
            mobile: clean,
            otpCode: forgotOtp.trim(),
            integrityRequestSalt: salt,
          });
          attestation = await MobileIntegrityService.performPreAuthActionAttestation(
            'FORGOT_PASSWORD_VERIFY',
            requestHash,
            salt
          );
        } catch (integrityErr: any) {
          console.error('[MOBILE-INTEGRITY] Pre-auth recovery verify attestation failed:', integrityErr?.message);
          throw new Error(`Device integrity attestation failed: ${integrityErr?.message || 'Unknown error'}`);
        }
      }

      const res = await MobileApiClient.verifyPasswordResetOtp(clean, forgotOtp.trim(), attestation);
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
      let attestation: PreAuthRecoveryAttestation | undefined;
      if (Platform.OS === 'android') {
        try {
          const salt = await generateSecureRequestSalt();
          const requestHash = await createPasswordResetCommitment('FORGOT_PASSWORD_COMPLETE', {
            mobile: clean,
            verificationToken: forgotToken,
            newPassword,
            integrityRequestSalt: salt,
          });
          attestation = await MobileIntegrityService.performPreAuthActionAttestation(
            'FORGOT_PASSWORD_COMPLETE',
            requestHash,
            salt
          );
        } catch (integrityErr: any) {
          console.error('[MOBILE-INTEGRITY] Pre-auth recovery complete attestation failed:', integrityErr?.message);
          throw new Error(`Device integrity attestation failed: ${integrityErr?.message || 'Unknown error'}`);
        }
      }

      const res = await MobileApiClient.completePasswordReset({
        mobile: clean,
        verificationToken: forgotToken,
        newPassword,
      }, attestation);
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

        {/* Mode Selector (Worker vs Administrator) */}
        <View style={styles.modeSelectorContainer}>
          <TouchableOpacity
            style={[styles.modeTab, authMode === 'WORKER' && styles.modeTabActive]}
            onPress={() => {
              setAuthMode('WORKER');
              setErrorMsg(null);
            }}
            activeOpacity={0.8}
          >
            <User size={16} color={authMode === 'WORKER' ? '#1E60D5' : '#64748B'} />
            <Text style={[styles.modeTabText, authMode === 'WORKER' && styles.modeTabTextActive]}>
              Worker
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, authMode === 'ADMIN' && styles.modeTabActive]}
            onPress={() => {
              setAuthMode('ADMIN');
              setErrorMsg(null);
            }}
            activeOpacity={0.8}
          >
            <Shield size={16} color={authMode === 'ADMIN' ? '#1E60D5' : '#64748B'} />
            <Text style={[styles.modeTabText, authMode === 'ADMIN' && styles.modeTabTextActive]}>
              Administrator
            </Text>
          </TouchableOpacity>
        </View>

        {/* If Administrator Mode: Role Selection & Prefix Indicator */}
        {authMode === 'ADMIN' && (
          <View style={styles.adminRoleSection}>
            <Text style={styles.adminRoleSectionTitle}>Select Administrator Role</Text>
            {adminPrefixesLoading && (
              <View style={styles.adminPrefixStateBox}>
                <ActivityIndicator size="small" color="#1E60D5" />
                <Text style={styles.adminPrefixStateText}>Loading administrator configuration...</Text>
              </View>
            )}
            {adminPrefixesError && (
              <View style={[styles.adminPrefixStateBox, styles.adminPrefixErrorBox]}>
                <AlertCircle size={16} color="#DC2626" />
                <Text style={styles.adminPrefixErrorText}>{adminPrefixesError}</Text>
                <TouchableOpacity
                  style={styles.adminRetryBtn}
                  onPress={fetchAdminPrefixes}
                  activeOpacity={0.8}
                >
                  <Text style={styles.adminRetryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {adminPrefixes && (
              <>
                <View style={styles.roleChipsRow}>
                  <TouchableOpacity
                    style={[
                      styles.roleChip,
                      adminRoleChoice === 'BILL_ADMIN' && styles.roleChipActive,
                    ]}
                    onPress={() => {
                      setAdminRoleChoice('BILL_ADMIN');
                      setErrorMsg(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        adminRoleChoice === 'BILL_ADMIN' && styles.roleChipTextActive,
                      ]}
                    >
                      Bill Review Admin
                    </Text>
                    <View style={[styles.prefixPill, adminRoleChoice === 'BILL_ADMIN' && styles.prefixPillActive]}>
                      <Text style={[styles.prefixPillText, adminRoleChoice === 'BILL_ADMIN' && styles.prefixPillTextActive]}>
                        {adminPrefixes.billAdmin}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.roleChip,
                      adminRoleChoice === 'OPERATIONS_ADMIN' && styles.roleChipActive,
                    ]}
                    onPress={() => {
                      setAdminRoleChoice('OPERATIONS_ADMIN');
                      setErrorMsg(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        adminRoleChoice === 'OPERATIONS_ADMIN' && styles.roleChipTextActive,
                      ]}
                    >
                      Operations Admin
                    </Text>
                    <View style={[styles.prefixPill, adminRoleChoice === 'OPERATIONS_ADMIN' && styles.prefixPillActive]}>
                      <Text style={[styles.prefixPillText, adminRoleChoice === 'OPERATIONS_ADMIN' && styles.prefixPillTextActive]}>
                        {adminPrefixes.operationsAdmin}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
                <Text style={styles.adminHintText}>
                  Logging in as {adminRoleChoice === 'BILL_ADMIN' ? 'Bill Review' : 'Operations'} Administrator. Two-factor authentication required.
                </Text>
              </>
            )}
          </View>
        )}

        {/* Unified Login Form */}
        <View style={styles.form}>
          {/* 1. Unified Identifier Field */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              {authMode === 'WORKER' ? 'Mobile Number' : 'Administrator Mobile Number'}
            </Text>
            <View style={styles.inputWrapper}>
              <View style={styles.prefixBox}>
                <Text style={styles.prefixText}>
                  {authMode === 'WORKER'
                    ? '🇮🇳 +91'
                    : adminPrefixes
                    ? adminRoleChoice === 'BILL_ADMIN'
                      ? adminPrefixes.billAdmin
                      : adminPrefixes.operationsAdmin
                    : '---'}
                </Text>
              </View>
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={(val) => {
                  setIdentifier(val);
                  setErrorMsg(null);
                  if (loginState === 'ERROR') setLoginState('IDLE');
                }}
                placeholder={
                  authMode === 'WORKER'
                    ? 'Enter your mobile number'
                    : 'Enter registered 10-digit number'
                }
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
            style={[
              styles.loginBtn,
              (isSubmitting || (authMode === 'ADMIN' && (!adminPrefixes || adminPrefixesLoading))) &&
                styles.loginBtnDisabled,
            ]}
            onPress={handleUnifiedLogin}
            disabled={isSubmitting || (authMode === 'ADMIN' && (!adminPrefixes || adminPrefixesLoading))}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* 5. Create Account Navigation (Workers only) */}
          {authMode === 'WORKER' ? (
            <View style={styles.createAccountRow}>
              <Text style={styles.noAccountText}>Don't have an account yet? </Text>
              <TouchableOpacity onPress={() => setCurrentScreen('REGISTER')}>
                <Text style={styles.createAccountLink}>Register Now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.adminNoticeRow}>
              <Shield size={14} color="#64748B" />
              <Text style={styles.adminNoticeText}>
                Administrator accounts are strictly managed by system governance.
              </Text>
            </View>
          )}
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
                <TouchableOpacity onPress={handleResendAdminOtp} disabled={!adminPrefixes}>
                  <Text style={[styles.resendActiveText, !adminPrefixes && { opacity: 0.5 }]}>
                    Resend Security Code
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Verify & Sign In Action */}
            <TouchableOpacity
              style={[
                styles.modalBtn,
                (loginState === 'VERIFYING_OTP' || !adminPrefixes) && styles.loginBtnDisabled,
              ]}
              onPress={handleVerifyAdminOtp}
              disabled={loginState === 'VERIFYING_OTP' || !adminPrefixes}
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
  modeSelectorContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    gap: 6,
  },
  modeTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modeTabTextActive: {
    color: '#1E60D5',
    fontWeight: '700',
  },
  adminRoleSection: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  adminRoleSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  roleChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  roleChipActive: {
    borderColor: '#1E60D5',
    backgroundColor: '#EFF6FF',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  roleChipTextActive: {
    color: '#1E60D5',
    fontWeight: '700',
  },
  prefixPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  prefixPillActive: {
    backgroundColor: '#DBEAFE',
  },
  prefixPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  prefixPillTextActive: {
    color: '#1E60D5',
  },
  adminHintText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    lineHeight: 15,
  },
  adminNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  adminNoticeText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  adminPrefixStateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    marginVertical: 4,
    gap: 8,
  },
  adminPrefixStateText: {
    fontSize: 12,
    color: '#1E60D5',
    fontWeight: '500',
    flex: 1,
  },
  adminPrefixErrorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  adminPrefixErrorText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '500',
    flex: 1,
  },
  adminRetryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#DC2626',
    borderRadius: 6,
  },
  adminRetryBtnText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
