import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { KeyRound, AlertCircle } from 'lucide-react-native';
import { useAdminApp } from '../context/AdminAppContext';
import { MobileApiClient } from '../services/api';

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * HIR-M-12: Shown while the administrator account is flagged for forced password rotation.
 * The server revokes all sessions after a successful change, so the admin signs in again.
 */
export default function AdminChangePasswordScreen() {
  const { logout } = useAdminApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from the current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await MobileApiClient.changePassword(currentPassword, newPassword);
      Alert.alert('Password Changed', 'Sign in again with your new password.');
      await logout().catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Password change failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <KeyRound size={20} color="#D97706" />
          <Text style={styles.title}>Change your password</Text>
        </View>
        <Text style={styles.subtitle}>
          Your administrator account uses an initial password. Choose a new password of at least{' '}
          {MIN_ADMIN_PASSWORD_LENGTH} characters to continue.
        </Text>

        <TextInput
          style={styles.input}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          placeholderTextColor="#94A3B8"
          secureTextEntry
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password"
          placeholderTextColor="#94A3B8"
          secureTextEntry
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm new password"
          placeholderTextColor="#94A3B8"
          secureTextEntry
          autoCapitalize="none"
        />

        {error && (
          <View style={styles.errorBox}>
            <AlertCircle size={16} color="#DC2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Change password</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => logout()} style={styles.secondaryButton} disabled={isSubmitting}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#0F172A', padding: 24, justifyContent: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginLeft: 8 },
  subtitle: { fontSize: 13, color: '#475569', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 10,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  errorText: { color: '#B91C1C', fontSize: 12, marginLeft: 6, flex: 1 },
  button: { backgroundColor: '#D97706', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryButton: { alignItems: 'center', paddingVertical: 12 },
  secondaryButtonText: { color: '#64748B', fontWeight: '600', fontSize: 13 },
});
