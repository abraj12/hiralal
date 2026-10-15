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
  XCircle,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BillVerificationModal from '../components/BillVerificationModal';
import { AdminApiClient } from '../lib/api';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profession, setProfession] = useState('ALL');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [readOnlyBill, setReadOnlyBill] = useState<any>(null);

  useEffect(() => {
    setCurrentUser(AdminApiClient.getUser());
  }, []);

  const isOperationsAdmin = currentUser?.role === 'OPERATIONS_ADMIN';

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
    kycVerifiedCount: 0,
    pendingBills: 0,
    approvedBillsCount: 0,
    rejectedBillsCount: 0,
    rewardsThisMonth: 0,
    totalRewardsCredited: 0,
    availableWalletLiability: 0,
    reservedWalletLiability: 0,
    pendingPayouts: 0,
    pendingPayoutAmount: 0,
    successfulPayouts: 0,
    totalRedeemed: 0,
    failedPayouts: 0,
    failedPayoutAmount: 0,
  };

  const recentBills = data?.recentBills || [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar
        pendingBillsCount={stats.pendingBills}
        pendingPayoutsCount={stats.pendingPayouts}
      />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {isOperationsAdmin ? 'Executive Operations Dashboard' : 'Bill Review Executive Dashboard'}
              </h1>
              {!isOperationsAdmin && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                  Bill Admin
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isOperationsAdmin
                ? 'Hiralal & Sons Sales Pvt. Ltd. • Plumber & Tiles Rewards Overview'
                : 'Hiralal & Sons Sales Pvt. Ltd. • Plumber & Tiles Invoice Verification & Rewards Overview'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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

        {/* Executive Hero Banner */}
        {isOperationsAdmin ? (
          <div className="mb-8 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-7 text-white shadow-xl relative overflow-hidden border border-slate-700/50 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="max-w-xl z-10">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 mb-3">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Operations Command & Rewards Network</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                Plumber & Tile Artisan Rewards Infrastructure
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                Real-time visibility into verified contractor enrollments, invoice cashback disbursements, wallet liabilities, and secure banking settlements.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  onClick={() => router.push('/payouts')}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-900/30 transition flex items-center space-x-1.5"
                >
                  <span>Manage Bank Payouts ({stats.pendingPayouts})</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => router.push('/users')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-bold transition flex items-center space-x-1.5"
                >
                  <span>View Directory ({stats.totalUsers})</span>
                </button>
              </div>
            </div>
            <div className="w-full sm:w-64 md:w-80 h-44 sm:h-48 relative flex-shrink-0 flex items-center justify-center">
              <img
                src="/assets/admin_operations_hero.png"
                alt="Operations Control Hub"
                className="max-h-full max-w-full object-contain drop-shadow-2xl"
              />
            </div>
          </div>
        ) : (
          <div className="mb-8 rounded-3xl bg-gradient-to-r from-blue-950 via-slate-900 to-blue-900 p-6 sm:p-7 text-white shadow-xl relative overflow-hidden border border-blue-900/40 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="max-w-xl z-10">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 mb-3">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Invoice Verification Command</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                Authorized Dealer Invoices & Cashback Queue
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                Review submitted dealer invoices, verify GST compliance, validate product item categories, and disburse cashback rewards.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  onClick={() => router.push('/bills')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-900/30 transition flex items-center space-x-1.5"
                >
                  <span>Pending Invoices ({stats.pendingBills})</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <div className="text-xs text-blue-200 font-medium flex items-center space-x-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>{stats.approvedBillsCount} Verified to Date</span>
                </div>
              </div>
            </div>
            <div className="w-full sm:w-64 md:w-80 h-44 sm:h-48 relative flex-shrink-0 flex items-center justify-center">
              <img
                src="/assets/admin_bill_review_hero.png"
                alt="Invoice Verification Center"
                className="max-h-full max-w-full object-contain drop-shadow-2xl"
              />
            </div>
          </div>
        )}

        {/* Top 4 Metric Cards */}
        {!isOperationsAdmin ? (
          /* BILL_ADMIN Metric Cards: strictly displays the metrics returned by backend */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {/* Card 1: Pending Bills */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
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
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
                >
                  <span>Open verification queue</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Card 2: Approved Invoices Count */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Approved Invoices
                </span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CheckCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">{stats.approvedBillsCount}</div>
              <div className="text-xs text-slate-400 mt-2 font-medium">
                Verified & credited to wallet
              </div>
            </div>

            {/* Card 3: Rejected Invoices Count */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-red-700 uppercase tracking-wider">
                  Rejected Invoices
                </span>
                <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                  <XCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">{stats.rejectedBillsCount}</div>
              <div className="text-xs text-slate-400 mt-2 font-medium">
                Declined with recorded reasons
              </div>
            </div>

            {/* Card 4: Rewards Approved This Month */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Approved This Month
                </span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Gift className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">
                {Number(stats.rewardsThisMonth || 0).toLocaleString('en-IN')} Points
              </div>
              <div className="text-xs text-slate-400 mt-2 font-medium">
                Direct cashback rewards
              </div>
            </div>
          </div>
        ) : (
          /* OPERATIONS_ADMIN Metric Cards: full operational overview */
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

            {/* Card 2: KYC Verified */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  KYC Verified
                </span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">{stats.kycVerifiedCount ?? 0}</div>
              <div className="mt-2">
                <button
                  onClick={() => router.push('/users')}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center space-x-1"
                >
                  <span>Inspect verified directory</span>
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
                {stats.rewardsThisMonth.toLocaleString('en-IN')} Points
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
        )}

        {/* Section 2: Financial Liability & Solvency Summary (Operations Admin Only) */}
        {isOperationsAdmin && (
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
                  {Number(stats.availableWalletLiability || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points
                </span>
                <span className="text-[10px] text-slate-400 block mt-1">Payable on demand</span>
              </div>
              <div className="p-4 bg-amber-50 rounded-xl">
                <span className="text-xs font-semibold text-amber-700 block mb-1">Reserved In-Flight</span>
                <span className="text-xl font-black text-amber-900">
                  {Number(stats.reservedWalletLiability || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points
                </span>
                <span className="text-[10px] text-amber-600 block mt-1">Pending payout approval</span>
              </div>
              <div className="p-4 bg-emerald-50 rounded-xl">
                <span className="text-xs font-semibold text-emerald-700 block mb-1">Total Rewards Credited</span>
                <span className="text-xl font-black text-emerald-900">
                  {Number(stats.totalRewardsCredited || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points
                </span>
                <span className="text-[10px] text-emerald-600 block mt-1">All-time ledger credits</span>
              </div>
              <div className="p-4 bg-purple-50 rounded-xl">
                <span className="text-xs font-semibold text-purple-700 block mb-1">Settled Disbursements</span>
                <span className="text-xl font-black text-purple-900">
                  {Number(stats.totalRedeemed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points
                </span>
                <span className="text-[10px] text-purple-600 block mt-1">Disbursed via RazorpayX</span>
              </div>
            </div>
            {stats.failedPayouts > 0 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-800">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span className="font-semibold">
                    Attention: {stats.failedPayouts} disbursement(s) totaling {Number(stats.failedPayoutAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Points require operational review.
                  </span>
                </div>
                <button
                  onClick={() => router.push('/payouts')}
                  className="font-bold underline text-red-700 hover:text-red-900"
                >
                  View Failed Payouts
                </button>
              </div>
            )}
          </div>
        )}

        {/* Section 3: Recent Bills Verification Queue */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Recent Bill Submissions</h2>
              <p className="text-xs text-slate-500">Live invoices awaiting or recently completed verification</p>
            </div>
            {!isOperationsAdmin && (
              <button
                onClick={() => router.push('/bills')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
              >
                <span>View all bills</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
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
                {recentBills.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-slate-400 font-medium">
                      No recent invoice submissions found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  recentBills.map((b: any) => {
                    const prof = b.profession || b.user?.profession || b.userProfession;
                    const isPlumber = prof === 'PLUMBER';
                    const fullName = b.userFullName || b.user?.fullName || 'Craftsman';
                    const mobile = b.userMobile || b.user?.mobile || '';
                    const isPending = b.status === 'PENDING' || b.status === 'UNDER_REVIEW';
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3.5 px-5 font-bold text-slate-900">{b.invoiceNumber}</td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-800">{fullName}</div>
                          <div className="text-[11px] text-slate-400">{mobile ? `+91 ${mobile}` : ''}</div>
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
                          ₹{Number(b.grossBillAmount || b.billAmount || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3.5 px-4">
                          {b.status === 'APPROVED' ? (
                            <span className="font-bold text-emerald-600">
                              +{Number(b.calculatedReward || 0).toLocaleString('en-IN')} Points
                            </span>
                          ) : b.status === 'REJECTED' ? (
                            <span className="text-slate-400 font-semibold text-xs">Rejected</span>
                          ) : (
                            <span className="text-amber-600 font-medium text-xs">Pending Review</span>
                          )}
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
                          {isOperationsAdmin ? (
                            <button
                              onClick={() => setReadOnlyBill(b)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs transition"
                            >
                              View Details
                            </button>
                          ) : (
                            <button
                              onClick={() => setSelectedBill(b)}
                              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition ${
                                isPending
                                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                              }`}
                            >
                              {isPending ? 'Verify Bill' : 'View Details'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Bill Verification Modal for BILL_ADMIN */}
      {selectedBill && (
        <BillVerificationModal
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onVerified={fetchDashboard}
        />
      )}

      {/* Read-Only Bill Modal for OPERATIONS_ADMIN */}
      {readOnlyBill && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Bill Details #{readOnlyBill.invoiceNumber}
                </h3>
              </div>
              <button
                onClick={() => setReadOnlyBill(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block font-semibold">Professional:</span>
                  <span className="font-bold text-slate-800">
                    {readOnlyBill.user?.fullName || readOnlyBill.userFullName || '—'}
                  </span>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {readOnlyBill.user?.mobile ? `+91 ${readOnlyBill.user.mobile}` : ''}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold">Profession:</span>
                  <span className="font-bold text-slate-800">
                    {readOnlyBill.user?.profession || readOnlyBill.userProfession || '—'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block font-semibold">Gross Bill Amount:</span>
                  <span className="font-black text-slate-900 text-sm">
                    ₹{Number(readOnlyBill.grossBillAmount || readOnlyBill.billAmount || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className={`p-3 rounded-xl ${
                  readOnlyBill.status === 'APPROVED'
                    ? 'bg-emerald-50'
                    : readOnlyBill.status === 'REJECTED'
                    ? 'bg-slate-50'
                    : 'bg-amber-50'
                }`}>
                  <span className={`block font-semibold ${
                    readOnlyBill.status === 'APPROVED'
                      ? 'text-emerald-700'
                      : readOnlyBill.status === 'REJECTED'
                      ? 'text-slate-500'
                      : 'text-amber-700'
                  }`}>Reward Status:</span>
                  <span className={`font-black text-sm ${
                    readOnlyBill.status === 'APPROVED'
                      ? 'text-emerald-900'
                      : readOnlyBill.status === 'REJECTED'
                      ? 'text-slate-600'
                      : 'text-amber-800'
                  }`}>
                    {readOnlyBill.status === 'APPROVED'
                      ? `+${Number(readOnlyBill.calculatedReward || 0).toLocaleString('en-IN')} Points`
                      : readOnlyBill.status === 'REJECTED'
                      ? 'Rejected'
                      : 'Pending Review'}
                  </span>
                </div>
              </div>

              {readOnlyBill.gstAmount !== undefined && Number(readOnlyBill.gstAmount) > 0 && (
                <div className="p-3 bg-slate-50 rounded-xl flex justify-between">
                  <span className="text-slate-500">GST ({readOnlyBill.gstRate}%):</span>
                  <span className="font-bold text-slate-800">₹{Number(readOnlyBill.gstAmount).toLocaleString('en-IN')}</span>
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-xl flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className={`font-bold px-2 py-0.5 rounded ${
                  readOnlyBill.status === 'APPROVED'
                    ? 'bg-emerald-100 text-emerald-700'
                    : readOnlyBill.status === 'REJECTED'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {readOnlyBill.status}
                </span>
              </div>

              {readOnlyBill.rejectionReason && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800">
                  <span className="font-bold block mb-0.5">Rejection Reason:</span>
                  <span>{readOnlyBill.rejectionReason}</span>
                </div>
              )}

              {readOnlyBill.fileUrl && (
                <div className="pt-2">
                  <a
                    href={readOnlyBill.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center space-x-2 transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>View Uploaded Invoice Document</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => setReadOnlyBill(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
