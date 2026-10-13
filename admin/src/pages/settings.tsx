import React, { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  DollarSign,
  ToggleLeft,
  ToggleRight,
  Percent,
  Plus,
  History,
  Tag,
  Wrench,
  Grid,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';
import {
  getIndiaCalendarToday,
  formatIndiaDateOnly,
  formatIndiaTimeOnly,
  parseIndiaIsoDateTime,
} from '../lib/date-utils';

type TabType = 'PLUMBER' | 'TILE_INSTALLER' | 'GST' | 'REDEMPTION';

const EMPTY_REWARD_FORM = {
  rewardPercentage: '',
  effectiveDate: '',
  effectiveTime: '',
  description: '',
};

function parseExplicitRewardPercentage(raw: string): number {
  if (!raw || !raw.trim()) {
    throw new Error(
      'Reward percentage is not configured. Enter the percentage explicitly.'
    );
  }

  const value = Number(raw.trim());

  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(
      'Enter an explicit reward percentage greater than 0 and no greater than 100.'
    );
  }

  if (Math.round(value * 100) !== value * 100) {
    throw new Error(
      'Reward percentage must have at most two decimal places.'
    );
  }

  return value;
}

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('PLUMBER');

  // Profession Rules State (Start in genuinely unconfigured state)
  const [plumberRules, setPlumberRules] = useState<any[]>([]);
  const [tileRules, setTileRules] = useState<any[]>([]);
  const [plumberForm, setPlumberForm] = useState(EMPTY_REWARD_FORM);
  const [tileForm, setTileForm] = useState(EMPTY_REWARD_FORM);

  // GST State (Start unconfigured, no default 18%)
  const [gstRules, setGstRules] = useState<any[]>([]);
  const [newGstRate, setNewGstRate] = useState('');
  const [newGstDescription, setNewGstDescription] = useState('');
  const [newGstDefault, setNewGstDefault] = useState(false);
  const [showAddGstModal, setShowAddGstModal] = useState(false);

  // Redemption Window State (Start disabled and unconfigured)
  const [isRedemptionEnabled, setIsRedemptionEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [userMessage, setUserMessage] = useState('Rewards redemption is currently open for verified craftsmen.');
  const [minimumRedemptionAmount, setMinimumRedemptionAmount] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchAllData = async () => {
    try {
      setLoading(true);

      // 1. Fetch Plumber rules
      const pRes = await AdminApiClient.getRewardRules('PLUMBER');
      if (pRes.rules && pRes.rules.length > 0) {
        setPlumberRules(pRes.rules);
        const active = pRes.rules.find((r: any) => r.isActive);
        if (active && active.rewardPercentage != null) {
          const fromDate = active.effectiveFrom ? new Date(active.effectiveFrom) : null;
          setPlumberForm({
            rewardPercentage: active.rewardPercentage.toString(),
            effectiveDate: fromDate ? formatIndiaDateOnly(fromDate) : '',
            effectiveTime: fromDate ? formatIndiaTimeOnly(fromDate) : '',
            description: active.description || '',
          });
        } else {
          setPlumberForm(EMPTY_REWARD_FORM);
        }
      } else {
        setPlumberRules([]);
        setPlumberForm(EMPTY_REWARD_FORM);
      }

      // 2. Fetch Tile Installer rules
      const tRes = await AdminApiClient.getRewardRules('TILE_INSTALLER');
      if (tRes.rules && tRes.rules.length > 0) {
        setTileRules(tRes.rules);
        const active = tRes.rules.find((r: any) => r.isActive);
        if (active && active.rewardPercentage != null) {
          const fromDate = active.effectiveFrom ? new Date(active.effectiveFrom) : null;
          setTileForm({
            rewardPercentage: active.rewardPercentage.toString(),
            effectiveDate: fromDate ? formatIndiaDateOnly(fromDate) : '',
            effectiveTime: fromDate ? formatIndiaTimeOnly(fromDate) : '',
            description: active.description || '',
          });
        } else {
          setTileForm(EMPTY_REWARD_FORM);
        }
      } else {
        setTileRules([]);
        setTileForm(EMPTY_REWARD_FORM);
      }

      // 3. Fetch GST Rules
      const gstRes = await AdminApiClient.getGstRules();
      if (gstRes.rules) {
        setGstRules(gstRes.rules);
      } else {
        setGstRules([]);
      }

      // 4. Fetch Redemption Settings
      const redRes = await AdminApiClient.getRedemptionSettings('ALL');
      if (redRes.settings) {
        const s = redRes.settings;
        setIsRedemptionEnabled(Boolean(s.isEnabled));
        if (s.message) setUserMessage(s.message);
        if (s.minimumRedemptionAmount !== undefined && s.minimumRedemptionAmount !== null) {
          setMinimumRedemptionAmount(s.minimumRedemptionAmount.toString());
        } else {
          setMinimumRedemptionAmount('');
        }

        if (s.startAt) {
          const d = new Date(s.startAt);
          setStartDate(formatIndiaDateOnly(d));
          setStartTime(formatIndiaTimeOnly(d));
        } else {
          setStartDate('');
          setStartTime('');
        }
        if (s.endAt) {
          const d = new Date(s.endAt);
          setEndDate(formatIndiaDateOnly(d));
          setEndTime(formatIndiaTimeOnly(d));
        } else {
          setEndDate('');
          setEndTime('');
        }
      }
    } catch (err: any) {
      console.error('Error fetching settings:', err);
      setErrorMsg(err.message || 'Failed to load configuration data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const clearAlerts = () => {
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  // Handle Saving Rule for Plumber or Tile Installer
  const handleSaveProfessionRule = async (e: React.FormEvent, prof: 'PLUMBER' | 'TILE_INSTALLER') => {
    e.preventDefault();
    setSaving(true);
    clearAlerts();

    const form = prof === 'PLUMBER' ? plumberForm : tileForm;
    try {
      const percentage = parseExplicitRewardPercentage(form.rewardPercentage);

      if (!form.effectiveDate || !form.effectiveTime) {
        throw new Error('Both effective date and effective time (Asia/Kolkata) are required.');
      }
      const effectiveFrom = parseIndiaIsoDateTime(form.effectiveDate, form.effectiveTime);

      await AdminApiClient.createRewardRule({
        profession: prof,
        rewardPercentage: percentage,
        effectiveFrom,
      });

      setSuccessMsg(`New versioned reward rule deployed for ${prof === 'PLUMBER' ? 'Plumbers' : 'Tile Installers'} effective ${form.effectiveDate} ${form.effectiveTime} IST! Historical approved bills remain financially immutable.`);
      await fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to update rule for ${prof}`);
    } finally {
      setSaving(false);
    }
  };

  // Handle Creating GST Rule
  const handleCreateGstRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    clearAlerts();

    try {
      const normalizedRate = newGstRate.trim();
      if (!normalizedRate) {
        throw new Error('GST rate is required. Enter the percentage explicitly.');
      }
      if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalizedRate)) {
        throw new Error('GST rate must be between 0.00% and 100.00% with at most 2 decimal places.');
      }
      const parsedRate = parseFloat(normalizedRate);
      if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        throw new Error('GST rate must be between 0.00% and 100.00%.');
      }

      await AdminApiClient.createGstRule({
        ratePercentage: parsedRate,
        description: newGstDescription.trim() || undefined,
        isDefault: newGstDefault,
      });

      setSuccessMsg(`New GST Rule (${parsedRate}%) created and active for invoice verification!`);
      setShowAddGstModal(false);
      setNewGstRate('');
      setNewGstDescription('');
      setNewGstDefault(false);
      await fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create GST rate');
    } finally {
      setSaving(false);
    }
  };

  // Handle Saving Redemption Settings
  const handleSaveRedemption = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    clearAlerts();

    try {
      let startAt: string | null = null;
      let endAt: string | null = null;

      if (isRedemptionEnabled) {
        if (!startDate || !startTime) {
          throw new Error('Both start date and start time are required to enable redemption.');
        }
        if (!endDate || !endTime) {
          throw new Error('Both end date and end time are required to enable redemption.');
        }
        startAt = parseIndiaIsoDateTime(startDate, startTime);
        endAt = parseIndiaIsoDateTime(endDate, endTime);

        if (new Date(endAt) <= new Date(startAt)) {
          throw new Error('End date and time must be after the start date and time.');
        }

        if (!minimumRedemptionAmount.trim()) {
          throw new Error('Minimum redemption threshold is required to enable redemption.');
        }
        const parsedMin = parseFloat(minimumRedemptionAmount.trim());
        if (!Number.isFinite(parsedMin) || parsedMin <= 0) {
          throw new Error('Minimum redemption threshold must be a valid positive number (e.g. 500).');
        }

        await AdminApiClient.updateRedemptionSettings({
          isEnabled: true,
          startAt,
          endAt,
          message: userMessage,
          minimumRedemptionAmount: parsedMin,
        });
      } else {
        if (startDate && startTime) {
          startAt = parseIndiaIsoDateTime(startDate, startTime);
        }
        if (endDate && endTime) {
          endAt = parseIndiaIsoDateTime(endDate, endTime);
        }
        const parsedMin = minimumRedemptionAmount.trim() ? parseFloat(minimumRedemptionAmount.trim()) : null;

        await AdminApiClient.updateRedemptionSettings({
          isEnabled: false,
          startAt,
          endAt,
          message: userMessage,
          minimumRedemptionAmount: parsedMin,
        });
      }

      setSuccessMsg('Redemption window settings saved and enforced for mobile workers!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save redemption window settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Business Rules & System Configuration
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Dynamic admin control over reward percentages, GST rates, and redemption windows
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 mb-6 space-x-2">
          <button
            onClick={() => { setActiveTab('PLUMBER'); clearAlerts(); }}
            className={`pb-3 px-4 text-xs font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'PLUMBER'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>Plumber Rules</span>
          </button>

          <button
            onClick={() => { setActiveTab('TILE_INSTALLER'); clearAlerts(); }}
            className={`pb-3 px-4 text-xs font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'TILE_INSTALLER'
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Grid className="w-4 h-4" />
            <span>Tile Installer Rules</span>
          </button>

          <button
            onClick={() => { setActiveTab('GST'); clearAlerts(); }}
            className={`pb-3 px-4 text-xs font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'GST'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Percent className="w-4 h-4" />
            <span>GST & Tax Rates</span>
          </button>

          <button
            onClick={() => { setActiveTab('REDEMPTION'); clearAlerts(); }}
            className={`pb-3 px-4 text-xs font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'REDEMPTION'
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Redemption Windows</span>
          </button>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* TAB 1 & 2: Plumber & Tile Installer Rules */}
        {(activeTab === 'PLUMBER' || activeTab === 'TILE_INSTALLER') && (
          <div className="space-y-8">
            <div className="bg-white rounded-3xl p-7 border border-slate-200/80 shadow-sm">
              <div className="flex items-center space-x-3 pb-5 border-b border-slate-100 mb-6">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  activeTab === 'PLUMBER' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                }`}>
                  {activeTab === 'PLUMBER' ? <Wrench className="w-5 h-5" /> : <Grid className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {activeTab === 'PLUMBER' ? 'Plumber' : 'Tile Installer'} Incentive Parameters
                  </h2>
                  <p className="text-xs text-slate-400">
                    Versioned rule configuration. Modifying creates an immutable new version; historical bills remain preserved.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(e) => handleSaveProfessionRule(e, activeTab)}
                className="space-y-5"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Reward Rate Percentage (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="100.0"
                      value={activeTab === 'PLUMBER' ? plumberForm.rewardPercentage : tileForm.rewardPercentage}
                      onChange={(e) =>
                        activeTab === 'PLUMBER'
                          ? setPlumberForm({ ...plumberForm, rewardPercentage: e.target.value })
                          : setTileForm({ ...tileForm, rewardPercentage: e.target.value })
                      }
                      placeholder="e.g. 0.50 (explicit required)"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Internal calculation rate applied to verified eligible bill amount (positive decimal, 2 decimal precision)
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Effective Date (Asia/Kolkata)
                    </label>
                    <input
                      type="date"
                      value={activeTab === 'PLUMBER' ? plumberForm.effectiveDate : tileForm.effectiveDate}
                      onChange={(e) =>
                        activeTab === 'PLUMBER'
                          ? setPlumberForm({ ...plumberForm, effectiveDate: e.target.value })
                          : setTileForm({ ...tileForm, effectiveDate: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Calendar date in IST when rule becomes active.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Effective Time (Asia/Kolkata)
                    </label>
                    <input
                      type="time"
                      value={activeTab === 'PLUMBER' ? plumberForm.effectiveTime : tileForm.effectiveTime}
                      onChange={(e) =>
                        activeTab === 'PLUMBER'
                          ? setPlumberForm({ ...plumberForm, effectiveTime: e.target.value })
                          : setTileForm({ ...tileForm, effectiveTime: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Exact time in IST. Bills submitted prior to this time keep earlier rates.
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white flex items-center space-x-2 transition disabled:opacity-50 ${
                      activeTab === 'PLUMBER' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Deploying...' : 'Deploy Versioned Rule'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Version History Table */}
            <div className="bg-white rounded-3xl p-7 border border-slate-200/80 shadow-sm">
              <div className="flex items-center space-x-3 pb-5 border-b border-slate-100 mb-4">
                <History className="w-5 h-5 text-slate-500" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {activeTab === 'PLUMBER' ? 'Plumber' : 'Tile'} Rule Version History (Audit Ledger)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Past rules are preserved forever so historical approved bills never change
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                    <tr>
                      <th className="py-2.5 px-4">Version</th>
                      <th className="py-2.5 px-4">Reward Rate</th>
                      <th className="py-2.5 px-4">Effective From</th>
                      <th className="py-2.5 px-4">Effective Until</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(activeTab === 'PLUMBER' ? plumberRules : tileRules).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          <span className="font-bold text-slate-500 block mb-1">Not configured</span>
                          No versioned reward rules configured for {activeTab === 'PLUMBER' ? 'Plumbers' : 'Tile Installers'}. Operations Admin must deploy a rule before rewards can be calculated.
                        </td>
                      </tr>
                    ) : (
                      (activeTab === 'PLUMBER' ? plumberRules : tileRules).map((r: any, idx: number, arr: any[]) => {
                        const now = new Date();
                        const fromDate = r.effectiveFrom ? new Date(r.effectiveFrom) : null;
                        let untilDate = r.effectiveUntil ? new Date(r.effectiveUntil) : null;

                        // Derive validity until date dynamically from chronological timeline if open-ended
                        if (!untilDate && fromDate) {
                          const chronologicallyLater = arr
                            .filter((other: any) => other.isActive && new Date(other.effectiveFrom) > fromDate)
                            .sort((a: any, b: any) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime())[0];
                          if (chronologicallyLater) {
                            untilDate = new Date(chronologicallyLater.effectiveFrom);
                          }
                        }

                        let statusBadge = { label: 'CURRENT', badgeClass: 'bg-emerald-100 text-emerald-700' };
                        if (!r.isActive) {
                          statusBadge = { label: 'INACTIVE', badgeClass: 'bg-slate-100 text-slate-500' };
                        } else if (fromDate && fromDate > now) {
                          statusBadge = { label: 'SCHEDULED', badgeClass: 'bg-blue-100 text-blue-700' };
                        } else if (untilDate && untilDate <= now) {
                          statusBadge = { label: 'HISTORICAL', badgeClass: 'bg-amber-100 text-amber-800' };
                        }

                        return (
                          <tr key={r.id}>
                            <td className="py-3 px-4 font-bold text-slate-900">v{r.version}</td>
                            <td className="py-3 px-4 font-bold text-emerald-600">{r.rewardPercentage || r.percentage}%</td>
                            <td className="py-3 px-4 text-slate-600 font-medium">
                              {fromDate ? fromDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Beginning'}
                            </td>
                            <td className="py-3 px-4 text-slate-500">
                              {untilDate ? untilDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Present (Open-ended)'}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusBadge.badgeClass}`}>
                                {statusBadge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: GST & Tax Rates */}
        {activeTab === 'GST' && (
          <div className="space-y-8">
            <div className="bg-white rounded-3xl p-7 border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between pb-5 border-b border-slate-100 mb-6">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <Percent className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">GST Rates & Tax Treatment</h2>
                    <p className="text-xs text-slate-400">
                      Configure standard tax percentages for dynamic reverse-GST calculations
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowAddGstModal(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add GST Rate</span>
                </button>
              </div>

              {/* GST Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                    <tr>
                      <th className="py-3 px-4">Rate (%)</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Default</th>
                      <th className="py-3 px-4">Effective Date</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gstRules.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 font-medium">
                          No GST tax rules configured. Please add a GST rate to enable bill processing with GST.
                        </td>
                      </tr>
                    ) : (
                      gstRules.map((g: any) => (
                        <tr key={g.id} className="hover:bg-slate-50/70 transition">
                          <td className="py-3.5 px-4 font-black text-slate-900 text-sm">{g.ratePercentage}%</td>
                          <td className="py-3.5 px-4 text-slate-700 font-medium">{g.description || '—'}</td>
                          <td className="py-3.5 px-4">
                            {g.isDefault ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                                DEFAULT
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500">
                            {new Date(g.effectiveFrom).toLocaleDateString('en-IN')}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              g.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {g.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal for adding GST Rule */}
            {showAddGstModal && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95">
                  <h3 className="text-base font-bold text-slate-900 mb-1">Add New GST Rate</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Creates an active tax rule for bill verification calculations.
                  </p>

                  <form onSubmit={handleCreateGstRule} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        GST Rate (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="50"
                        value={newGstRate}
                        onChange={(e) => setNewGstRate(e.target.value)}
                        placeholder="e.g. 18 or 12"
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Description / Label
                      </label>
                      <input
                        type="text"
                        value={newGstDescription}
                        onChange={(e) => setNewGstDescription(e.target.value)}
                        placeholder="e.g. Standard Plumbing Materials (18%)"
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                        required
                      />
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <input
                        type="checkbox"
                        id="isDefault"
                        checked={newGstDefault}
                        onChange={(e) => setNewGstDefault(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <label htmlFor="isDefault" className="text-xs font-bold text-slate-700">
                        Set as Default Rate for new bill verifications
                      </label>
                    </div>

                    <div className="flex justify-end space-x-2 pt-4">
                      <button
                        type="button"
                        onClick={() => setShowAddGstModal(false)}
                        className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50"
                      >
                        {saving ? 'Creating...' : 'Save GST Rate'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Redemption Window */}
        {activeTab === 'REDEMPTION' && (
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
                    Minimum Redemption Threshold (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-400">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={minimumRedemptionAmount}
                      onChange={(e) => setMinimumRedemptionAmount(e.target.value)}
                      placeholder="e.g. 500"
                      className="w-full pl-8 pr-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800"
                      required
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Workers must have at least this available balance before redemption illuminates
                  </span>
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
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Displayed on worker mobile wallet & rewards dashboard
                  </span>
                </div>
              </div>

              <div className="p-4 bg-amber-50/60 border border-amber-200/80 rounded-2xl">
                <p className="text-xs font-bold text-amber-900 mb-1">
                  100% Full-Balance Redemption Policy Enforced
                </p>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Mobile workers must accumulate at least ₹{minimumRedemptionAmount || '0'} to initiate redemption during an active window. When redeemed, their entire available balance is transferred in full — no partial amounts, no pool restrictions, and no ₹50,000 monthly rewards caps.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Redemption Window'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
