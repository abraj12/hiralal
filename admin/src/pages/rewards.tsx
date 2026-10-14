import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Gift,
  TrendingUp,
  AlertCircle,
  RefreshCw,
  Loader2,
  Wallet,
  ArrowUpRight,
  CheckCircle2,
  Settings,
  Wrench,
  Grid,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminRewardsPage() {
  const [data, setData] = useState<any>(null);
  const [plumberRule, setPlumberRule] = useState<any>(null);
  const [tileRule, setTileRule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const [dashRes, pRulesRes, tRulesRes] = await Promise.all([
        AdminApiClient.getDashboard(),
        AdminApiClient.getRewardRules('PLUMBER').catch(() => ({ rules: [] })),
        AdminApiClient.getRewardRules('TILE_INSTALLER').catch(() => ({ rules: [] })),
      ]);
      setData(dashRes);

      const activePlumber = (pRulesRes.rules || []).find((r: any) => r.isActive) || (pRulesRes.rules || [])[0];
      const activeTile = (tRulesRes.rules || []).find((r: any) => r.isActive) || (tRulesRes.rules || [])[0];
      setPlumberRule(activePlumber || null);
      setTileRule(activeTile || null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch reward financial data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const stats = data?.stats || {
    rewardsThisMonth: 0,
    totalRewardsCredited: 0,
    availableWalletLiability: 0,
    reservedWalletLiability: 0,
    pendingPayouts: 0,
    pendingPayoutAmount: 0,
    successfulPayouts: 0,
    totalRedeemed: 0,
  };

  const programTotals = data?.stats?.programTotals || {
    PLUMBER: { totalAllocated: 0, count: 0, averageReward: 0 },
    TILE_INSTALLER: { totalAllocated: 0, count: 0, averageReward: 0 },
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar pendingPayoutsCount={stats.pendingPayouts} />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Reward Analytics & Financial Ledger
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Real-time incentive distribution, partner profession breakdowns, and wallet liabilities
            </p>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start space-x-3 text-red-800">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-bold">Failed to load reward ledger data</h4>
              <p className="text-xs text-red-700 mt-0.5">{error}</p>
            </div>
            <button
              onClick={fetchStats}
              className="text-xs font-bold text-red-700 underline hover:text-red-900"
            >
              Retry
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-600">Loading live reward analytics...</p>
          </div>
        ) : (
          <>
            {/* Financial Ledger Summary Grid */}
            <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Available Wallet Liability
                  </span>
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <Wallet className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  ₹{Number(stats.availableWalletLiability || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Payable on demand to trade partners</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Incentives Credited (Month)
                  </span>
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Gift className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  ₹{Number(stats.rewardsThisMonth || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Current monthly cycle credits</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Lifetime Rewards Credited
                  </span>
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  ₹{Number(stats.totalRewardsCredited || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">All-time ledger credits</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Settled Disbursements
                  </span>
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900">
                  ₹{Number(stats.totalRedeemed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">{stats.successfulPayouts || 0} successful payouts</p>
              </div>
            </div>

            {/* Active Reward Rules Card */}
            <div className="mb-8 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Active Versioned Incentive Rules</h3>
                  <p className="text-xs text-slate-400">Current dynamic percentage rates applied upon bill approvals</p>
                </div>
                <Link
                  href="/settings"
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Configure In Settings</span>
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-xs">Plumbers Incentive Rate</div>
                      <div className="text-[11px] text-slate-500">
                        {plumberRule ? `Rule v${plumberRule.version} • Effective ${new Date(plumberRule.effectiveFrom).toLocaleDateString('en-IN')}` : 'Rule not yet deployed'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xl font-black text-blue-600">
                    {plumberRule ? `${plumberRule.rewardPercentage}%` : '—'}
                  </div>
                </div>

                <div className="p-4 bg-orange-50/60 border border-orange-100 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center font-bold">
                      <Grid className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-xs">Tile Installers Incentive Rate</div>
                      <div className="text-[11px] text-slate-500">
                        {tileRule ? `Rule v${tileRule.version} • Effective ${new Date(tileRule.effectiveFrom).toLocaleDateString('en-IN')}` : 'Rule not yet deployed'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xl font-black text-orange-600">
                    {tileRule ? `${tileRule.rewardPercentage}%` : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Profession Program Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Plumbing Program Allocation</h3>
                <p className="text-xs text-slate-500 mb-4">Reward disbursements for pipes, fittings & sanitary invoices</p>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-blue-600">
                    ₹{programTotals.PLUMBER.totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">allocated this cycle</span>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between items-center">
                  <span>Average Reward / Bill</span>
                  <span className="font-bold text-slate-800">
                    ₹{programTotals.PLUMBER.averageReward.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400 flex justify-between items-center">
                  <span>Rewarded Bills</span>
                  <span className="font-semibold text-slate-600">{programTotals.PLUMBER.count}</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Tiles Program Allocation</h3>
                <p className="text-xs text-slate-500 mb-4">Reward disbursements for ceramic, floor tiles & adhesives</p>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-orange-600">
                    ₹{programTotals.TILE_INSTALLER.totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">allocated this cycle</span>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between items-center">
                  <span>Average Reward / Bill</span>
                  <span className="font-bold text-slate-800">
                    ₹{programTotals.TILE_INSTALLER.averageReward.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400 flex justify-between items-center">
                  <span>Rewarded Bills</span>
                  <span className="font-semibold text-slate-600">{programTotals.TILE_INSTALLER.count}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
