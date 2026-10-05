import React, { useEffect, useState } from 'react';
import { Settings, Save, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminSettingsPage() {
  const [percentage, setPercentage] = useState('0.5');
  const [monthlyPoolLimit, setMonthlyPoolLimit] = useState('50000');
  const [minRedemptionAmount, setMinRedemptionAmount] = useState('500');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchRules = async () => {
      try {
        const res = await AdminApiClient.getRewardRules();
        if (res.rules) {
          setPercentage(res.rules.percentage.toString());
          setMonthlyPoolLimit(res.rules.monthlyPoolLimit.toString());
          setMinRedemptionAmount(res.rules.minRedemptionAmount.toString());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchRules();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await AdminApiClient.updateRewardRules({
        percentage: parseFloat(percentage),
        monthlyPoolLimit: parseFloat(monthlyPoolLimit),
        minRedemptionAmount: parseFloat(minRedemptionAmount),
      });
      setSuccessMsg('Settings updated and logged to audit trail successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Program Reward Settings
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure financial payout percentages, monthly reward pool caps, and audit logging
          </p>
        </div>

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Reward Percentage (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="10.0"
                  value={percentage}
                  onChange={e => setPercentage(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <span className="absolute right-4 top-2.5 text-xs font-bold text-slate-400">%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                E.g. 0.5% means ₹1,00,000 bill receives ₹500 reward.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Monthly Reward Pool Cap (₹)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1000"
                  min="5000"
                  value={monthlyPoolLimit}
                  onChange={e => setMonthlyPoolLimit(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <span className="absolute right-4 top-2.5 text-xs font-bold text-slate-400">INR</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Atomic monthly ceiling (default: ₹50,000 per month).
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Minimum Redemption Amount (₹)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="100"
                  min="100"
                  value={minRedemptionAmount}
                  onChange={e => setMinRedemptionAmount(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <span className="absolute right-4 top-2.5 text-xs font-bold text-slate-400">INR</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Minimum balance required before worker can trigger payout.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 text-xs text-slate-600 flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold text-slate-800">Compliance & Audit Trail:</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Every modification to reward percentage and monthly limits is automatically recorded in the immutable audit log with administrator ID, previous value, new value, and timestamp.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-200 flex items-center space-x-2 transition"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Updating Rules...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
