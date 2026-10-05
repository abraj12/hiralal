import React, { useEffect, useState } from 'react';
import { Search, Filter, ShieldCheck, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [professionFilter, setProfessionFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
                <th className="py-3.5 px-5 text-right">Account Status</th>
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
                    <td className="py-4 px-5 text-right">
                      <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-bold text-xs">
                        {u.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
