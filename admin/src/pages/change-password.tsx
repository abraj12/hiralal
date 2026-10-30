import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { KeyRound } from 'lucide-react';
import { AdminApiClient } from '../lib/api';

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * HIR-M-12: Administrator password change. Shown automatically while the account is flagged
 * for forced rotation; the server revokes all sessions afterwards, so the admin signs in again.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      await AdminApiClient.changePassword(currentPassword, newPassword);
      AdminApiClient.clearToken();
      router.replace('/login');
    } catch (err: any) {
      setError(err.message || 'Password change failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <KeyRound className="w-5 h-5 text-amber-600" />
          <h1 className="text-lg font-bold text-slate-900">Change your password</h1>
        </div>
        <p className="text-xs text-slate-600">
          Choose a new password of at least {MIN_ADMIN_PASSWORD_LENGTH} characters. You will be signed out and must sign
          in again with the new password.
        </p>

        <label className="block text-xs font-semibold text-slate-700">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="mt-1 w-full text-sm p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            required
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full text-sm p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            required
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full text-sm p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            required
          />
        </label>

        {error && <div className="p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50"
        >
          {isSubmitting ? 'Changing password...' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
