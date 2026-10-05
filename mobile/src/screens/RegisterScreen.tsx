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
} from 'react-native';
import { ArrowLeft, CheckCircle2, ChevronRight, AlertCircle, Wrench, Grid, MoreHorizontal } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { ProfessionType } from '../theme/professionTheme';
import { MobileApiClient } from '../services/api';

export default function RegisterScreen() {
  const { setCurrentScreen, refreshData } = useApp();

  // Wizard Step: 1 = Profession Selection, 2 = Mobile & OTP, 3 = Name & Password
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Profession
  const [selectedProfession, setSelectedProfession] = useState<ProfessionType>('PLUMBER');

  // Step 2: Mobile & OTP
  const [mobile, setMobile] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Step 3: Name & Password
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSendOtp = async () => {
    if (!mobile || mobile.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      await MobileApiClient.sendOtp(mobile, 'REGISTRATION');
      setOtpSent(true);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpAndNext = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setErrorMsg('Please enter the 6-digit OTP code.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      await MobileApiClient.verifyOtp(mobile, otpCode, 'REGISTRATION');
      setStep(3);
    } catch (e: any) {
      setErrorMsg(e.message || 'Invalid or expired OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteRegistration = async () => {
    if (!fullName || !password) {
      setErrorMsg('Please enter your full name and choose a secure password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await MobileApiClient.register({
        mobile,
        fullName,
        password,
        profession: selectedProfession,
        otpCode,
      });
      if (res.token) {
        MobileApiClient.setToken(res.token);
      }
      await refreshData();
      setCurrentScreen('MAIN');
    } catch (e: any) {
      setErrorMsg(e.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (step > 1) setStep((step - 1) as any);
            else setCurrentScreen('WELCOME');
          }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Create Account</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Stepper Header (matches reference image 3 screen 3) */}
      <View style={styles.stepperRow}>
        <View style={styles.stepperItem}>
          <View style={[styles.stepCircle, step >= 1 && styles.stepCircleActive]}>
            <Text style={[styles.stepText, step >= 1 && styles.stepTextActive]}>1</Text>
          </View>
          <Text style={styles.stepTitleLabel}>Select Profession</Text>
        </View>

        <View style={[styles.stepperLine, step >= 2 && styles.stepperLineActive]} />

        <View style={styles.stepperItem}>
          <View style={[styles.stepCircle, step >= 2 && styles.stepCircleActive]}>
            <Text style={[styles.stepText, step >= 2 && styles.stepTextActive]}>2</Text>
          </View>
          <Text style={styles.stepTitleLabel}>Mobile & OTP</Text>
        </View>

        <View style={[styles.stepperLine, step >= 3 && styles.stepperLineActive]} />

        <View style={styles.stepperItem}>
          <View style={[styles.stepCircle, step >= 3 && styles.stepCircleActive]}>
            <Text style={[styles.stepText, step >= 3 && styles.stepTextActive]}>3</Text>
          </View>
          <Text style={styles.stepTitleLabel}>Create Account</Text>
        </View>
      </View>

      {errorMsg && (
        <View style={styles.errorBox}>
          <AlertCircle size={15} color="#DC2626" />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* STEP 1: PROFESSION SELECTION (Matches Image 3 Screen 3) */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.heading}>What's your profession?</Text>
            <Text style={styles.subHeading}>
              Choose what you do. This helps us personalize your rewards experience.
            </Text>

            {/* Plumber Option Card */}
            <TouchableOpacity
              style={[
                styles.professionCard,
                selectedProfession === 'PLUMBER' && styles.professionCardSelectedBlue,
              ]}
              onPress={() => setSelectedProfession('PLUMBER')}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeaderRow}>
                <Image
                  source={require('../../assets/plumber_card.png')}
                  style={styles.cardMiniThumb}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Plumber</Text>
                  <Text style={styles.cardSub}>Pipes • Fittings • Sanitary • Plumbing Products</Text>
                </View>
                <View
                  style={[
                    styles.radioCircle,
                    selectedProfession === 'PLUMBER' && styles.radioCircleActiveBlue,
                  ]}
                >
                  {selectedProfession === 'PLUMBER' && <View style={styles.radioDot} />}
                </View>
              </View>
            </TouchableOpacity>

            {/* Tiles Option Card */}
            <TouchableOpacity
              style={[
                styles.professionCard,
                selectedProfession === 'TILE_INSTALLER' && styles.professionCardSelectedOrange,
              ]}
              onPress={() => setSelectedProfession('TILE_INSTALLER')}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeaderRow}>
                <Image
                  source={require('../../assets/tiles_card.png')}
                  style={styles.cardMiniThumb}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Tiles / Tile Installer</Text>
                  <Text style={styles.cardSub}>Tiles • Flooring • Adhesives • Installation Products</Text>
                </View>
                <View
                  style={[
                    styles.radioCircle,
                    selectedProfession === 'TILE_INSTALLER' && styles.radioCircleActiveOrange,
                  ]}
                >
                  {selectedProfession === 'TILE_INSTALLER' && <View style={styles.radioDot} />}
                </View>
              </View>
            </TouchableOpacity>


            <TouchableOpacity
              style={styles.continueBtn}
              onPress={() => setStep(2)}
              activeOpacity={0.85}
            >
              <Text style={styles.continueBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 2: MOBILE & OTP VERIFICATION */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.heading}>Enter Your Mobile Number</Text>
            <Text style={styles.subHeading}>
              We'll send an OTP to verify your mobile number.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Mobile Number</Text>
              <View style={styles.inputRow}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixText}>🇮🇳 +91</Text>
                </View>
                <TextInput
                  style={styles.inputFlex}
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="Enter 10-digit number"
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>

            {!otpSent ? (
              <TouchableOpacity
                style={styles.continueBtn}
                onPress={handleSendOtp}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.continueBtnText}>Send OTP</Text>
                )}
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Enter 6-digit OTP Code</Text>
                  <TextInput
                    style={styles.inputBox}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder="Enter 6-digit OTP received"
                    keyboardType="numeric"
                    maxLength={6}
                  />
                </View>

                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={handleVerifyOtpAndNext}
                  activeOpacity={0.85}
                >
                  <Text style={styles.continueBtnText}>Verify OTP & Continue</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* STEP 3: BASIC DETAILS & PASSWORD */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.heading}>Create Your Account</Text>
            <Text style={styles.subHeading}>
              Almost done! Enter your name and create a password for login.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.inputBox}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Raj Kumar"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Set Password</Text>
              <TextInput
                style={styles.inputBox}
                value={password}
                onChangeText={setPassword}
                placeholder="Choose a strong password"
                secureTextEntry
              />
            </View>

            <View style={styles.professionReviewPill}>
              <Text style={styles.pillLabel}>Selected Profession:</Text>
              <Text style={styles.pillValue}>{selectedProfession}</Text>
            </View>

            <TouchableOpacity
              style={styles.continueBtn}
              onPress={handleCompleteRegistration}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.continueBtnText}>Complete & Open Dashboard</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  stepperItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#1E60D5',
  },
  stepText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
  },
  stepTextActive: {
    color: '#ffffff',
  },
  stepTitleLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 4,
  },
  stepperLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
    marginBottom: 14,
  },
  stepperLineActive: {
    backgroundColor: '#1E60D5',
  },
  scroll: {
    flex: 1,
  },
  stepContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  heading: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
  },
  subHeading: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
    marginBottom: 20,
  },
  professionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  professionCardSelectedBlue: {
    borderColor: '#1E60D5',
    backgroundColor: '#EFF6FF',
  },
  professionCardSelectedOrange: {
    borderColor: '#E65100',
    backgroundColor: '#FFF7ED',
  },
  professionCardSelectedNeutral: {
    borderColor: '#64748B',
    backgroundColor: '#F8FAFC',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardMiniThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleActiveBlue: {
    borderColor: '#1E60D5',
  },
  radioCircleActiveOrange: {
    borderColor: '#E65100',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E60D5',
  },
  continueBtn: {
    backgroundColor: '#1E60D5',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 18,
    shadowColor: '#1E60D5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  inputRow: {
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
  inputFlex: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  inputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  otpHint: {
    fontSize: 11,
    color: '#1E60D5',
    marginTop: 4,
    fontWeight: '600',
  },
  professionReviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
    gap: 8,
  },
  pillLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  pillValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  errorBox: {
    marginHorizontal: 24,
    marginTop: 10,
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
});
