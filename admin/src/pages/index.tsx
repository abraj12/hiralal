import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Users,
  FileText,
  Gift,
  Clock,
  ArrowUpRight,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BillVerificationModal from '../components/BillVerificationModal';
import { AdminApiClient } from '../lib/api';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [profession, setProfession] = useState('ALL');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<any>(null);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getDashboard(profession);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [profession]);

  const stats = data?.stats || {
    totalUsers: 0,
    plumbersCount: 0,
    tilesCount: 0,
    pendingBills: 0,
    rewardsThisMonth: 0,
    totalRewardsCredited: 0,
    availableWalletLiability: 0,
    reservedWalletLiability: 0,
    pendingPayouts: 0,
    pendingPayoutAmount: 0,
    successfulPayouts: 0,
    totalRedeemed: 0,
  };

  const recentBills = data?.recentBills || [];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar pendingBillsCount={stats.pendingBills} />

      <main className="flex-1 ml-64 p-8">
        {/* Top Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Executive Dashboard
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Hiralal & Sons Sales Pvt. Ltd. • Plumber & Tiles Rewards Overview
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Profession Filter */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'PLUMBER', 'TILE_INSTALLER'].map(pf => (
                <button
                  key={pf}
                  onClick={() => setProfession(pf)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    profession === pf ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {pf === 'ALL' ? 'Overall' : pf === 'PLUMBER' ? 'Plumbers' : 'Tiles'}
                </button>
              ))}
            </div>

            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-ping" />
              Live Backend Active
            </span>
          </div>
        </div>

        {/* Top 4 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {/* Card 1: Users */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Total Professionals
              </span>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900">{stats.totalUsers}</div>
            <div className="flex items-center space-x-2 mt-2 text-xs text-slate-500 font-medium">
              <span className="text-blue-600 font-bold">{stats.plumbersCount} Plumbers</span>
              <span>•</span>
              <span className="text-orange-600 font-bold">{stats.tilesCount} Tile Installers</span>
            </div>
          </div>

          {/* Card 2: Pending Bills */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pending Verification
              </span>
              <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900">{stats.pendingBills}</div>
            <div className="mt-2">
              <button
                onClick={() => router.push('/bills')}
                className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center space-x-1"
              >
                <span>Verify bills queue</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Card 3: Rewards this month */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Approved This Month
              </span>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Gift className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900">
              ₹{stats.rewardsThisMonth.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-400 mt-2 font-medium">
              Dynamic incentive rules applied
            </div>
          </div>

          {/* Card 4: Pending Payouts */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pending Payouts
              </span>
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900">{stats.pendingPayouts}</div>
            <div className="mt-2">
              <button
                onClick={() => router.push('/payouts')}
                className="text-xs font-bold text-purple-600 hover:text-purple-700 flex items-center space-x-1"
              >
                <span>RazorpayX payouts</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Financial Liability & Solvency Summary */}
        <div className="mb-8 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Wallet Liability & Payout Solvency</h2>
              <p className="text-xs text-slate-500">Live ledger balances across all registered trade partners</p>
            </div>
            <button
              onClick={() => router.push('/rewards')}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
            >
              <span>Detailed analytics</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl">
              <span className="text-xs font-semibold text-slate-500 block mb-1">Available Wallet Liability</span>
              <span className="text-xl font-black text-slate-900">
                ₹{Number(stats.availableWalletLiability || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400 block mt-1">Payable on demand</span>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl">
              <span className="text-xs font-semibold text-amber-700 block mb-1">Reserved In-Flight</span>
              <span className="text-xl font-black text-amber-900">
                ₹{Number(stats.reservedWalletLiability || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-amber-600 block mt-1">Pending payout approval</span>
            </div>
            <div className="p-4 bg-emerald-50 rounded-xl">
              <span className="text-xs font-semibold text-emerald-700 block mb-1">Total Rewards Credited</span>
              <span className="text-xl font-black text-emerald-900">
                ₹{Number(stats.totalRewardsCredited || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-emerald-600 block mt-1">All-time ledger credits</span>
            </div>
            <div className="p-4 bg-purple-50 rounded-xl">
              <span className="text-xs font-semibold text-purple-700 block mb-1">Settled Disbursements</span>
              <span className="text-xl font-black text-purple-900">
                ₹{Number(stats.totalRedeemed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-purple-600 block mt-1">Disbursed via RazorpayX</span>
            </div>
          </div>
        </div>

        {/* Section 3: Recent Bills Verification Queue */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Recent Bill Submissions</h2>
              <p className="text-xs text-slate-500">Live invoices awaiting or recently completed verification</p>
            </div>
            <button
              onClick={() => router.push('/bills')}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
            >
              <span>View all bills</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
                <tr>
                  <th className="py-3.5 px-5">Invoice Number</th>
                  <th className="py-3.5 px-4">Professional</th>
                  <th className="py-3.5 px-4">Profession</th>
                  <th className="py-3.5 px-4">Bill Amount</th>
                  <th className="py-3.5 px-4">Reward</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentBills.map((b: any) => {
                  const isPlumber = b.userProfession === 'PLUMBER';
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-5 font-bold text-slate-900">{b.invoiceNumber}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{b.userFullName}</div>
                        <div className="text-[11px] text-slate-400">{b.userMobile}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            isPlumber
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-orange-50 text-orange-700'
                          }`}
                        >
                          {isPlumber ? 'Plumber' : 'Tiles'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        ₹{b.billAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-emerald-600">
                        ₹{b.calculatedReward.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            b.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : b.status === 'REJECTED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => setSelectedBill(b)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg font-bold text-xs transition"
                        >
                          Inspect & Verify
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Bill Verification Modal */}
      {selectedBill && (
        <BillVerificationModal
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onVerified={fetchDashboard}
        />
      )}
    </div>
  );
}
