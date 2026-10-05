import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Shield, Lock, Phone, AlertCircle, ArrowRight } from 'lucide-react';
import { AdminApiClient } from '../lib/api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('9999999999');
  const [password, setPassword] = useState('Admin@123');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await AdminApiClient.login(username, password);
      AdminApiClient.setToken(res.token);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Invalid administrator credentials');
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
        <div className="text-center mb-8">
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

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Admin Mobile / Username
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter admin identifier"
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Password
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

          <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-[11px] text-blue-800">
            <div className="font-bold flex items-center space-x-1 mb-0.5">
              <Shield className="w-3.5 h-3.5 text-blue-600" />
              <span>Demo Admin Credentials Pre-Filled:</span>
            </div>
            <div>Username: <span className="font-mono font-bold">9999999999</span></div>
            <div>Password: <span className="font-mono font-bold">Admin@123</span></div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center space-x-2 transition duration-150 disabled:opacity-50"
          >
            <span>{isLoading ? 'Verifying Credentials...' : 'Sign In to Dashboard'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-8 text-center text-[11px] text-slate-400">
          Protected by Argon2/Bcrypt & Enterprise RBAC
        </div>
      </div>
    </div>
  );
}
