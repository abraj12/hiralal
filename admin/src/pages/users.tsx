import React, { useEffect, useState } from 'react';
import { Search, Filter, ShieldCheck, CheckCircle2, Clock, AlertCircle, Edit2, X, AlertTriangle } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
      const res = await AdminApiClient.getUsers(professionFilter, 'ALL', search);
      setUsers(res.users || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [professionFilter, search]);

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
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Professionals Directory
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Registered plumbers and tile installers with rewards balances & verification status
            </p>
          </div>

          <div className="flex items-center space-x-3">
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
                          u.panStatus === 'VERIFIED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {u.panStatus === 'VERIFIED' ? (
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
                      ₹{u.walletBalance.toLocaleString('en-IN')}
                    </td>
                    <td className="py-4 px-4 font-semibold text-slate-600">
                      {u.billsCount} invoices
                    </td>
                    <td className="py-4 px-4">
                      <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-bold text-xs">
                        {u.status}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-right">
                      <button
                        onClick={() => openCorrectionModal(u)}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-200 transition"
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
      </main>
    </div>
  );
}
