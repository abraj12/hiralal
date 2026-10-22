import React, { useEffect, useState, useCallback } from 'react';
import {
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Search,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BillVerificationModal from '../components/BillVerificationModal';
import { AdminApiClient } from '../lib/api';
import { safeDocumentUrl } from '../lib/financial-utils';

export default function AdminBillsPage() {
  const [bills, setBills] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [totalPendingCount, setTotalPendingCount] = useState(0);

  // Debounce search query by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchBills = useCallback(async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getBills(statusFilter, professionFilter, debouncedSearch);
      const fetchedBills = res.bills || [];
      setBills(fetchedBills);

      // Keep track of pending bills count for the sidebar badge
      if (statusFilter === 'ALL' && professionFilter === 'ALL' && !debouncedSearch) {
        const pending = fetchedBills.filter(
          (b: any) => b.status === 'PENDING' || b.status === 'UNDER_REVIEW'
        ).length;
        setTotalPendingCount(pending);
      }
    } catch (err) {
      console.error('Failed to fetch bills queue:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, professionFilter, debouncedSearch]);

  // Also fetch dashboard stats on mount to initialize pending count accurately
  useEffect(() => {
    async function loadStats() {
      try {
        const dash = await AdminApiClient.getDashboard('ALL');
        if (dash?.stats?.pendingBills !== undefined) {
          setTotalPendingCount(dash.stats.pendingBills);
        }
      } catch (e) {
        // Fallback gracefully
      }
    }
    loadStats();
  }, []);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const handleVerified = () => {
    fetchBills();
    // Also update pending count
    AdminApiClient.getDashboard('ALL')
      .then((dash) => {
        if (dash?.stats?.pendingBills !== undefined) {
          setTotalPendingCount(dash.stats.pendingBills);
        }
      })
      .catch(() => {});
  };

  // Metrics summary calculations
  const pendingInView = bills.filter(
    (b: any) => b.status === 'PENDING' || b.status === 'UNDER_REVIEW'
  ).length;
  const approvedInView = bills.filter((b: any) => b.status === 'APPROVED').length;
  const rejectedInView = bills.filter((b: any) => b.status === 'REJECTED').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar pendingBillsCount={totalPendingCount} />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Bills Verification Queue
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                Bill Admin Authorized
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Audit submitted plumber and tile invoices, verify Cloudflare R2 documents, evaluate GST rules, and approve cashback rewards
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchBills()}
              disabled={loading}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 shadow-sm"
              title="Refresh queue"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Quick Summary Metric Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Total Listed</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{bills.length}</span>
            <span className="text-[11px] text-slate-500">Matching current filters</span>
          </div>

          <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200/60 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider block">Pending Review</span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <span className="text-2xl font-black text-amber-900 mt-0.5 block">{pendingInView}</span>
            <span className="text-[11px] text-amber-700">Requires audit & verification</span>
          </div>

          <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200/60 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">Approved</span>
              <CheckCircle className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-2xl font-black text-emerald-900 mt-0.5 block">{approvedInView}</span>
            <span className="text-[11px] text-emerald-700">Rewards credited to wallet</span>
          </div>

          <div className="bg-red-50/70 p-4 rounded-xl border border-red-200/60 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-red-700 uppercase tracking-wider block">Rejected</span>
              <XCircle className="w-4 h-4 text-red-600" />
            </div>
            <span className="text-2xl font-black text-red-900 mt-0.5 block">{rejectedInView}</span>
            <span className="text-[11px] text-red-700">Declined with recorded reason</span>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice #, worker name, or phone..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
            {/* Status Filter Tabs */}
            <div className="bg-slate-100 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {[
                { key: 'ALL', label: 'All Status' },
                { key: 'PENDING', label: 'Pending' },
                { key: 'UNDER_REVIEW', label: 'Under Review' },
                { key: 'APPROVED', label: 'Approved' },
                { key: 'REJECTED', label: 'Rejected' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    statusFilter === key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Profession Filter */}
            <div className="bg-slate-100 p-1 rounded-xl flex space-x-1 text-xs font-bold">
              {[
                { key: 'ALL', label: 'All Trades' },
                { key: 'PLUMBER', label: 'Plumbers' },
                { key: 'TILE_INSTALLER', label: 'Tiles' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setProfessionFilter(key)}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    professionFilter === key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bills Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-xs font-bold text-slate-700">Loading Bills Queue...</p>
              <p className="text-[11px] text-slate-400 mt-1">Retrieving verified invoice records from backend</p>
            </div>
          ) : bills.length === 0 ? (
            <div className="py-14 text-center px-4">
              <img
                src="/assets/state_admin_bills_empty.png"
                alt="No Invoices Found"
                className="w-32 h-32 mx-auto mb-3 object-contain"
              />
              <h3 className="text-sm font-bold text-slate-800">No Invoices Found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No bills match your current filters. Pending invoices may have all been verified, or try clearing search filters.
              </p>
              {(statusFilter !== 'ALL' || professionFilter !== 'ALL' || searchQuery) && (
                <button
                  onClick={() => {
                    setStatusFilter('ALL');
                    setProfessionFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="mt-4 px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold rounded-xl transition"
                >
                  Reset All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
                  <tr>
                    <th className="py-3.5 px-5">Invoice #</th>
                    <th className="py-3.5 px-4">Professional</th>
                    <th className="py-3.5 px-4">Trade</th>
                    <th className="py-3.5 px-4">Invoice Date</th>
                    <th className="py-3.5 px-4">Gross Amount</th>
                    <th className="py-3.5 px-4">GST Details</th>
                    <th className="py-3.5 px-4">Calculated Reward</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.map((b: any) => {
                    const prof = b.profession || b.user?.profession || b.userProfession;
                    const isPlumber = prof === 'PLUMBER';
                    const workerFullName = b.userFullName || b.user?.fullName || 'Worker';
                    const workerMobile = b.userMobile || b.user?.mobile || '';
                    const gross = Number(b.grossBillAmount || b.billAmount || 0);
                    const rewardAmt = Number(b.calculatedReward || 0);
                    const eligibleAmt = Number(b.eligibleRewardAmount !== null && b.eligibleRewardAmount !== undefined ? b.eligibleRewardAmount : gross);
                    const isPending = b.status === 'PENDING' || b.status === 'UNDER_REVIEW';

                    return (
                      <tr key={b.id} className="hover:bg-slate-50/80 transition">
                        {/* Invoice Number & Document Indicator */}
                        <td className="py-4 px-5">
                          <div className="font-bold text-slate-900 flex items-center space-x-1.5">
                            <span>{b.invoiceNumber}</span>
                            {b.fileUrl && (
                              <a
                                href={safeDocumentUrl(b.fileUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open original document in new tab"
                                className="text-slate-400 hover:text-blue-600 transition"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          {b.createdAt && (
                            <div className="text-[10px] text-slate-400">
                              Sub: {new Date(b.createdAt).toLocaleDateString('en-IN')}
                            </div>
                          )}
                          {b.remarks && (
                            <div className="text-[11px] text-slate-500 italic truncate max-w-xs mt-0.5" title={b.remarks}>
                              "{b.remarks}"
                            </div>
                          )}
                        </td>

                        {/* Professional Information */}
                        <td className="py-4 px-4">
                          <div className="font-semibold text-slate-800">{workerFullName}</div>
                          {workerMobile && (
                            <div className="text-[11px] text-slate-400 font-mono">+91 {workerMobile}</div>
                          )}
                        </td>

                        {/* Trade / Profession Badge */}
                        <td className="py-4 px-4">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold ${
                              isPlumber
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {isPlumber ? 'Plumber' : 'Tiles'}
                          </span>
                        </td>

                        {/* Invoice Date */}
                        <td className="py-4 px-4 text-slate-600 font-medium whitespace-nowrap">
                          {b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '—'}
                        </td>

                        {/* Gross Bill Amount */}
                        <td className="py-4 px-4 font-black text-slate-900 text-sm whitespace-nowrap">
                          ₹{gross.toLocaleString('en-IN')}
                        </td>

                        {/* GST Breakdown */}
                        <td className="py-4 px-4">
                          {b.gstIncluded ? (
                            <div>
                              <span className="font-bold text-slate-800">
                                {b.gstRate}% GST (-₹{Number(b.gstAmount || 0).toLocaleString('en-IN')})
                              </span>
                              <div className="text-[10px] text-slate-400">
                                Base: ₹{eligibleAmt.toLocaleString('en-IN')}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="text-slate-500 font-medium">GST Excluded</span>
                              <div className="text-[10px] text-slate-400">Full amount eligible</div>
                            </div>
                          )}
                        </td>

                        {/* Calculated Reward */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          {b.status === 'APPROVED' ? (
                            <>
                              <div className="font-black text-emerald-600 text-sm">
                                +{rewardAmt.toLocaleString('en-IN')} Points
                              </div>
                              {(b.rewardRateSnapshot || b.rewardPercentage) && (
                                <div className="text-[10px] text-emerald-700 font-semibold">
                                  @{b.rewardRateSnapshot || b.rewardPercentage}% rule
                                </div>
                              )}
                            </>
                          ) : b.status === 'REJECTED' ? (
                            <span className="text-slate-400 font-semibold text-xs">Rejected</span>
                          ) : (
                            <span className="text-amber-600 font-medium text-xs">Pending Review</span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                b.status === 'APPROVED'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : b.status === 'REJECTED'
                                  ? 'bg-red-100 text-red-700'
                                  : b.status === 'CANCELLED'
                                  ? 'bg-slate-200 text-slate-800'
                                  : b.status === 'UNDER_REVIEW'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {b.status}
                            </span>
                            {b.revisionNumber && b.revisionNumber > 1 && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                Rev #{b.revisionNumber}
                              </span>
                            )}
                            {b.requiresSecondaryApproval && (
                              <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded">
                                Sec Review
                              </span>
                            )}
                          </div>
                          {b.rejectionReason && (
                            <div className="text-[10px] text-red-600 mt-1 max-w-[180px] truncate" title={b.rejectionReason}>
                              {b.rejectionReason}
                            </div>
                          )}
                          {b.cancellationReason && (
                            <div className="text-[10px] text-slate-600 mt-1 max-w-[180px] truncate" title={b.cancellationReason}>
                              Cancel: {b.cancellationReason}
                            </div>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="py-4 px-5 text-right whitespace-nowrap">
                          <button
                            onClick={() => setSelectedBill(b)}
                            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition inline-flex items-center space-x-1 ${
                              isPending
                                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isPending ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Verify Bill</span>
                              </>
                            ) : (
                              <>
                                <Eye className="w-3.5 h-3.5" />
                                <span>View Details</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Bill Verification Modal */}
      {selectedBill && (
        <BillVerificationModal
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onVerified={handleVerified}
        />
      )}
    </div>
  );
}
