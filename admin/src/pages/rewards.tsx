import React, { useEffect, useState } from 'react';
import { Gift, TrendingUp, DollarSign, AlertCircle, RefreshCw, Loader2, Wallet, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminRewardsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await AdminApiClient.getDashboard();
      setData(res);
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
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="mb-8 flex items-center justify-between">
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
