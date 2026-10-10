import React, { useState } from 'react';
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
import { ArrowLeft, Phone, Lock, ShieldCheck, AlertCircle, KeyRound, CheckCircle2 } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function LoginScreen() {
  const { setCurrentScreen, login, loginAdmin } = useApp();

  // Mode: 'USER' or 'ADMIN'
  const [loginMode, setLoginMode] = useState<'USER' | 'ADMIN'>('USER');

  // Normal User login fields
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');

  // Admin login flow
  // 1: Enter Identifier & Request OTP
  // 2: Enter OTP & Verify Challenge
  // 3: Enter Password & Complete Admin Login
  const [adminStep, setAdminStep] = useState<1 | 2 | 3>(1);
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [adminOtp, setAdminOtp] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Forgot Password modal (Real backend flow: request -> verify -> complete)
  const [showForgot, setShowForgot] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotMobile, setForgotMobile] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotToken, setForgotToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  // User Login Handler
  const handleUserLogin = async () => {
    if (!mobile || !password) {
      setErrorMsg('Please enter both mobile number and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await login(mobile, password);
    } catch (e: any) {
      setErrorMsg(e.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Admin Login Flow Handlers
  const handleAdminRequestOtp = async () => {
    if (!adminIdentifier.trim()) {
      setErrorMsg('Please enter your admin identifier (e.g. XYZ9876543210).');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const res = await MobileApiClient.requestAdminOtp(adminIdentifier.trim());
      setInfoMsg(res.message || 'OTP dispatched to registered mobile number.');
      setAdminStep(2);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to dispatch admin OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminVerifyOtp = async () => {
    if (!adminOtp.trim() || adminOtp.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const res = await MobileApiClient.verifyAdminOtp(adminIdentifier.trim(), adminOtp.trim());
      setAdminToken(res.verificationToken);
      setInfoMsg('OTP verified successfully. Please enter your administrator password.');
      setAdminStep(3);
    } catch (e: any) {
      setErrorMsg(e.message || 'Invalid or expired verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminCompleteLogin = async () => {
    if (!adminPassword) {
      setErrorMsg('Please enter your administrator password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await loginAdmin(adminIdentifier.trim(), adminPassword, adminToken);
    } catch (e: any) {
      setErrorMsg(e.message || 'Admin login failed. Please check password.');
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Step 1: Request OTP
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

  // Forgot Password Step 2: Verify OTP
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

  // Forgot Password Step 3: Complete Reset
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
      setMobile(clean);
      setPassword('');
    } catch (e: any) {
      setForgotError(e.message || 'Password reset failed. Please retry.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => setCurrentScreen('WELCOME')}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          {loginMode === 'ADMIN' ? 'Admin Portal' : 'Login'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Brand Banner */}
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/brand_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.brandTitle}>HIRALAL AND SONS</Text>
            <Text style={styles.brandSub}>
              {loginMode === 'ADMIN' ? 'ADMINISTRATION' : 'REWARDS PROGRAM'}
            </Text>
          </View>
        </View>

        {/* Mode Selector Tab */}
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[styles.modeTab, loginMode === 'USER' && styles.modeTabActive]}
            onPress={() => { setLoginMode('USER'); setErrorMsg(null); setInfoMsg(null); }}
          >
            <Text style={[styles.modeTabText, loginMode === 'USER' && styles.modeTabTextActive]}>
              Craftsman Login
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, loginMode === 'ADMIN' && styles.modeTabActive]}
            onPress={() => { setLoginMode('ADMIN'); setErrorMsg(null); setInfoMsg(null); setAdminStep(1); }}
          >
            <Text style={[styles.modeTabText, loginMode === 'ADMIN' && styles.modeTabTextActive]}>
              Admin Access
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.welcomeBox}>
          <Text style={styles.welcomeHeading}>
            {loginMode === 'ADMIN' ? 'Administrator Login' : 'Welcome Back!'}
          </Text>
          <Text style={styles.welcomeDesc}>
            {loginMode === 'ADMIN'
              ? 'Authorized personnel only. Sequence: Identifier → OTP → Password.'
              : 'Enter your 10-digit mobile number and password to access your rewards.'}
          </Text>
        </View>

        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertCircle size={15} color="#DC2626" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {infoMsg && (
          <View style={styles.infoBox}>
            <CheckCircle2 size={15} color="#059669" />
            <Text style={styles.infoText}>{infoMsg}</Text>
          </View>
        )}

        {/* ================= USER LOGIN FORM ================= */}
        {loginMode === 'USER' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixText}>🇮🇳 +91</Text>
                </View>
                <TextInput
                  style={styles.input}
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="Enter 10-digit mobile"
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, { paddingLeft: 14 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry
                />
              </View>
            </View>

            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => {
                setShowForgot(true);
                setForgotStep(1);
                setForgotMobile(mobile);
                setForgotError(null);
                setForgotMsg(null);
              }}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginBtn}
              onPress={handleUserLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.loginBtnText}>Login</Text>
              )}
            </TouchableOpacity>

            <View style={styles.createAccountRow}>
              <Text style={styles.noAccountText}>Don't have an account yet? </Text>
              <TouchableOpacity onPress={() => setCurrentScreen('REGISTER')}>
                <Text style={styles.createAccountLink}>Register Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ================= ADMIN LOGIN FLOW ================= */}
        {loginMode === 'ADMIN' && (
          <View style={styles.form}>
            {/* Step 1: Identifier */}
            {adminStep === 1 && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Admin Role Identifier</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingLeft: 14 }]}
                      value={adminIdentifier}
                      onChangeText={setAdminIdentifier}
                      placeholder="e.g. XYZ9876543210 (Prefix + Mobile)"
                      autoCapitalize="characters"
                    />
                  </View>
                  <Text style={styles.helperText}>
                    Enter your role prefix (e.g. Bill Admin or Ops Admin) followed by your 10-digit mobile number.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={handleAdminRequestOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.loginBtnText}>Request Verification OTP</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* Step 2: OTP */}
            {adminStep === 2 && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Enter 6-Digit Verification Code</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingLeft: 14, textAlign: 'center', letterSpacing: 6 }]}
                      value={adminOtp}
                      onChangeText={setAdminOtp}
                      placeholder="Enter OTP"
                      keyboardType="numeric"
                      maxLength={6}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={handleAdminVerifyOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.loginBtnText}>Verify OTP Challenge</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ marginTop: 12, alignItems: 'center' }}
                  onPress={() => setAdminStep(1)}
                >
                  <Text style={{ fontSize: 13, color: '#2563EB', fontWeight: '600' }}>
                    Change Identifier
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* Step 3: Password */}
            {adminStep === 3 && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Administrator Password</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingLeft: 14 }]}
                      value={adminPassword}
                      onChangeText={setAdminPassword}
                      placeholder="Enter administrator password"
                      secureTextEntry
                    />
                  </View>
                  <Text style={styles.helperText}>
                    Logging in creates a single active session, terminating prior sessions on other devices.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={handleAdminCompleteLogin}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.loginBtnText}>Sign In to Admin Portal</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Forgot Password Modal (Real 3-Step Flow) */}
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
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 3,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 9,
  },
  modeTabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modeTabTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  welcomeBox: {
    marginBottom: 20,
  },
  welcomeHeading: {
    fontSize: 22,
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
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  helperText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
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
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
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
    color: '#2563EB',
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 16,
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
    backgroundColor: '#2563EB',
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
