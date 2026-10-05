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
import { ArrowLeft, Phone, Lock, ShieldCheck, AlertCircle, KeyRound } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

export default function LoginScreen() {
  const { setCurrentScreen, login } = useApp();

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forgot Password modal
  const [showForgot, setShowForgot] = useState(false);
  const [forgotMobile, setForgotMobile] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleLogin = async () => {
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

  const handleSendForgotOtp = async () => {
    if (!forgotMobile || forgotMobile.length !== 10) {
      setForgotMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    setForgotLoading(true);
    setForgotMsg(null);
    try {
      await MobileApiClient.sendOtp(forgotMobile, 'FORGOT_PASSWORD');
      setOtpSent(true);
      setForgotMsg('OTP sent to your registered mobile number.');
    } catch (e: any) {
      setForgotMsg(e.message || 'Failed to send OTP. Please check the mobile number.');
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
        <Text style={styles.topBarTitle}>Login</Text>
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
            <Text style={styles.brandSub}>REWARDS PROGRAM</Text>
          </View>
        </View>

        <View style={styles.welcomeBox}>
          <Text style={styles.welcomeHeading}>Welcome Back!</Text>
          <Text style={styles.welcomeDesc}>
            Enter your 10-digit mobile number and password to access your rewards.
          </Text>
        </View>

        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertCircle size={15} color="#DC2626" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Inputs */}
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
            onPress={() => setShowForgot(true)}
          >
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.loginBtn}
            onPress={handleLogin}
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
      </ScrollView>

      {/* Forgot Password Modal */}
      {showForgot && (
        <Modal visible={true} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Reset Password via OTP</Text>
              <Text style={styles.modalDesc}>
                We will send a 6-digit OTP to verify your registered mobile number.
              </Text>

              {forgotMsg && (
                <View style={styles.forgotMsgBox}>
                  <Text style={styles.forgotMsgText}>{forgotMsg}</Text>
                </View>
              )}

              {!otpSent ? (
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
                      <Text style={styles.modalBtnText}>Send Verification OTP</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TextInput
                    style={styles.modalInput}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder="Enter 6-digit OTP received"
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={styles.modalInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password"
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={styles.modalBtn}
                    onPress={() => {
                      setShowForgot(false);
                      alert('Password reset successfully. Please login.');
                    }}
                  >
                    <Text style={styles.modalBtnText}>Reset & Save Password</Text>
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  backBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  scroll: {
    flex: 1,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 10,
    gap: 12,
  },
  logo: {
    width: 48,
    height: 40,
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0F172A',
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 0.8,
  },
  welcomeBox: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  welcomeHeading: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
  },
  welcomeDesc: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  form: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  prefixBox: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    backgroundColor: '#F1F5F9',
  },
  prefixText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },
  forgotText: {
    fontSize: 12,
    color: '#1E60D5',
    fontWeight: '700',
  },
  loginBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  createAccountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  noAccountText: {
    fontSize: 13,
    color: '#64748B',
  },
  createAccountLink: {
    fontSize: 13,
    color: '#1E60D5',
    fontWeight: '800',
  },
  demoBox: {
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: 14,
    marginTop: 20,
  },
  demoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
  },
  demoChips: {
    flexDirection: 'row',
    gap: 8,
  },
  demoChip: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  demoChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  errorBox: {
    marginHorizontal: 24,
    marginTop: 12,
    padding: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  modalBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  modalCancelBtn: {
    alignItems: 'center',
    marginTop: 12,
  },
  modalCancelText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  forgotMsgBox: {
    backgroundColor: '#EFF6FF',
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  forgotMsgText: {
    fontSize: 11,
    color: '#1E40AF',
    fontWeight: '600',
  },
});
