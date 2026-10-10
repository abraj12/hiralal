import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Shield, Lock, AlertCircle, ArrowRight, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';
import { AdminApiClient } from '../lib/api';

export default function AdminLoginPage() {
  const router = useRouter();

  // Password-First, OTP-Second Authentication Flow:
  // Step 1: Enter Identifier & Password -> Validates credentials and dispatches OTP
  // Step 2: Enter 6-digit OTP Challenge -> Validates OTP and establishes single active session
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [mobileMasked, setMobileMasked] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Step 1: Password Login & OTP Dispatch
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setError('Please enter your admin identifier (Role Prefix + 10-digit Mobile).');
      return;
    }
    if (!password) {
      setError('Please enter your administrator password.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await AdminApiClient.login(identifier.trim(), password);
      if (res.requiresOtp) {
        setChallengeToken(res.challengeToken);
        setMobileMasked(res.mobileMasked || '');
        setInfoMessage(res.message || `Verification code sent to your registered mobile (${res.mobileMasked || '***'}).`);
        setStep(2);
      } else if (res.token || res.accessToken) {
        AdminApiClient.setToken(res.token || res.accessToken);
        if (res.user) {
          AdminApiClient.setUser(res.user);
        }
        router.push('/');
      } else {
        setError('Unexpected authentication response. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid administrator credentials. Please check your details and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP Challenge
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await AdminApiClient.verifyOtp(identifier.trim(), otpCode.trim(), challengeToken);
      AdminApiClient.setToken(res.token || res.accessToken);
      if (res.user) {
        AdminApiClient.setUser(res.user);
      }
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl relative z-10 border border-slate-100">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center text-white text-3xl font-black mx-auto mb-4 shadow-lg shadow-red-200">
            H
          </div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            HIRALAL AND SONS
          </h1>
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mt-0.5">
            Rewards Administration Portal
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Restricted access for authorized administrative personnel
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center space-x-2 mb-6">
          <div className={`h-1.5 rounded-full transition-all ${step >= 1 ? 'w-12 bg-blue-600' : 'w-6 bg-slate-200'}`} />
          <div className={`h-1.5 rounded-full transition-all ${step >= 2 ? 'w-12 bg-blue-600' : 'w-6 bg-slate-200'}`} />
        </div>

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="mb-5 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* STEP 1: Admin Identifier & Password */}
        {step === 1 && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Admin Role Identifier
              </label>
              <div className="relative">
                <Shield className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="e.g. BADM9876543210 or OADM9876543210"
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Enter your designated role prefix (e.g. BADM for Bill Admin or OADM for Operations Admin) followed by your 10-digit mobile number.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Administrator Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter secure password"
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center space-x-2 transition duration-150 disabled:opacity-50"
            >
              <span>{isLoading ? 'Verifying Credentials...' : 'Sign In & Request OTP'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* STEP 2: Verify OTP Challenge */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Enter 6-Digit OTP {mobileMasked ? `(sent to ${mobileMasked})` : ''}
                </label>
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(null); }}
                  className="text-[11px] text-blue-600 hover:underline flex items-center space-x-1"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>Change Credentials</span>
                </button>
              </div>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit OTP"
                  maxLength={6}
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium tracking-widest text-center"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Valid for 5 minutes. Logging in establishes a single active session and invalidates previous sessions.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center space-x-2 transition duration-150 disabled:opacity-50"
            >
              <span>{isLoading ? 'Verifying OTP...' : 'Confirm OTP & Open Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        <div className="mt-8 text-center text-[11px] text-slate-400">
          Protected by Dual-Factor OTP & Single Active Session Policy
        </div>
      </div>
    </div>
  );
}
