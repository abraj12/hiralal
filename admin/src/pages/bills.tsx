import React, { useEffect, useState } from 'react';
import { Filter, CheckCircle, XCircle, Clock, FileText, Search } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BillVerificationModal from '../components/BillVerificationModal';
import { AdminApiClient } from '../lib/api';

export default function AdminBillsPage() {
  const [bills, setBills] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchBills = async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getBills(statusFilter, professionFilter);
      setBills(res.bills || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, [statusFilter, professionFilter]);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Bills Verification Queue
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Verify submitted plumbing and tile invoices, check documents, and credit rewards
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Status Tabs */}
            <div className="bg-slate-200/80 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map(st => (
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

        {/* Bills Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Invoice #</th>
                <th className="py-3.5 px-4">Professional</th>
                <th className="py-3.5 px-4">Profession</th>
                <th className="py-3.5 px-4">Invoice Date</th>
                <th className="py-3.5 px-4">Bill Amount</th>
                <th className="py-3.5 px-4">System Reward (0.5%)</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-5 text-right">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.map((b: any) => {
                const isPlumber = b.userProfession === 'PLUMBER';
                return (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-4 px-5">
                      <div className="font-bold text-slate-900">{b.invoiceNumber}</div>
                      {b.remarks && <div className="text-[11px] text-slate-400 truncate max-w-xs">{b.remarks}</div>}
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-semibold text-slate-800">{b.userFullName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">+91 {b.userMobile}</div>
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
                    <td className="py-4 px-4 text-slate-500 font-medium">
                      {new Date(b.invoiceDate).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-4 px-4 font-black text-slate-900 text-sm">
                      ₹{b.billAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-4 px-4 font-black text-emerald-600 text-sm">
                      ₹{b.calculatedReward.toLocaleString('en-IN')}
                    </td>
                    <td className="py-4 px-4">
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
                      {b.rejectionReason && (
                        <div className="text-[10px] text-red-600 mt-1 max-w-xs">{b.rejectionReason}</div>
                      )}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <button
                        onClick={() => setSelectedBill(b)}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition ${
                          b.status === 'PENDING' || b.status === 'UNDER_REVIEW'
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        {b.status === 'PENDING' ? 'Verify Bill' : 'View Details'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {selectedBill && (
        <BillVerificationModal
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onVerified={fetchBills}
        />
      )}
    </div>
  );
}
