import React, { useEffect, useState } from 'react';
import { History, Shield, CheckCircle, RefreshCw, X } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await AdminApiClient.getAuditLogs();
      setLogs(res.logs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatJson = (str: string | null) => {
    if (!str) return '—';
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar />

      <main className="flex-1 w-full lg:ml-64 p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8 min-h-screen">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Immutable Audit Trail
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Complete security log of financial approvals, rejections, setting updates, and administrative actions
            </p>
          </div>

          <button
            onClick={fetchLogs}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-600 transition shadow-sm"
            title="Refresh Audit Logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Timestamp (IST)</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Entity Type</th>
                <th className="py-3.5 px-4">Performed By</th>
                <th className="py-3.5 px-4">Target ID</th>
                <th className="py-3.5 px-5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <img
                      src="/assets/state_admin_bills_empty.png"
                      alt="No Audit Logs"
                      className="w-24 h-24 mx-auto mb-2 object-contain"
                    />
                    <div className="text-xs font-bold text-slate-800">No Audit Records Yet</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Immutable operational activity logs will be recorded as actions are taken.
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-5 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-mono text-[11px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      {log.entityType}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800">{log.admin?.fullName || 'System Administrator'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {log.admin?.mobile ? `+91 ${log.admin.mobile}` : ''}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-500 text-[11px]">
                      {log.entityId}
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-2.5 py-1 text-xs font-bold bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-lg transition"
                      >
                        Inspect Diff
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Audit Log Diff Inspection Modal */}
        {selectedLog && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Audit Log Inspection #{selectedLog.id}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  <div>
                    <span className="text-slate-400 block font-semibold">Action:</span>
                    <span className="font-bold text-blue-700 font-mono">{selectedLog.action}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Entity Type:</span>
                    <span className="font-bold text-slate-800">{selectedLog.entityType}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Performed By:</span>
                    <span className="font-bold text-slate-800">{selectedLog.admin?.fullName || 'Admin'}</span>
                    <div className="text-[10px] text-slate-400 font-mono">{selectedLog.admin?.mobile ? `+91 ${selectedLog.admin.mobile}` : ''}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Timestamp:</span>
                    <span className="text-slate-700 font-mono text-[11px]">
                      {new Date(selectedLog.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Previous State (Old Value)
                    </h4>
                    <pre className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] font-mono text-slate-700 overflow-x-auto max-h-64 whitespace-pre-wrap">
                      {formatJson(selectedLog.oldValue)}
                    </pre>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      New State (New Value)
                    </h4>
                    <pre className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-200/80 text-[11px] font-mono text-blue-950 overflow-x-auto max-h-64 whitespace-pre-wrap">
                      {formatJson(selectedLog.newValue)}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/50 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
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
