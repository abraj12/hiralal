import React, { useEffect, useState } from 'react';
import { Gift, TrendingUp, DollarSign } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import RewardPoolBar from '../components/RewardPoolBar';
import { AdminApiClient } from '../lib/api';

export default function AdminRewardsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await AdminApiClient.getDashboard();
        setData(res);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const stats = data?.stats || {
    pool: {
      totalPoolCap: 50000,
      usedAmount: 37850,
      remainingAmount: 12150,
      percentageUsed: 75.7,
      isCapped: false,
    },
    rewardsThisMonth: 37850,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Reward Pool & Financial Ledger
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time monthly pool utilization, profession breakdowns, and reward distribution
          </p>
        </div>

        <div className="mb-8">
          <RewardPoolBar
            totalPoolCap={stats.pool.totalPoolCap}
            usedAmount={stats.pool.usedAmount}
            remainingAmount={stats.pool.remainingAmount}
            percentageUsed={stats.pool.percentageUsed}
            isCapped={stats.pool.isCapped}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Plumbing Program Allocation</h3>
            <p className="text-xs text-slate-500 mb-4">Reward disbursements for pipes, fittings & sanitary invoices</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-blue-600">₹21,450</span>
              <span className="text-xs font-semibold text-slate-400">allocated this cycle</span>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Average Reward / Bill</span>
              <span className="font-bold text-slate-800">₹320.00</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Tiles Program Allocation</h3>
            <p className="text-xs text-slate-500 mb-4">Reward disbursements for ceramic, floor tiles & adhesives</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-orange-600">₹16,400</span>
              <span className="text-xs font-semibold text-slate-400">allocated this cycle</span>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Average Reward / Bill</span>
              <span className="font-bold text-slate-800">₹380.00</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
