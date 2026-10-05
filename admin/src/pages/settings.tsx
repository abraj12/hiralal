import React, { useEffect, useState } from 'react';
import { Settings, Save, ShieldCheck, AlertCircle, CheckCircle2, Calendar, Clock, DollarSign, ToggleLeft, ToggleRight } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminSettingsPage() {
  // Reward Rules State
  const [percentage, setPercentage] = useState('0.5');
  const [monthlyPoolLimit, setMonthlyPoolLimit] = useState('50000');
  const [minRedemptionAmount, setMinRedemptionAmount] = useState('500');

  // Redemption Window State
  const [isRedemptionEnabled, setIsRedemptionEnabled] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('23:59');
  const [redemptionMin, setRedemptionMin] = useState('500');
  const [redemptionMax, setRedemptionMax] = useState('10000');
  const [userMessage, setUserMessage] = useState('Rewards redemption is currently open for verified craftsmen.');

  const [loading, setLoading] = useState(true);
  const [savingRules, setSavingRules] = useState(false);
  const [savingRedemption, setSavingRedemption] = useState(false);
  const [rulesSuccess, setRulesSuccess] = useState<string | null>(null);
  const [redemptionSuccess, setRedemptionSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch reward rules
        const rulesRes = await AdminApiClient.getRewardRules();
        if (rulesRes.rules && rulesRes.rules.length > 0) {
          const rule = rulesRes.rules[0];
          setPercentage(rule.percentage.toString());
          setMonthlyPoolLimit(rule.monthlyPoolLimit.toString());
          setMinRedemptionAmount(rule.minRedemptionAmount.toString());
        }

        // 2. Fetch redemption window settings
        const redRes = await AdminApiClient.getRedemptionSettings();
        if (redRes.settings) {
          const s = redRes.settings;
          setIsRedemptionEnabled(Boolean(s.isEnabled));
          setRedemptionMin(s.minimumAmount.toString());
          setRedemptionMax(s.maximumAmount.toString());
          if (s.message) setUserMessage(s.message);

          if (s.startAt) {
            const d = new Date(s.startAt);
            setStartDate(d.toISOString().split('T')[0]);
            setStartTime(d.toTimeString().substring(0, 5));
          }
          if (s.endAt) {
            const d = new Date(s.endAt);
            setEndDate(d.toISOString().split('T')[0]);
            setEndTime(d.toTimeString().substring(0, 5));
          }
        }
      } catch (err: any) {
        console.error('Error fetching settings:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRules(true);
    setRulesSuccess(null);
    setErrorMsg(null);

    try {
      await AdminApiClient.updateRewardRules({
        percentage: parseFloat(percentage),
        monthlyPoolLimit: parseFloat(monthlyPoolLimit),
        minRedemptionAmount: parseFloat(minRedemptionAmount),
      });
      setRulesSuccess('Reward percentage and pool limit updated and logged to audit trail!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update reward rules');
    } finally {
      setSavingRules(false);
    }
  };

  const handleSaveRedemption = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRedemption(true);
    setRedemptionSuccess(null);
    setErrorMsg(null);

    try {
      let startAt: string | null = null;
      let endAt: string | null = null;

      if (startDate) {
        startAt = new Date(`${startDate}T${startTime}:00`).toISOString();
      }
      if (endDate) {
        endAt = new Date(`${endDate}T${endTime}:00`).toISOString();
      }

      if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
        throw new Error('End date and time must be after the start date and time.');
      }

      const minVal = parseFloat(redemptionMin);
      const maxVal = parseFloat(redemptionMax);
      if (minVal <= 0 || maxVal < minVal) {
        throw new Error('Maximum redemption must be greater than or equal to minimum redemption amount.');
      }

      await AdminApiClient.updateRedemptionSettings({
        isEnabled: isRedemptionEnabled,
        startAt,
        endAt,
        minimumAmount: minVal,
        maximumAmount: maxVal,
        message: userMessage,
      });

      setRedemptionSuccess('Redemption window settings saved successfully and active for mobile users!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save redemption window settings');
    } finally {
      setSavingRedemption(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            System & Redemption Settings
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure financial payout percentages, monthly reward pool caps, and arbitrary redemption windows
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-8">
          {/* Section 1: Admin Redemption Window Controller */}
          <div className="bg-white rounded-3xl p-7 border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between pb-5 border-b border-slate-100 mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Arbitrary Redemption Window</h2>
                  <p className="text-xs text-slate-400">
                    Open or close rewards redemption anytime (Not hardcoded to festivals)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRedemptionEnabled(!isRedemptionEnabled)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                  isRedemptionEnabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isRedemptionEnabled ? (
                  <>
                    <ToggleRight className="w-5 h-5 text-emerald-600" />
                    <span>Redemption Status: ACTIVE (ON)</span>
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-5 h-5 text-slate-400" />
                    <span>Redemption Status: DISABLED (OFF)</span>
                  </>
                )}
              </button>
            </div>

            {redemptionSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{redemptionSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSaveRedemption} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Start Window (Date & Time - Asia/Kolkata)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    />
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">When redemptions become active</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    End Window (Date & Time - Asia/Kolkata)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    />
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">When redemptions automatically close</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Minimum Redemption Limit (₹)
                  </label>
                  <input
                    type="number"
                    min="100"
                    step="50"
                    value={redemptionMin}
                    onChange={(e) => setRedemptionMin(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Default minimum: ₹500</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Maximum Redemption Limit Per Request (₹)
                  </label>
                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={redemptionMax}
                    onChange={(e) => setRedemptionMax(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Maximum ceiling per transfer: ₹10,000</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  User-Facing Redemption Status Message
                </label>
                <input
                  type="text"
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  placeholder="e.g. Rewards redemption is open from 20 Oct to 25 Oct 2026."
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingRedemption}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingRedemption ? 'Saving...' : 'Save Redemption Window'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Section 2: Program Financial Rules */}
          <div className="bg-white rounded-3xl p-7 border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 pb-5 border-b border-slate-100 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Financial Reward Parameters</h2>
                <p className="text-xs text-slate-400">
                  Global percentage and monthly ceiling (Atomic database enforcement)
                </p>
              </div>
            </div>

            {rulesSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{rulesSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSaveRules} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Reward Percentage Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="5.0"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">0.5% yields ₹50 reward per ₹10,000 bill</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Monthly Reward Pool Limit (₹)
                  </label>
                  <input
                    type="number"
                    step="1000"
                    min="5000"
                    value={monthlyPoolLimit}
                    onChange={(e) => setMonthlyPoolLimit(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Default monthly cap: ₹50,000</span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingRules}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingRules ? 'Updating...' : 'Save Financial Rules'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
