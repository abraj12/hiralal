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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Camera, Image as ImageIcon, ArrowLeft, CheckCircle2, AlertCircle, FileText, X } from 'lucide-react-native';
import { useApp } from '../context/AppContext';
import { MobileApiClient } from '../services/api';

interface SelectedFileInfo {
  uri: string;
  name: string;
  type: string;
  size?: number;
  file?: any;
}

export default function UploadBillScreen() {
  const { theme, setCurrentScreen, setActiveTab, refreshData } = useApp();

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [billAmount, setBillAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedFileInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePickCamera = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setErrorMsg('Camera permission is required to photograph your invoice receipt.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
          setErrorMsg('Captured photo exceeds the 10MB maximum file size limit.');
          return;
        }
        setSelectedFile({
          uri: asset.uri,
          name: asset.fileName || `invoice_${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
          file: (asset as any).file,
        });
        setErrorMsg(null);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to open camera.');
    }
  };

  const handlePickGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorMsg('Photo library permission is required to select your invoice receipt.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
          setErrorMsg('Selected image exceeds the 10MB maximum file size limit.');
          return;
        }
        setSelectedFile({
          uri: asset.uri,
          name: asset.fileName || `invoice_${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
          file: (asset as any).file,
        });
        setErrorMsg(null);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to open photo library.');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.size && asset.size > 10 * 1024 * 1024) {
          setErrorMsg('Selected document exceeds the 10MB maximum file size limit.');
          return;
        }
        setSelectedFile({
          uri: asset.uri,
          name: asset.name || `invoice_${Date.now()}.pdf`,
          type: asset.mimeType || 'application/pdf',
          size: asset.size,
          file: (asset as any).file,
        });
        setErrorMsg(null);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to open document picker.');
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setErrorMsg('Please attach a valid invoice image or PDF document.');
      return;
    }

    if (!invoiceNumber.trim() || !invoiceDate || !billAmount.trim()) {
      setErrorMsg('Please fill in Invoice Number, Date, and Amount.');
      return;
    }

    const amount = parseFloat(billAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg('Please enter a valid positive bill amount.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await MobileApiClient.uploadBill({
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        billAmount: amount,
        remarks: remarks.trim() || undefined,
        file: selectedFile,
      });
      setIsSuccess(true);
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to upload bill. Please check the details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <View style={styles.successContainer}>
        <Image
          source={require('../../assets/state_bill_uploaded.png')}
          style={styles.successImage}
          resizeMode="contain"
        />
        <Text style={styles.successTitle}>Bill Uploaded Successfully!</Text>
        <Text style={styles.successSubtitle}>
          We'll verify your bill and update your rewards soon.
        </Text>
        <View style={styles.provisionalRewardCard}>
          <Text style={styles.provisionalLabel}>Reward Verification Pending</Text>
          <Text style={[styles.provisionalAmount, { color: theme.primaryColor, fontSize: 18, marginTop: 4 }]}>
            Under Review
          </Text>
          <Text style={styles.provisionalNote}>Reward will be calculated and credited upon administrator verification</Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primaryColor }]}
          onPress={() => {
            setIsSuccess(false);
            setCurrentScreen('MAIN');
            setActiveTab('BILLS');
          }}
        >
          <Text style={styles.primaryButtonText}>View My Bills</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setCurrentScreen('MAIN')}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{theme.uploadTitle}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {errorMsg && (
          <View style={styles.errorBox}>
            <AlertCircle size={15} color="#DC2626" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Document Picker Box */}
        <View style={styles.documentPickerContainer}>
          <Text style={styles.pickerTitle}>Attach Real Invoice Receipt (PDF / Image) *</Text>
          <View style={styles.pickerButtonsRow}>
            <TouchableOpacity
              style={[styles.pickerBtn, { backgroundColor: '#F8FAFC' }]}
              onPress={handlePickCamera}
              activeOpacity={0.8}
            >
              <Camera size={18} color={theme.primaryColor} />
              <Text style={[styles.pickerBtnText, { color: theme.primaryColor }]}>Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.pickerBtn, { backgroundColor: '#F8FAFC' }]}
              onPress={handlePickGallery}
              activeOpacity={0.8}
            >
              <ImageIcon size={18} color="#64748B" />
              <Text style={styles.pickerBtnText}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.pickerBtn, { backgroundColor: '#F8FAFC' }]}
              onPress={handlePickDocument}
              activeOpacity={0.8}
            >
              <FileText size={18} color="#64748B" />
              <Text style={styles.pickerBtnText}>Document</Text>
            </TouchableOpacity>
          </View>

          {selectedFile ? (
            <View style={styles.fileSelectedPreview}>
              <CheckCircle2 size={16} color="#16A34A" />
              <Text style={styles.fileSelectedText} numberOfLines={1}>
                {selectedFile.name} {selectedFile.size ? `(${Math.round(selectedFile.size / 1024)} KB)` : ''}
              </Text>
              <TouchableOpacity onPress={() => setSelectedFile(null)} style={{ padding: 2 }}>
                <X size={14} color="#64748B" />
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.noFileNotice}>
              No document selected. Photo or PDF required (max 10MB).
            </Text>
          )}
        </View>

        {/* Input Fields */}
        <View style={styles.formContainer}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Invoice Number *</Text>
            <TextInput
              style={styles.input}
              value={invoiceNumber}
              onChangeText={setInvoiceNumber}
              placeholder="e.g. INV-2026-001"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Invoice Date *</Text>
            <TextInput
              style={styles.input}
              value={invoiceDate}
              onChangeText={setInvoiceDate}
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Bill Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              value={billAmount}
              onChangeText={setBillAmount}
              placeholder="Enter total bill amount"
              keyboardType="numeric"
            />
          </View>

          {/* Reward Program Info Box */}
          <View style={[styles.rewardPreviewBox, { backgroundColor: theme.primaryLight, borderColor: theme.primaryColor }]}>
            <View style={styles.rewardPreviewHeader}>
              <Text style={[styles.rewardPreviewTitle, { color: theme.primaryDark }]}>
                Hiralal Rewards Program
              </Text>
              <Text style={[styles.rewardPreviewValue, { color: theme.primaryColor, fontSize: 13 }]}>
                Awaiting Verification
              </Text>
            </View>
            <Text style={styles.rewardPreviewDesc}>
              Reward points will be verified and credited directly to your wallet after administrator invoice audit.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Remarks (Optional)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              value={remarks}
              onChangeText={setRemarks}
              placeholder={
                theme.profession === 'PLUMBER'
                  ? 'e.g. CPVC pipes, elbow fittings, brass valves...'
                  : 'e.g. Vitrified floor tiles, tile adhesive...'
              }
              multiline
            />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: theme.primaryColor },
              (!selectedFile || isSubmitting) && { opacity: 0.5 },
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting || !selectedFile}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {selectedFile ? 'Submit Bill for Verification' : 'Select Invoice to Submit'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
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
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
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
  documentPickerContainer: {
    margin: 20,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 14,
  },
  pickerButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  pickerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  fileSelectedPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  fileSelectedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
    flex: 1,
  },
  noFileNotice: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 10,
    fontWeight: '600',
  },
  formContainer: {
    paddingHorizontal: 20,
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
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  rewardPreviewBox: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  rewardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rewardPreviewTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  rewardPreviewValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  rewardPreviewDesc: {
    fontSize: 11,
    color: '#64748B',
  },
  primaryButton: {
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  errorBox: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  successContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  successImage: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  provisionalRewardCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    marginVertical: 24,
  },
  provisionalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  provisionalAmount: {
    fontSize: 28,
    fontWeight: '900',
    marginVertical: 4,
  },
  provisionalNote: {
    fontSize: 11,
    color: '#94A3B8',
  },
});
