import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  AlertTriangle,
  Eye,
  X,
  ShieldCheck,
  Building,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Rejection Modal State
  const [rejectModalPayout, setRejectModalPayout] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Payout Inspection Modal State
  const [inspectPayout, setInspectPayout] = useState<any | null>(null);

  const fetchPayouts = async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getPayouts(statusFilter, professionFilter);
      setPayouts(res.payouts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, [statusFilter, professionFilter]);

  const handleAction = async (
    id: string,
    action: 'APPROVE' | 'REJECT',
    reason?: string
  ) => {
    setActionLoading(id);
    try {
      await AdminApiClient.handlePayoutAction(id, action, reason);
      await fetchPayouts();
      if (action === 'REJECT') {
        closeRejectModal();
      }
    } catch (err: any) {
      if (action === 'REJECT') {
        setRejectError(err.message || 'Failed to reject payout.');
      } else {
        alert(err.message || 'Action failed.');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const openRejectModal = (p: any) => {
    setRejectModalPayout(p);
    setRejectReason('');
    setRejectError(null);
  };

  const closeRejectModal = () => {
    setRejectModalPayout(null);
    setRejectReason('');
    setRejectError(null);
  };

  const submitReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalPayout) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setRejectError('Please provide a meaningful rejection reason (at least 3 characters).');
      return;
    }
    handleAction(rejectModalPayout.id, 'REJECT', rejectReason.trim());
  };

  const pendingCount = payouts.filter((p: any) => p.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar pendingPayoutsCount={pendingCount} />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              RazorpayX Payouts Management
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Inspect disbursement requests, UPI & Bank transfers with masked sensitive records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Profession Filter */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'PLUMBER', 'TILE_INSTALLER'].map(pf => (
                <button
                  key={pf}
                  onClick={() => setProfessionFilter(pf)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    professionFilter === pf ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {pf === 'ALL' ? 'All' : pf === 'PLUMBER' ? 'Plumbers' : 'Tiles'}
                </button>
              ))}
            </div>

            <button
              onClick={fetchPayouts}
              className="p-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-600 transition shadow-sm"
              title="Refresh Payouts"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Payouts Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Payout ID</th>
                <th className="py-3.5 px-4">Professional</th>
                <th className="py-3.5 px-4">Profession</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Disbursement Target</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <img
                      src="/assets/state_payouts_settled.png"
                      alt="All Disbursements Settled"
                      className="w-28 h-28 mx-auto mb-3 object-contain"
                    />
                    <div className="text-xs font-bold text-slate-800">All Disbursements Settled</div>
                    <div className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                      No pending or matching payout redemption requests at this time.
                    </div>
                  </td>
                </tr>
              ) : (
                payouts.map((p: any) => {
                  const isPlumber = p.profession === 'PLUMBER';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-4 px-5">
                        <div className="font-mono font-bold text-slate-900">{p.id}</div>
                        {p.razorpayPayoutId && (
                          <div className="text-[10px] text-indigo-600 font-mono">Gateway: {p.razorpayPayoutId}</div>
                        )}
                        {(p.adminRejectionReason || p.failureReason) && (
                          <div className="text-[11px] text-red-600 font-medium mt-0.5 truncate max-w-xs">
                            Reason: {p.adminRejectionReason || p.failureReason}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-bold text-slate-800">{p.userName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">+91 {p.userMobile}</div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold ${
                            isPlumber ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {isPlumber ? 'Plumber' : 'Tiles'}
                        </span>
                      </td>
                      <td className="py-4 px-4 font-black text-slate-900 text-sm">
                        {Number(p.amount || 0).toLocaleString('en-IN')} Points
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                          <span>{p.maskedAccount}</span>
                        </div>
                        {p.bankName && (
                          <div className="text-[11px] text-slate-600 font-medium">{p.bankName}</div>
                        )}
                        <div className="text-[10px] text-slate-400 uppercase font-bold">{p.paymentType}</div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            p.status === 'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-700'
                              : p.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800'
                              : p.status === 'PROCESSING' || p.status === 'PAYOUT_INITIATED'
                              ? 'bg-blue-100 text-blue-800'
                              : p.status === 'FAILED' || p.status === 'REVERSED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-500 font-medium whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-4 px-5 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setInspectPayout(p)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs transition"
                          title="View Payout Details"
                        >
                          Inspect
                        </button>
                        {p.status === 'PENDING' && (
                          <button
                            onClick={() => handleAction(p.id, 'APPROVE')}
                            disabled={actionLoading === p.id}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-sm transition disabled:opacity-50"
                          >
                            {actionLoading === p.id ? 'Approving...' : 'Approve'}
                          </button>
                        )}
                        {(p.status === 'PENDING' ||
                          p.status === 'APPROVED' ||
                          (p.status === 'PROCESSING' && p.requiresManualReview && !p.razorpayPayoutId)) && (
                          <button
                            onClick={() => openRejectModal(p)}
                            disabled={actionLoading === p.id}
                            className="px-2.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-xs transition disabled:opacity-50"
                          >
                            Reject & Refund
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

        {/* Payout Rejection Modal */}
        {rejectModalPayout && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Reject Disbursement Request
                  </h3>
                </div>
                <button
                  onClick={closeRejectModal}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={submitReject} className="mt-4 space-y-4">
                <div className="p-3 bg-red-50 rounded-xl border border-red-200/80 text-xs text-red-800">
                  <p className="font-bold">Refund Notice:</p>
                  <p className="mt-0.5 text-[11px]">
                    Rejecting this payout will automatically reverse the hold on the craftsman's wallet balance ({Number(rejectModalPayout.amount).toLocaleString('en-IN')} Points) and refund it immediately with an immutable ledger entry.
                  </p>
                </div>

                {rejectError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{rejectError}</span>
                  </div>
                )}

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-1">
                  <div>Professional: <span className="font-bold text-slate-900">{rejectModalPayout.userName}</span></div>
                  <div>Account: <span className="font-mono text-slate-700">{rejectModalPayout.maskedAccount}</span></div>
                  <div>Amount: <span className="font-bold text-slate-900">{Number(rejectModalPayout.amount).toLocaleString('en-IN')} Points</span></div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Rejection Reason *
                  </label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Bank account name mismatch with worker KYC record; please update banking details."
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    This reason will be visible to the worker on their mobile app.
                  </span>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeRejectModal}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading === rejectModalPayout.id}
                    className="px-5 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50"
                  >
                    {actionLoading === rejectModalPayout.id ? 'Rejecting...' : 'Confirm Rejection & Refund'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Payout Details Inspection Modal */}
        {inspectPayout && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Disbursement Details
                  </h3>
                </div>
                <button
                  onClick={() => setInspectPayout(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-slate-400 block font-semibold">Amount</span>
                    <span className="text-xl font-black text-slate-900">
                      {Number(inspectPayout.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} Points
                    </span>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] ${
                    inspectPayout.status === 'SUCCESS'
                      ? 'bg-emerald-100 text-emerald-700'
                      : inspectPayout.status === 'PENDING'
                      ? 'bg-amber-100 text-amber-800'
                      : inspectPayout.status === 'FAILED' || inspectPayout.status === 'REVERSED'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {inspectPayout.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-slate-400 block font-semibold">Professional:</span>
                    <span className="font-bold text-slate-800">{inspectPayout.userName}</span>
                    <div className="text-[11px] text-slate-500 font-mono">+91 {inspectPayout.userMobile}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Profession:</span>
                    <span className="font-bold text-slate-800">{inspectPayout.profession}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 space-y-1">
                  <div className="text-slate-400 font-semibold mb-1">Disbursement Target:</div>
                  <div className="text-slate-800 font-bold font-mono">{inspectPayout.maskedAccount}</div>
                  {inspectPayout.bankName && <div className="text-slate-600">{inspectPayout.bankName}</div>}
                  <div className="text-slate-400 font-bold uppercase text-[10px]">{inspectPayout.paymentType}</div>
                </div>

                {inspectPayout.razorpayPayoutId && (
                  <div className="bg-indigo-50/70 border border-indigo-100 p-3 rounded-xl">
                    <span className="text-indigo-600 block font-semibold text-[10px] uppercase">RazorpayX Gateway ID</span>
                    <span className="font-mono font-bold text-indigo-950 text-xs">{inspectPayout.razorpayPayoutId}</span>
                  </div>
                )}

                {inspectPayout.requiresManualReview && inspectPayout.manualReviewReason && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                    <span className="font-bold block mb-0.5">Manual Review Required:</span>
                    <span>{inspectPayout.manualReviewReason}</span>
                  </div>
                )}

                {(inspectPayout.adminRejectionReason || inspectPayout.failureReason) && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800">
                    <span className="font-bold block mb-0.5">Failure / Rejection Reason:</span>
                    <span>{inspectPayout.adminRejectionReason || inspectPayout.failureReason}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-slate-500 text-[11px] pt-1">
                  <div>Initiated: {new Date(inspectPayout.createdAt).toLocaleString('en-IN')}</div>
                  {inspectPayout.completedAt && (
                    <div>Completed: {new Date(inspectPayout.completedAt).toLocaleString('en-IN')}</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => setInspectPayout(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
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
