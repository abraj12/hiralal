import React, { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Shield,
  Lock,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Phone,
} from 'lucide-react';
import { AdminApiClient } from '../lib/api';

export default function AdminLoginPage() {
  const router = useRouter();

  // Multi-tier Administrative Authentication Flow:
  // Step 1: Secret Admin Prefix Gate -> Prefix is entered masked (like password), verified against server
  // Step 2: Mobile Number & Password -> Unlocked ONLY after correct prefix verification
  // Step 3: 2FA OTP Challenge -> Validates 6-digit code and establishes single active session
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Prefix State
  const [prefix, setPrefix] = useState('');
  const [showPrefix, setShowPrefix] = useState(false);
  const [verifiedPrefix, setVerifiedPrefix] = useState('');

  // Step 2: Credentials State
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 3: 2FA OTP State
  const [otpCode, setOtpCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [mobileMasked, setMobileMasked] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Step 1 Handler: Verify Prefix
  const handleVerifyPrefix = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrefix = prefix.trim().toUpperCase();
    if (!cleanPrefix) {
      setError('Please enter your secret administrator role prefix.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await AdminApiClient.verifyPrefix(cleanPrefix);
      if (res.verified || res.success) {
        setVerifiedPrefix(cleanPrefix);
        setInfoMessage('Security prefix verified. Please enter your administrator credentials.');
        setStep(2);
      } else {
        setError('Invalid administrator security prefix. Access denied.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid administrator security prefix. Access denied.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2 Handler: Password Login & OTP Dispatch
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMobile = mobile.replace(/\D/g, '');
    if (!cleanMobile || cleanMobile.length !== 10) {
      setError('Please enter a valid 10-digit registered mobile number.');
      return;
    }
    if (!password) {
      setError('Please enter your administrator password.');
      return;
    }

    const fullIdentifier = `${verifiedPrefix}${cleanMobile}`;

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await AdminApiClient.login(fullIdentifier, password);
      if (res.requiresOtp) {
        setChallengeToken(res.challengeToken);
        setMobileMasked(res.mobileMasked || '');
        setInfoMessage(res.message || `Verification code sent to your registered mobile (${res.mobileMasked || '***'}).`);
        setStep(3);
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

  // Step 3 Handler: Verify OTP Challenge
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otpCode.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    const fullIdentifier = `${verifiedPrefix}${mobile.replace(/\D/g, '')}`;

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await AdminApiClient.verifyOtp(fullIdentifier, cleanOtp, challengeToken);
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
          <img
            src="/assets/brand_logo.png"
            alt="Hiralal & Sons"
            className="w-20 h-20 mx-auto mb-3 object-contain"
          />
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            HIRALAL AND SONS
          </h1>
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mt-0.5">
            Rewards Administration Portal
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Multi-tier security gate for authorized administrative personnel
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center space-x-2 mb-6">
          <div className={`h-1.5 rounded-full transition-all ${step >= 1 ? 'w-8 bg-blue-600' : 'w-4 bg-slate-200'}`} />
          <div className={`h-1.5 rounded-full transition-all ${step >= 2 ? 'w-8 bg-blue-600' : 'w-4 bg-slate-200'}`} />
          <div className={`h-1.5 rounded-full transition-all ${step >= 3 ? 'w-8 bg-blue-600' : 'w-4 bg-slate-200'}`} />
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

        {/* STEP 1: Secret Admin Prefix Gate */}
        {step === 1 && (
          <form onSubmit={handleVerifyPrefix} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Administrator Security Prefix
              </label>
              <div className="relative">
                <Shield className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type={showPrefix ? 'text' : 'password'}
                  value={prefix}
                  onChange={e => setPrefix(e.target.value.toUpperCase())}
                  placeholder="Enter secret role prefix"
                  required
                  autoFocus
                  autoComplete="off"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium tracking-widest"
                />
                <button
                  type="button"
                  onClick={() => setShowPrefix(!showPrefix)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPrefix ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Prefix input is masked for security. Click Verify to unlock credentials input.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center space-x-2 transition duration-150 disabled:opacity-50"
            >
              <span>{isLoading ? 'Verifying Prefix...' : 'Verify Prefix & Continue'}</span>
              <ShieldCheck className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* STEP 2: Phone Number & Password (Unlocked after prefix is verified) */}
        {step === 2 && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            {/* Verified Prefix Status Chip */}
            <div className="flex items-center justify-between p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 font-medium">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Security Prefix: <strong className="tracking-widest">••••</strong> (Verified)</span>
              </div>
              <button
                type="button"
                onClick={() => { setStep(1); setError(null); }}
                className="text-blue-600 hover:underline font-bold text-[11px]"
              >
                Change
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Registered Mobile Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium tracking-wide"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Administrator Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
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

        {/* STEP 3: Verify OTP Challenge */}
        {step === 3 && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Enter 6-Digit OTP {mobileMasked ? `(sent to ${mobileMasked})` : ''}
                </label>
                <button
                  type="button"
                  onClick={() => { setStep(2); setError(null); }}
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
          Protected by Prefix Gate, 2FA OTP & Single Active Session Policy
        </div>
      </div>
    </div>
  );
}