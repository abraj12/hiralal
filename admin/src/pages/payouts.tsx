import React, { useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, XCircle, Clock, RotateCcw, AlertTriangle } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
    action: 'APPROVE' | 'REJECT' | 'FAIL',
    reason?: string
  ) => {
    setActionLoading(id);
    try {
      await AdminApiClient.handlePayoutAction(id, action, reason);
      fetchPayouts();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              RazorpayX Payouts Management
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Inspect disbursement requests, UPI & Bank transfers with masked sensitive records
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Status Filter */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'PENDING', 'APPROVED', 'PROCESSING', 'SUCCESS', 'FAILED'].map(st => (
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
                  {pf === 'ALL' ? 'All' : pf === 'PLUMBER' ? 'Plumber' : 'Tiles'}
                </button>
              ))}
            </div>
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
                <th className="py-3.5 px-4">Initiated Date</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No payouts found matching criteria.
                  </td>
                </tr>
              ) : (
                payouts.map((p: any) => {
                  const isPlumber = p.profession === 'PLUMBER';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-4 px-5">
                        <div className="font-mono font-bold text-slate-900">{p.id}</div>
                        {p.idempotencyKey && (
                          <div className="text-[10px] text-slate-400 font-mono">Key: {p.idempotencyKey.slice(0, 16)}...</div>
                        )}
                        {p.razorpayPayoutId && (
                          <div className="text-[10px] text-indigo-500 font-mono">Gateway: {p.razorpayPayoutId}</div>
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
                        ₹{p.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                          <span>{p.maskedAccount}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold">{p.paymentType}</div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            p.status === 'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-700'
                              : p.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800'
                              : p.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : p.status === 'FAILED' || p.status === 'REVERSED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-500 font-medium">
                        {new Date(p.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-4 px-5 text-right space-x-2">
                        {p.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleAction(p.id, 'APPROVE')}
                              disabled={actionLoading === p.id}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-sm transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Please enter rejection reason:');
                                if (reason && reason.trim()) {
                                  handleAction(p.id, 'REJECT', reason.trim());
                                }
                              }}
                              disabled={actionLoading === p.id}
                              className="px-2.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-xs transition"
                            >
                              Reject & Refund
                            </button>
                          </>
                        )}
                        {p.status === 'APPROVED' && (
                          <button
                            onClick={() => {
                              const reason = prompt('Please enter cancellation reason:');
                              if (reason && reason.trim()) {
                                handleAction(p.id, 'REJECT', reason.trim());
                              }
                            }}
                            disabled={actionLoading === p.id}
                            className="px-2.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-xs transition"
                          >
                            Cancel
                          </button>
                        )}
                        {p.status === 'PROCESSING' && (
                          <button
                            onClick={() => {
                              const reason = prompt('Please enter failure reason:');
                              if (reason && reason.trim()) {
                                handleAction(p.id, 'FAIL', reason.trim());
                              }
                            }}
                            disabled={actionLoading === p.id}
                            className="px-2.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-xs transition"
                          >
                            Fail & Refund
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
      </main>
    </div>
  );
}
