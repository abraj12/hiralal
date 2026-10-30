import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { X, CheckCircle2, ShieldCheck, ArrowRight, CreditCard, AlertCircle } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { PAN_CONSENT_TEXT, BENEFICIARY_CONSENT_TEXT } from '../legal/consentTexts';
import { MobileApiClient } from '../services/api';
import { MobileIntegrityService } from '../services/integrity.service';
import {
  createPanVerificationRequestHash,
  createPayoutRedemptionRequestHash,
  createBeneficiaryVerificationRequestHash,
} from '../services/integrityRequestHash';
import * as LocalAuthentication from 'expo-local-authentication';

interface RedemptionModalProps {
  visible: boolean;
  onClose: () => void;
  setupOnly?: boolean;
  initialStep?: 1 | 2;
  onSuccess?: () => void;
}

export default function RedemptionModal({ visible, onClose, setupOnly = false, initialStep, onSuccess }: RedemptionModalProps) {
  const { user, theme, wallet, refreshData } = useApp();

  // Wizard Step: 1 = KYC PAN, 2 = Payment Account, 3 = Review, 4 = Success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loadingEligibility, setLoadingEligibility] = useState(true);
  const [eligibility, setEligibility] = useState<any>(null);

  // Step 1: KYC PAN state
  const [panNumber, setPanNumber] = useState('');
  const [panName, setPanName] = useState('');
  const [panConsent, setPanConsent] = useState(false);
  // HIR-M-08: consent to share bank/UPI details with RazorpayX for verification and payouts
  const [beneficiaryConsent, setBeneficiaryConsent] = useState(false);
  const [panVerified, setPanVerified] = useState(false);
  const [maskedPan, setMaskedPan] = useState('');

  // Step 2: Payment Account state
  const [paymentType, setPaymentType] = useState<'UPI' | 'BANK'>('UPI');
  const [accountChoice, setAccountChoice] = useState<'SAVED' | 'NEW'>('SAVED');
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [maskedPayment, setMaskedPayment] = useState('');

  // Step 3: Transaction execution state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [payoutResult, setPayoutResult] = useState<{
    id: string;
    status: string;
    razorpayPayoutId?: string | null;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPasswordFallback, setShowPasswordFallback] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  // 100% full balance redemption rule (clamped to immutable platform ceiling of ₹50,000)
  const amountToRedeem = Math.min(Number(wallet.availableBalance || 0), 50000);

  // On open, fetch real eligibility & existing KYC/Account status
  useEffect(() => {
    if (!visible) return;

    let mounted = true;
    setLoadingEligibility(true);
    setErrorMsg(null);
    setPayoutResult(null);
    setShowPasswordFallback(false);
    setConfirmPassword('');
    setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`);

    MobileApiClient.getPayoutEligibility()
      .then((res) => {
        if (!mounted) return;
        setEligibility(res);

        const hasKyc = !!res.verifiedKyc;
        const hasAccount = !!res.verifiedAccount;

        if (hasKyc) {
          setPanVerified(true);
          setMaskedPan(res.verifiedKyc.maskedPan || 'VERIFIED');
        } else {
          setPanVerified(false);
          setPanName(user?.fullName || '');
        }

        if (hasAccount) {
          setPaymentVerified(true);
          setMaskedPayment(res.verifiedAccount.maskedInfo || 'VERIFIED');
          setAccountChoice('SAVED');
        } else {
          setPaymentVerified(false);
          setAccountHolder(user?.fullName || '');
          setAccountChoice('NEW');
        }

        // Auto-navigate to appropriate step
        if (setupOnly && initialStep) {
          setStep(initialStep);
        } else if (!hasKyc) {
          setStep(1);
        } else if (!hasAccount) {
          setStep(2);
        } else {
          setStep(3);
        }
      })
      .catch((err) => {
        if (mounted) setErrorMsg(err.message || 'Unable to check redemption eligibility.');
      })
      .finally(() => {
        if (mounted) setLoadingEligibility(false);
      });

    return () => {
      mounted = false;
    };
  }, [visible, user, setupOnly, initialStep]);

  const handleVerifyPan = async () => {
    const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panNumber || !PAN_REGEX.test(panNumber.trim().toUpperCase())) {
      setErrorMsg('Please enter a valid 10-character PAN number (e.g. ABCDE1234F).');
      return;
    }
    if (!panName.trim()) {
      setErrorMsg('Please enter the name as per PAN records.');
      return;
    }
    if (!panConsent) {
      setErrorMsg('Informed consent is required to verify your PAN identity with tax databases.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      // HIR-M-08: must match the text shown next to the checkbox and the server's PAN_CONSENT_TEXT
      const consentText = PAN_CONSENT_TEXT;
      const requestHash = await createPanVerificationRequestHash({
        panNumber: panNumber.trim().toUpperCase(),
        panName: panName.trim(),
        consent: true,
        consentText,
      });

      const attestation = await MobileIntegrityService.performActionAttestation(
        'KYC_SUBMIT',
        requestHash
      );

      const res = await MobileApiClient.verifyPan(
        panNumber.trim().toUpperCase(),
        panName.trim(),
        true,
        consentText,
        attestation
      );
      setPanVerified(true);
      setMaskedPan(res.kyc?.maskedPan || 'ABCDE••••F');
      if (setupOnly) {
        if (paymentVerified || initialStep === 1) {
          setStep(4);
        } else {
          setStep(2);
        }
      } else if (paymentVerified) {
        setStep(3);
      } else {
        setStep(2);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'PAN verification failed. Please check PAN details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyPayment = async () => {
    setErrorMsg(null);
    if (!beneficiaryConsent) {
      setErrorMsg('Please agree to account verification with our payment partner to continue.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (paymentType === 'UPI') {
        if (!upiId.trim() || !upiId.includes('@')) {
          throw new Error('Please enter a valid UPI ID (e.g. yourname@bank).');
        }
        const requestHash = await createBeneficiaryVerificationRequestHash({
          accountType: 'UPI',
          identifier: upiId.trim(),
          accountHolderName: user?.fullName || undefined,
        });
        const attestation = await MobileIntegrityService.performActionAttestation(
          'BENEFICIARY_VERIFY',
          requestHash
        );
        const res = await MobileApiClient.verifyUpi(upiId.trim(), user?.fullName || undefined, attestation);
        setPaymentVerified(true);
        setMaskedPayment(res.paymentAccount?.maskedInfo || upiId.trim());
      } else {
        const cleanAcc = accountNumber.trim();
        const cleanIfsc = ifscCode.trim().toUpperCase();
        if (!accountHolder.trim() || !cleanAcc || !cleanIfsc) {
          throw new Error('Please fill in Account Name, Account Number, and IFSC Code.');
        }
        if (!/^\d{9,18}$/.test(cleanAcc)) {
          throw new Error('Account number must be between 9 and 18 digits.');
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
          throw new Error('Please enter a valid 11-character IFSC code (e.g. HDFC0001234).');
        }
        const requestHash = await createBeneficiaryVerificationRequestHash({
          accountType: 'BANK',
          identifier: accountNumber.trim(),
          ifscCode: ifscCode.trim().toUpperCase(),
          accountHolderName: accountHolder.trim(),
        });
        const attestation = await MobileIntegrityService.performActionAttestation(
          'BENEFICIARY_VERIFY',
          requestHash
        );
        const res = await MobileApiClient.verifyBankAccount(
          {
            accountHolderName: accountHolder.trim(),
            accountNumber: accountNumber.trim(),
            ifscCode: ifscCode.trim().toUpperCase(),
            bankName: bankName.trim() || undefined,
          },
          attestation
        );
        setPaymentVerified(true);
        setMaskedPayment(res.paymentAccount?.maskedInfo || `${bankName || 'Bank'} ••••••${accountNumber.slice(-4)}`);
      }
      if (setupOnly) {
        setStep(4);
      } else {
        setStep(3);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Payment account verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmRedeem = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    const currentKey = idempotencyKey || `idem-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
    if (!idempotencyKey) {
      setIdempotencyKey(currentKey);
    }

    try {
      // VULN-MOB-02 / F-19: Enforce biometric step-up, with password fallback on unenrolled devices
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm reward payout redemption',
          fallbackLabel: 'Enter Device Passcode',
          cancelLabel: 'Cancel',
        });
        if (!authResult.success) {
          setErrorMsg('Biometric authentication is required to confirm redemption.');
          setIsSubmitting(false);
          return;
        }
      } else {
        // Fallback for devices without biometric hardware or enrolled biometrics (F-19)
        if (!confirmPassword) {
          setShowPasswordFallback(true);
          setErrorMsg('Please enter your account password to verify redemption.');
          setIsSubmitting(false);
          return;
        }
        if (confirmPassword.length < 6) {
          setErrorMsg('Please enter a valid password (minimum 6 characters).');
          setIsSubmitting(false);
          return;
        }
      }

      const requestHash = await createPayoutRedemptionRequestHash({
        idempotencyKey: currentKey,
      });

      const attestation = await MobileIntegrityService.performActionAttestation(
        'PAYOUT_REDEEM',
        requestHash
      );

      const res = await MobileApiClient.redeemRewards(
        {
          idempotencyKey: currentKey,
          ...(confirmPassword ? { password: confirmPassword } : {}),
        },
        attestation
      );
      if (res.payout) {
        setPayoutResult({
          id: res.payout.id,
          status: res.payout.status,
          razorpayPayoutId: res.payout.razorpayPayoutId,
        });
        setTransactionId(res.payout.id);
      }
      setStep(4);
      await refreshData();
    } catch (e: any) {
      // Production mode: display real error from server. Never mock fake success.
      setErrorMsg(e.message || 'Payout request failed. Please check the redemption window and details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAndClose = () => {
    setStep(1);
    setErrorMsg(null);
    onClose();
    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>
                {setupOnly
                  ? step === 1
                    ? 'Verify Identity (PAN)'
                    : step === 2
                    ? 'Disbursement Account'
                    : 'Account Verification'
                  : 'Redeem Rewards'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {setupOnly
                  ? step === 4
                    ? 'Setup Completed'
                    : `Step ${step} • Secure Verification`
                  : step === 4
                  ? 'Disbursement Confirmation'
                  : `Step ${step} of 3 • Secure Payout`}
              </Text>
            </View>
            <TouchableOpacity onPress={handleResetAndClose} style={styles.closeButton}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Stepper Progress Bar */}
          {step < 4 && (
            <View style={styles.stepperContainer}>
              <View style={[styles.stepItem, step >= 1 && { borderColor: theme.primaryColor }]}>
                <Text style={[styles.stepNumber, step >= 1 && { color: theme.primaryColor }]}>1</Text>
                <Text style={styles.stepLabel}>PAN KYC</Text>
              </View>
              <View style={[styles.stepLine, step >= 2 && { backgroundColor: theme.primaryColor }]} />
              <View style={[styles.stepItem, step >= 2 && { borderColor: theme.primaryColor }]}>
                <Text style={[styles.stepNumber, step >= 2 && { color: theme.primaryColor }]}>2</Text>
                <Text style={styles.stepLabel}>Account</Text>
              </View>
              <View style={[styles.stepLine, step >= 3 && { backgroundColor: theme.primaryColor }]} />
              <View style={[styles.stepItem, step >= 3 && { borderColor: theme.primaryColor }]}>
                <Text style={[styles.stepNumber, step >= 3 && { color: theme.primaryColor }]}>3</Text>
                <Text style={styles.stepLabel}>Review</Text>
              </View>
            </View>
          )}

          {errorMsg && (
            <View style={styles.errorBox}>
              <AlertCircle size={14} color="#B91C1C" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {loadingEligibility ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={theme.primaryColor} size="large" />
              <Text style={styles.loadingText}>Checking eligibility & window status...</Text>
            </View>
          ) : (
            <ScrollView style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* STEP 1: PAN KYC */}
              {step === 1 && (
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Verify Your Identity (PAN)</Text>
                  <Text style={styles.stepDescription}>
                    Enter your Permanent Account Number (PAN) details to comply with Indian tax regulations.
                  </Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>PAN Card Number</Text>
                    <TextInput
                      style={styles.input}
                      value={panNumber}
                      onChangeText={t => setPanNumber(t.toUpperCase())}
                      placeholder="e.g. ABCDE1234F"
                      maxLength={10}
                      autoCapitalize="characters"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Full Name on PAN Card</Text>
                    <TextInput
                      style={styles.input}
                      value={panName}
                      onChangeText={setPanName}
                      placeholder="Enter full legal name"
                    />
                  </View>

                  <View style={styles.infoBanner}>
                    <ShieldCheck size={16} color="#1E60D5" />
                    <Text style={styles.infoBannerText}>
                      Your PAN will be verified securely via authorized verification APIs.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.consentRow}
                    onPress={() => setPanConsent(!panConsent)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, panConsent && { backgroundColor: theme.primaryColor, borderColor: theme.primaryColor }]}>
                      {panConsent && <CheckCircle2 size={16} color="#ffffff" />}
                    </View>
                    <Text style={styles.consentText}>
                      {PAN_CONSENT_TEXT}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: theme.primaryColor }, !panConsent && { opacity: 0.6 }]}
                    onPress={handleVerifyPan}
                    disabled={isSubmitting || !panConsent}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <>
                        <Text style={styles.primaryButtonText}>Verify PAN & Continue</Text>
                        <ArrowRight size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* STEP 2: PAYMENT METHOD (UPI / BANK / SAVED) */}
              {step === 2 && (
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Where would you like to receive rewards?</Text>
                  <Text style={styles.stepDescription}>
                    Choose your saved account or configure a new payout destination.
                  </Text>

                  {eligibility?.verifiedAccount && (
                    <View style={styles.tabsRow}>
                      <TouchableOpacity
                        style={[
                          styles.tabOption,
                          accountChoice === 'SAVED' && { borderColor: theme.primaryColor, backgroundColor: theme.primaryLight },
                        ]}
                        onPress={() => setAccountChoice('SAVED')}
                      >
                        <Text
                          style={[
                            styles.tabOptionText,
                            accountChoice === 'SAVED' && { color: theme.primaryColor, fontWeight: '800' },
                          ]}
                        >
                          Use Saved Account
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.tabOption,
                          accountChoice === 'NEW' && { borderColor: theme.primaryColor, backgroundColor: theme.primaryLight },
                        ]}
                        onPress={() => setAccountChoice('NEW')}
                      >
                        <Text
                          style={[
                            styles.tabOptionText,
                            accountChoice === 'NEW' && { color: theme.primaryColor, fontWeight: '800' },
                          ]}
                        >
                          + New Payout Account
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {eligibility?.verifiedAccount && accountChoice === 'SAVED' ? (
                    <View>
                      <View style={styles.reviewCard}>
                        <View style={styles.reviewRow}>
                          <Text style={styles.reviewLabel}>Account Type</Text>
                          <Text style={styles.reviewValue}>{eligibility.verifiedAccount.accountType}</Text>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.reviewRow}>
                          <Text style={styles.reviewLabel}>Account Details</Text>
                          <Text style={styles.reviewValue}>{eligibility.verifiedAccount.maskedInfo}</Text>
                        </View>
                        {eligibility.verifiedAccount.bankName ? (
                          <>
                            <View style={styles.divider} />
                            <View style={styles.reviewRow}>
                              <Text style={styles.reviewLabel}>Bank Name</Text>
                              <Text style={styles.reviewValue}>{eligibility.verifiedAccount.bankName}</Text>
                            </View>
                          </>
                        ) : null}
                      </View>

                      <TouchableOpacity
                        style={[styles.primaryButton, { backgroundColor: theme.primaryColor, marginTop: 14 }]}
                        onPress={() => {
                          setPaymentVerified(true);
                          setMaskedPayment(eligibility.verifiedAccount.maskedInfo || 'VERIFIED');
                          setStep(3);
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Continue with Saved Account</Text>
                        <ArrowRight size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={styles.tabsRow}>
                        <TouchableOpacity
                          style={[
                            styles.tabOption,
                            paymentType === 'UPI' && { borderColor: theme.primaryColor, backgroundColor: theme.primaryLight },
                          ]}
                          onPress={() => setPaymentType('UPI')}
                        >
                          <Text
                            style={[
                              styles.tabOptionText,
                              paymentType === 'UPI' && { color: theme.primaryColor, fontWeight: '800' },
                            ]}
                          >
                            UPI ID (Instant)
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.tabOption,
                            paymentType === 'BANK' && { borderColor: theme.primaryColor, backgroundColor: theme.primaryLight },
                          ]}
                          onPress={() => setPaymentType('BANK')}
                        >
                          <Text
                            style={[
                              styles.tabOptionText,
                              paymentType === 'BANK' && { color: theme.primaryColor, fontWeight: '800' },
                            ]}
                          >
                            Bank Account
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {paymentType === 'UPI' ? (
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>UPI ID / VPA</Text>
                          <TextInput
                            style={styles.input}
                            value={upiId}
                            onChangeText={setUpiId}
                            placeholder="e.g. yourname@oksbi or 9876543210@paytm"
                            autoCapitalize="none"
                          />
                        </View>
                      ) : (
                        <>
                          <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Account Holder Name</Text>
                            <TextInput
                              style={styles.input}
                              value={accountHolder}
                              onChangeText={setAccountHolder}
                              placeholder="Name as printed in bank passbook"
                            />
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Account Number</Text>
                            <TextInput
                              style={styles.input}
                              value={accountNumber}
                              onChangeText={setAccountNumber}
                              placeholder="Bank account number"
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>IFSC Code</Text>
                            <TextInput
                              style={styles.input}
                              value={ifscCode}
                              onChangeText={t => setIfscCode(t.toUpperCase())}
                              placeholder="e.g. SBIN0001234"
                              autoCapitalize="characters"
                            />
                          </View>
                        </>
                      )}

                      <TouchableOpacity
                        style={styles.consentRow}
                        onPress={() => setBeneficiaryConsent(!beneficiaryConsent)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, beneficiaryConsent && { backgroundColor: theme.primaryColor, borderColor: theme.primaryColor }]}>
                          {beneficiaryConsent && <CheckCircle2 size={16} color="#ffffff" />}
                        </View>
                        <Text style={styles.consentText}>{BENEFICIARY_CONSENT_TEXT}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.primaryButton, { backgroundColor: theme.primaryColor }, !beneficiaryConsent && { opacity: 0.6 }]}
                        onPress={handleVerifyPayment}
                        disabled={isSubmitting || !beneficiaryConsent}
                      >
                        {isSubmitting ? (
                          <ActivityIndicator color="#ffffff" />
                        ) : (
                          <>
                            <Text style={styles.primaryButtonText}>Verify Account & Continue</Text>
                            <ArrowRight size={16} color="#ffffff" style={{ marginLeft: 6 }} />
                          </>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {/* STEP 3: REVIEW & CONFIRM */}
              {step === 3 && (
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>Redemption Review</Text>
                  <Text style={styles.stepDescription}>
                    Confirm disbursement details before final payout dispatch.
                  </Text>

                  <View style={styles.reviewCard}>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Reward Amount</Text>
                      <Text style={styles.reviewValueLarge}>{amountToRedeem.toLocaleString('en-IN')} Points</Text>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Identity Verification</Text>
                      <View style={styles.verifiedRow}>
                        <CheckCircle2 size={14} color="#16A34A" />
                        <Text style={styles.verifiedText}>PAN Verified ({maskedPan})</Text>
                      </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.reviewRow}>
                      <View>
                        <Text style={styles.reviewLabel}>Disbursement Account</Text>
                        <TouchableOpacity onPress={() => { setAccountChoice('NEW'); setStep(2); }}>
                          <Text style={{ color: theme.primaryColor, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                            Change Account
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.verifiedRow}>
                        <CreditCard size={14} color="#16A34A" />
                        <Text style={styles.verifiedText}>{maskedPayment}</Text>
                      </View>
                    </View>
                  </View>

                  {showPasswordFallback && (
                    <View style={{ marginTop: 12, marginBottom: 8, padding: 12, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B', marginBottom: 4 }}>
                        Security Verification
                      </Text>
                      <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
                        Device biometrics are not enrolled. Please enter your account password to confirm redemption:
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Enter account password"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        autoCapitalize="none"
                      />
                    </View>
                  )}

                  {eligibility && !eligibility.canRedeem && (
                    <View style={styles.warningBox}>
                      <AlertCircle size={15} color="#DC2626" />
                      <Text style={styles.warningText}>{eligibility.reason}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      { backgroundColor: theme.primaryColor },
                      (eligibility && !eligibility.canRedeem) && { opacity: 0.5 },
                    ]}
                    onPress={handleConfirmRedeem}
                    disabled={isSubmitting || (eligibility && !eligibility.canRedeem)}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Confirm & Redeem {Number(amountToRedeem || 0).toLocaleString('en-IN')} Points</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* STEP 4: SUCCESS / QUEUED CONFIRMATION */}
              {step === 4 && (
                <View style={styles.successContent}>
                  <Image
                    source={require('../../assets/state_reward_credited.png')}
                    style={styles.successIllustration}
                    resizeMode="contain"
                  />

                  <Text style={styles.successTitle}>
                    {setupOnly
                      ? 'Verification Successful!'
                      : payoutResult?.status === 'SUCCESS' || payoutResult?.status === 'PROCESSED'
                      ? 'Transfer Completed Successfully!'
                      : 'Submitted! Awaiting Admin Approval'}
                  </Text>
                  {!setupOnly && (
                    <Text style={styles.successAmount}>{amountToRedeem.toLocaleString('en-IN')} Points</Text>
                  )}
                  <Text style={styles.successDesc}>
                    {setupOnly
                      ? 'Your verification details have been securely recorded. You will be able to redeem reward payouts immediately upon earning points.'
                      : payoutResult?.status === 'SUCCESS' || payoutResult?.status === 'PROCESSED'
                      ? `Your rewards payout has been successfully transferred to your verified payment account (${maskedPayment}).`
                      : `Your redemption request has been submitted and is awaiting administrator approval. Funds will be dispatched directly to your verified account (${maskedPayment}) upon approval.`}
                  </Text>

                  {!setupOnly && (
                    <View style={styles.txnBox}>
                      <Text style={styles.txnLabel}>Payout Reference ID</Text>
                      <Text style={styles.txnValue}>{payoutResult?.id || transactionId}</Text>
                      {payoutResult?.razorpayPayoutId && (
                        <Text style={{ marginTop: 4, fontSize: 11, color: '#64748B', fontWeight: '500' }}>
                          Gateway Ref: {payoutResult.razorpayPayoutId}
                        </Text>
                      )}
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: theme.primaryColor }]}
                    onPress={handleResetAndClose}
                  >
                    <Text style={styles.primaryButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  closeButton: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
  },
  stepItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94A3B8',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    textAlign: 'center',
    lineHeight: 22,
    backgroundColor: '#ffffff',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  stepLine: {
    width: 36,
    height: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 14,
  },
  scrollBody: {
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  stepContent: {
    paddingTop: 6,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    padding: 10,
    borderRadius: 10,
    marginBottom: 18,
  },
  infoBannerText: {
    fontSize: 11,
    color: '#1E40AF',
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  tabOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  tabOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  reviewCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  reviewLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  reviewValueLarge: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  reviewValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16A34A',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginBottom: 14,
  },
  warningText: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
    flex: 1,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    marginHorizontal: 22,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    fontSize: 11,
    color: '#B91C1C',
    fontWeight: '600',
    flex: 1,
  },
  successContent: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  successIllustration: {
    width: 90,
    height: 90,
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  successAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#16A34A',
    marginBottom: 6,
  },
  successDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  txnBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  txnLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  txnValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: 'monospace',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
    marginBottom: 16,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
});
