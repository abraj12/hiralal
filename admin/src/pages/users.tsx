import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Search,
  Filter,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Edit2,
  X,
  AlertTriangle,
  Eye,
  Wallet,
  CreditCard,
  FileText,
  Send,
  History,
  TrendingUp,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // User Deep Profile Inspector Modal State
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsData, setDetailsData] = useState<any | null>(null);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'accounts' | 'bills' | 'payouts' | 'ledger'>('overview');

  // Privileged Profile Correction Modal State
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getUsers(professionFilter, statusFilter, search);
      setUsers(res.users || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [professionFilter, statusFilter, search]);

  const handleOpenDetails = async (userId: string) => {
    try {
      setLoadingDetails(true);
      setDetailsTab('overview');
      setDetailsModalOpen(true);
      const res = await AdminApiClient.getUserDetails(userId);
      setDetailsData(res);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch user details.');
      setDetailsModalOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDetailsModal = () => {
    setDetailsModalOpen(false);
    setDetailsData(null);
  };

  const openCorrectionModal = (u: any) => {
    setSelectedUser(u);
    setEditFullName(u.fullName || '');
    setEditReason('');
    setModalError(null);
  };

  const closeCorrectionModal = () => {
    setSelectedUser(null);
    setEditFullName('');
    setEditReason('');
    setModalError(null);
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (!editFullName.trim()) {
      setModalError('Full name cannot be empty.');
      return;
    }
    if (!editReason.trim() || editReason.trim().length < 5) {
      setModalError('A documented justification reason (at least 5 characters) is required for audit compliance.');
      return;
    }

    try {
      setSaving(true);
      setModalError(null);
      await AdminApiClient.updateUserName(selectedUser.id, {
        fullName: editFullName.trim(),
        reason: editReason.trim(),
      });
      setSuccessMsg(`User profile updated for ${editFullName.trim()}. Verification status reset for audit integrity.`);
      closeCorrectionModal();
      await fetchUsers();
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err: any) {
      setModalError(err.message || 'Failed to update user profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Professionals Directory
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Registered plumbers and tile installers with rewards balances & verification status
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter Tabs */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'ACTIVE', 'SUSPENDED'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {st === 'ALL' ? 'All Status' : st === 'ACTIVE' ? 'Active' : 'Suspended'}
                </button>
              ))}
            </div>

            {/* Profession Filter Tabs */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              <button
                onClick={() => setProfessionFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  professionFilter === 'ALL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                All ({users.length})
              </button>
              <button
                onClick={() => setProfessionFilter('PLUMBER')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  professionFilter === 'PLUMBER'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-blue-600'
                }`}
              >
                Plumbers
              </button>
              <button
                onClick={() => setProfessionFilter('TILE_INSTALLER')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  professionFilter === 'TILE_INSTALLER'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-orange-600'
                }`}
              >
                Tile Installers
              </button>
            </div>
          </div>
        </div>

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6 max-w-md">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or mobile number..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Name & Mobile</th>
                <th className="py-3.5 px-4">Profession</th>
                <th className="py-3.5 px-4">Registered Date</th>
                <th className="py-3.5 px-4">PAN KYC Status</th>
                <th className="py-3.5 px-4">Payment Account</th>
                <th className="py-3.5 px-4">Wallet Balance</th>
                <th className="py-3.5 px-4">Bills Submitted</th>
                <th className="py-3.5 px-4">Account Status</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u: any) => {
                const isPlumber = u.profession === 'PLUMBER';
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-4 px-5">
                      <div className="font-bold text-slate-900 text-sm">{u.fullName}</div>
                      <div className="text-xs text-slate-500 font-mono">+91 {u.mobile}</div>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold ${
                          isPlumber
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {isPlumber ? 'PLUMBER' : 'TILE INSTALLER'}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-slate-500 font-medium">
                      {new Date(u.createdAt).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          (u.isKycVerified ?? (u.panStatus === 'VERIFIED'))
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {(u.isKycVerified ?? (u.panStatus === 'VERIFIED')) ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Verified</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>Pending</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          u.paymentStatus === 'VERIFIED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {u.paymentStatus === 'VERIFIED' ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Verified</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>Not Added</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-black text-slate-900 text-sm">
                      {u.walletBalance.toLocaleString('en-IN')} Points
                    </td>
                    <td className="py-4 px-4 font-semibold text-slate-600">
                      {u.billsCount} invoices
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-block px-2.5 py-1 rounded-md font-bold text-xs ${
                        u.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => handleOpenDetails(u.id)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition"
                        title="View Full Profile, Ledger & Accounts"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect Profile</span>
                      </button>
                      <button
                        onClick={() => openCorrectionModal(u)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition"
                        title="Operations Admin Profile Correction (Audited)"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Correct Name</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Operations Admin Profile Correction Modal */}
        {selectedUser && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Operations Admin Name Correction
                  </h3>
                </div>
                <button
                  onClick={closeCorrectionModal}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCorrectionSubmit} className="mt-5 space-y-4">
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200/80 flex items-start space-x-3 text-xs text-amber-900">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-bold">Privileged Correction Notice (Audited):</p>
                    <p className="mt-0.5 text-amber-800 text-[11px]">
                      Worker profiles are locked to prevent fraud once PAN is verified. Correcting a worker's name requires documented operational justification and automatically unlocks profile and resets KYC status for mandatory re-verification.
                    </p>
                  </div>
                </div>

                {modalError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs space-y-1">
                  <div className="text-slate-500">Current User: <span className="font-bold text-slate-900">{selectedUser.fullName}</span></div>
                  <div className="text-slate-500">Mobile: <span className="font-mono text-slate-700">+91 {selectedUser.mobile}</span></div>
                  <div className="text-slate-500">Profession: <span className="font-bold text-slate-700">{selectedUser.profession}</span></div>
                  <div className="text-slate-500">KYC Status: <span className="font-bold text-slate-700">{selectedUser.panStatus || 'PENDING'}</span></div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Corrected Full Name *
                  </label>
                  <input
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    placeholder="Enter worker's legal full name as per Aadhaar/PAN"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Documented Justification Reason *
                  </label>
                  <textarea
                    rows={3}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="e.g. Typographical error during registration, verified via Aadhaar copy ticket #1234"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Permanently recorded in the compliance audit trail with your admin credentials
                  </span>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeCorrectionModal}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 flex items-center space-x-1.5 shadow-sm"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{saving ? 'Saving...' : 'Apply Audited Correction'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* User Deep Profile Inspector Modal */}
        {detailsModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 font-bold">
                    <Eye className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-bold text-slate-900">
                        {detailsData?.user?.fullName || 'Professional Profile'}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        detailsData?.user?.profession === 'PLUMBER'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {detailsData?.user?.profession}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                        {detailsData?.user?.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      +91 {detailsData?.user?.mobile} • ID: {detailsData?.user?.id}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {detailsData?.user?.id && (
                    <button
                      onClick={() => router.push(`/notifications?userId=${detailsData.user.id}`)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition"
                      title="Send Targeted Notification to this user"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Alert</span>
                    </button>
                  )}
                  <button
                    onClick={closeDetailsModal}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="px-6 pt-3 border-b border-slate-100 flex space-x-4 text-xs font-bold bg-slate-50/50">
                {[
                  { id: 'overview', label: 'Overview & KYC', icon: Wallet },
                  { id: 'accounts', label: `Accounts (${detailsData?.paymentAccounts?.length || 0})`, icon: CreditCard },
                  { id: 'bills', label: `Invoices (${detailsData?.bills?.length || 0})`, icon: FileText },
                  { id: 'payouts', label: `Disbursements (${detailsData?.payouts?.length || 0})`, icon: TrendingUp },
                  { id: 'ledger', label: `Ledger (${detailsData?.ledger?.length || 0})`, icon: History },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setDetailsTab(t.id as any)}
                    className={`pb-3 border-b-2 flex items-center space-x-1.5 transition ${
                      detailsTab === t.id
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                {loadingDetails ? (
                  <div className="py-12 text-center text-slate-400 font-medium">
                    Loading complete profile & ledger data...
                  </div>
                ) : !detailsData ? (
                  <div className="py-12 text-center text-slate-400 font-medium">
                    No data available.
                  </div>
                ) : (
                  <>
                    {/* TAB 1: OVERVIEW & KYC */}
                    {detailsTab === 'overview' && (
                      <div className="space-y-6">
                        {/* Wallet Balance Cards */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                            Wallet Balances
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="p-4 bg-blue-50/70 border border-blue-100 rounded-2xl">
                              <span className="text-xs font-semibold text-blue-700 block mb-1">
                                Available Balance
                              </span>
                              <span className="text-2xl font-black text-blue-950">
                                {Number(detailsData.wallet?.availableBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                              </span>
                              <span className="text-[10px] text-blue-600 block mt-1">Available for redemption</span>
                            </div>
                            <div className="p-4 bg-amber-50/70 border border-amber-100 rounded-2xl">
                              <span className="text-xs font-semibold text-amber-700 block mb-1">
                                Reserved In-Flight
                              </span>
                              <span className="text-2xl font-black text-amber-950">
                                {Number(detailsData.wallet?.processingAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                              </span>
                              <span className="text-[10px] text-amber-600 block mt-1">Held during payout processing</span>
                            </div>
                            <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl">
                              <span className="text-xs font-semibold text-emerald-700 block mb-1">
                                Total Redeemed
                              </span>
                              <span className="text-2xl font-black text-emerald-950">
                                {Number(detailsData.wallet?.totalRedeemed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                              </span>
                              <span className="text-[10px] text-emerald-600 block mt-1">Lifetime disbursed rewards</span>
                            </div>
                          </div>
                        </div>

                        {/* KYC & Verification Details */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                            PAN Verification & Identity Status
                          </h4>
                          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs space-y-3">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                              <span className="text-slate-500">PAN Verification Status</span>
                              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                                detailsData.kyc?.panStatus === 'VERIFIED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : detailsData.kyc?.panStatus === 'REJECTED'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {detailsData.kyc?.panStatus || 'NOT_SUBMITTED'}
                              </span>
                            </div>
                            {detailsData.kyc ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <span className="text-slate-400 block font-semibold">Name as per PAN:</span>
                                  <span className="font-bold text-slate-800">{detailsData.kyc.panName || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold">Masked PAN:</span>
                                  <span className="font-mono font-bold text-slate-800">{detailsData.kyc.maskedPan || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold">Name Matched:</span>
                                  <span className={`font-bold ${detailsData.kyc.nameMatched ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {detailsData.kyc.nameMatched ? 'Yes (Matched)' : 'No (Pending Review / Mismatch)'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold">Verification Provider:</span>
                                  <span className="font-semibold text-slate-700">{detailsData.kyc.provider || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold">Verified Timestamp:</span>
                                  <span className="text-slate-700 font-mono">
                                    {detailsData.kyc.verifiedAt ? new Date(detailsData.kyc.verifiedAt).toLocaleString('en-IN') : '—'}
                                  </span>
                                </div>
                                {detailsData.kyc.rejectionReason && (
                                  <div className="col-span-2 p-2.5 bg-red-50 rounded-xl text-red-700 border border-red-200">
                                    <span className="font-bold">Rejection Reason: </span>
                                    <span>{detailsData.kyc.rejectionReason}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-slate-400 italic">No PAN verification record submitted yet.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 2: PAYMENT ACCOUNTS */}
                    {detailsTab === 'accounts' && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Configured Bank & UPI Accounts
                        </h4>
                        {detailsData.paymentAccounts?.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs">
                            No payment accounts registered by this worker.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {detailsData.paymentAccounts.map((acc: any) => (
                              <div key={acc.id} className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                                    <CreditCard className="w-4 h-4 text-slate-400" />
                                    <span>{acc.accountType}</span>
                                  </span>
                                  <div className="space-x-1">
                                    {acc.isDefault && (
                                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">
                                        DEFAULT
                                      </span>
                                    )}
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      acc.isVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                                    }`}>
                                      {acc.isVerified ? 'VERIFIED' : 'PENDING'}
                                    </span>
                                  </div>
                                </div>
                                <div className="pt-1">
                                  <div className="text-slate-500 font-mono text-sm font-bold">{acc.maskedInfo}</div>
                                  {acc.bankName && <div className="text-slate-700 font-medium">{acc.bankName}</div>}
                                  {acc.ifscCode && <div className="text-slate-400 font-mono text-[11px]">IFSC: {acc.ifscCode}</div>}
                                  {acc.accountHolderName && <div className="text-slate-500 text-[11px]">Holder: {acc.accountHolderName}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 3: INVOICES (BILLS) */}
                    {detailsTab === 'bills' && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Submitted Invoices
                        </h4>
                        {detailsData.bills?.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs">
                            No bills submitted yet.
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                <tr>
                                  <th className="py-3 px-4">Invoice #</th>
                                  <th className="py-3 px-4">Bill Date</th>
                                  <th className="py-3 px-4">Bill Amount</th>
                                  <th className="py-3 px-4">Calculated Reward</th>
                                  <th className="py-3 px-4">Status</th>
                                  <th className="py-3 px-4 text-right">Document</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {detailsData.bills.map((b: any) => (
                                  <tr key={b.id} className="hover:bg-slate-50/70">
                                    <td className="py-3 px-4 font-bold text-slate-900">{b.invoiceNumber}</td>
                                    <td className="py-3 px-4 text-slate-500">
                                      {new Date(b.invoiceDate).toLocaleDateString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4 font-bold text-slate-800">
                                      ₹{Number(b.billAmount || 0).toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4">
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
                                    <td className="py-3 px-4">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        b.status === 'APPROVED'
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : b.status === 'REJECTED'
                                          ? 'bg-red-100 text-red-700'
                                          : 'bg-amber-100 text-amber-800'
                                      }`}>
                                        {b.status}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      {b.fileUrl ? (
                                        <a
                                          href={b.fileUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline font-bold"
                                        >
                                          View File
                                        </a>
                                      ) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 4: DISBURSEMENTS (PAYOUTS) */}
                    {detailsTab === 'payouts' && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Disbursement History
                        </h4>
                        {detailsData.payouts?.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs">
                            No payouts requested yet.
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                <tr>
                                  <th className="py-3 px-4">Payout ID</th>
                                  <th className="py-3 px-4">Amount</th>
                                  <th className="py-3 px-4">Type</th>
                                  <th className="py-3 px-4">Status</th>
                                  <th className="py-3 px-4">Created At</th>
                                  <th className="py-3 px-4">Failure Reason</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {detailsData.payouts.map((p: any) => (
                                  <tr key={p.id} className="hover:bg-slate-50/70">
                                    <td className="py-3 px-4 font-mono font-bold text-slate-900">{p.id}</td>
                                    <td className="py-3 px-4 font-bold text-slate-900">
                                      {Number(p.amount || 0).toLocaleString('en-IN')} Points
                                    </td>
                                    <td className="py-3 px-4 font-semibold text-slate-600">{p.paymentType}</td>
                                    <td className="py-3 px-4">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        p.status === 'SUCCESS'
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : p.status === 'PENDING'
                                          ? 'bg-amber-100 text-amber-800'
                                          : p.status === 'FAILED' || p.status === 'REVERSED'
                                          ? 'bg-red-100 text-red-700'
                                          : 'bg-purple-100 text-purple-800'
                                      }`}>
                                        {p.status}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-slate-500">
                                      {new Date(p.createdAt).toLocaleDateString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4 text-red-600 font-medium">
                                      {p.failureReason || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 5: LEDGER TRANSACTIONS */}
                    {detailsTab === 'ledger' && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Wallet Ledger (Last 50 Entries)
                        </h4>
                        {detailsData.ledger?.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs">
                            No ledger transactions recorded.
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                <tr>
                                  <th className="py-3 px-4">Timestamp</th>
                                  <th className="py-3 px-4">Type</th>
                                  <th className="py-3 px-4">Amount</th>
                                  <th className="py-3 px-4">Balance After</th>
                                  <th className="py-3 px-4">Description</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {detailsData.ledger.map((l: any) => (
                                  <tr key={l.id} className="hover:bg-slate-50/70">
                                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                                      {new Date(l.createdAt).toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                                        l.type === 'REWARD_CREDIT'
                                          ? 'bg-emerald-50 text-emerald-700'
                                          : l.type === 'REDEMPTION_HOLD'
                                          ? 'bg-amber-50 text-amber-700'
                                          : l.type === 'REDEMPTION_REFUND'
                                          ? 'bg-blue-50 text-blue-700'
                                          : 'bg-purple-50 text-purple-700'
                                      }`}>
                                        {l.type}
                                      </span>
                                    </td>
                                    <td className={`py-3 px-4 font-black ${
                                      l.type === 'REWARD_CREDIT' || l.type === 'REDEMPTION_REFUND'
                                        ? 'text-emerald-600'
                                        : 'text-slate-900'
                                    }`}>
                                      {l.type === 'REWARD_CREDIT' || l.type === 'REDEMPTION_REFUND' ? '+' : '-'}{Number(l.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                                    </td>
                                    <td className="py-3 px-4 font-bold text-slate-700">
                                      {Number(l.balanceAfter || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                                    </td>
                                    <td className="py-3 px-4 text-slate-500 truncate max-w-xs">
                                      {l.description || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/50 rounded-b-3xl">
                <button
                  type="button"
                  onClick={closeDetailsModal}
                  className="px-5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
