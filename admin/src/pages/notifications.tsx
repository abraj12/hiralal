import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Bell,
  Send,
  Users,
  CheckCircle,
  AlertCircle,
  Clock,
  Radio,
  UserCheck,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { AdminApiClient } from '../lib/api';

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  // Form State
  const [activeTab, setActiveTab] = useState<'broadcast' | 'direct'>('broadcast');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetAudience, setTargetAudience] = useState<'ALL' | 'PLUMBER' | 'TILE_INSTALLER'>('ALL');
  const [directUserId, setDirectUserId] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // History state
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    const adminUser = AdminApiClient.getUser();
    if (!adminUser) {
      router.push('/login');
      return;
    }
    if (adminUser.role !== 'OPERATIONS_ADMIN') {
      router.push('/');
      return;
    }
    setUser(adminUser);
    fetchCampaigns();
  }, [router]);

  const fetchCampaigns = async () => {
    try {
      setLoadingHistory(true);
      const res = await AdminApiClient.getNotificationHistory(1, 50);
      setCampaigns(res.campaigns || []);
    } catch (err: any) {
      console.error('Failed to load campaigns:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setErrorMsg('Please enter both a title and message.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      setSuccessMsg('');

      const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await AdminApiClient.broadcastNotification({
        title: title.trim(),
        message: message.trim(),
        targetAudience,
        idempotencyKey,
      });

      setSuccessMsg(`Broadcast sent successfully! Dispatched to ${res.campaign?.recipientCount || 0} craftsmen.`);
      setTitle('');
      setMessage('');
      fetchCampaigns();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to dispatch broadcast.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUserId.trim() || !title.trim() || !message.trim()) {
      setErrorMsg('Please enter User ID, title, and message.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      setSuccessMsg('');

      await AdminApiClient.sendDirectNotification(directUserId.trim(), {
        title: title.trim(),
        message: message.trim(),
      });

      setSuccessMsg('Direct notification dispatched successfully to user.');
      setTitle('');
      setMessage('');
      setDirectUserId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send direct notification.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />

      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
            <Bell className="w-6 h-6 text-red-600" />
            <span>Notification & Announcement Center</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Dispatch announcements, festive schemes, alerts, and direct messages to registered plumbers and tile workers.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex space-x-3 mb-6">
          <button
            onClick={() => { setActiveTab('broadcast'); setErrorMsg(''); setSuccessMsg(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'broadcast'
                ? 'bg-red-600 text-white shadow-md shadow-red-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Broadcast to Craftsmen</span>
          </button>
          <button
            onClick={() => { setActiveTab('direct'); setErrorMsg(''); setSuccessMsg(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'direct'
                ? 'bg-red-600 text-white shadow-md shadow-red-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Direct User Message</span>
          </button>
        </div>

        {/* Status Alerts */}
        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-xs flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-8 max-w-3xl">
          {activeTab === 'broadcast' ? (
            <form onSubmit={handleBroadcastSubmit} className="space-y-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">
                New Broadcast Announcement
              </h2>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Audience
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'ALL', label: 'All Craftsmen (Plumbers & Tile Installers)' },
                    { id: 'PLUMBER', label: 'Plumbers Only' },
                    { id: 'TILE_INSTALLER', label: 'Tile Installers Only' },
                  ].map((aud) => (
                    <label
                      key={aud.id}
                      className={`flex items-center space-x-2 p-3 rounded-xl border text-xs cursor-pointer transition ${
                        targetAudience === aud.id
                          ? 'border-red-600 bg-red-50/50 text-red-900 font-bold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value={aud.id}
                        checked={targetAudience === aud.id}
                        onChange={() => setTargetAudience(aud.id as any)}
                        className="text-red-600 focus:ring-red-500"
                      />
                      <span>{aud.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Announcement Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Diwali Dhamaka Bonus Points Now Active!"
                  maxLength={100}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Announcement Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Enter message details for mobile in-app notification center and push alert..."
                  rows={4}
                  maxLength={500}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition flex items-center space-x-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Dispatching Broadcast...' : 'Dispatch Broadcast'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleDirectSubmit} className="space-y-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">
                Direct User Message
              </h2>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Recipient User ID (UUID)
                </label>
                <input
                  type="text"
                  value={directUserId}
                  onChange={(e) => setDirectUserId(e.target.value)}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notification Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. KYC Clarification Needed"
                  maxLength={100}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notification Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Enter message for this specific craftsman..."
                  rows={3}
                  maxLength={500}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition flex items-center space-x-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Sending...' : 'Send Message'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Broadcast History Table */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Broadcast Campaign Audit Trail
          </h2>
          <span className="text-xs text-slate-400">
            {campaigns.length} total campaigns dispatched
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Dispatched At (IST)</th>
                <th className="py-3.5 px-4">Title & Message</th>
                <th className="py-3.5 px-4">Audience</th>
                <th className="py-3.5 px-4 text-center">Recipients</th>
                <th className="py-3.5 px-5">Dispatched By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingHistory ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    Loading broadcast history...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No broadcasts dispatched yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-5 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="py-3.5 px-4 max-w-sm">
                      <div className="font-bold text-slate-900">{c.title}</div>
                      <div className="text-slate-500 truncate text-[11px] mt-0.5">{c.message}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        c.targetAudience === 'PLUMBER'
                          ? 'bg-blue-50 text-blue-700'
                          : c.targetAudience === 'TILE_INSTALLER' || c.targetAudience === 'TILE_WORKER'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {c.targetAudience}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-slate-800">
                      {c.recipientCount}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600">
                      <div className="font-semibold">{c.createdByAdmin?.fullName || 'Operations Admin'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.createdByAdmin?.mobile || ''}</div>
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
