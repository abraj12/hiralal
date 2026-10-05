import React, { useEffect, useState } from 'react';
import { History, Shield, CheckCircle } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await AdminApiClient.getAuditLogs();
        setLogs(res.logs || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Immutable Audit Trail
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Complete security log of financial approvals, rejections, setting updates, and administrative actions
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Timestamp</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Entity Type</th>
                <th className="py-3.5 px-4">Target ID</th>
                <th className="py-3.5 px-5">Details / Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No audit records recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-5 font-mono text-slate-500 text-[11px]">
                      {new Date(log.createdAt).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-mono text-[11px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      {log.entityType}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-500 text-[11px]">
                      {log.entityId}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-slate-600 text-[11px] max-w-md truncate">
                      {log.newValue || log.oldValue || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
