import React, { useState } from 'react';
import { X, CheckCircle2, XCircle, FileText, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';
import { AdminApiClient } from '../lib/api';

interface BillVerificationModalProps {
  bill: any;
  onClose: () => void;
  onVerified: () => void;
}

export default function BillVerificationModal({ bill, onClose, onVerified }: BillVerificationModalProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bill) return null;

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await AdminApiClient.verifyBill(bill.id, 'APPROVE');
      onVerified();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to approve bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      setError('Please provide a specific rejection reason for the worker.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await AdminApiClient.verifyBill(bill.id, 'REJECT', rejectionReason);
      onVerified();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reject bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPlumber = bill.userProfession === 'PLUMBER';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Verify Invoice Document</h3>
              <p className="text-xs text-slate-500">ID: {bill.invoiceNumber}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* User & Bill Overview Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Worker / Professional</div>
              <div className="text-sm font-bold text-slate-900 mt-1">{bill.userFullName}</div>
              <div className="text-xs text-slate-500">+91 {bill.userMobile}</div>
              <div className="mt-2">
                <span
                  className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-md ${
                    isPlumber
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {isPlumber ? 'PLUMBER' : 'TILE INSTALLER'}
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Invoice Summary</div>
              <div className="text-lg font-extrabold text-slate-900 mt-1">
                ₹{bill.billAmount.toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-slate-500">
                Date: {new Date(bill.invoiceDate).toLocaleDateString('en-IN')}
              </div>
              <div className="mt-2 flex items-center space-x-1.5 text-xs font-bold text-emerald-700">
                <ShieldCheck className="w-4 h-4" />
                <span>Calculated Reward: ₹{bill.calculatedReward} ({bill.rewardPercentage}%)</span>
              </div>
            </div>
          </div>

          {bill.remarks && (
            <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/50 text-xs text-amber-900">
              <span className="font-bold">Remarks from worker:</span> {bill.remarks}
            </div>
          )}

          {/* Secure Invoice Document Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Attached Document
              </span>
              <a
                href={`http://localhost:5000${bill.fileUrl}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center space-x-1 font-medium"
              >
                <span>Open in Fullscreen</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-100/60 flex items-center justify-center min-h-[220px]">
              <div className="text-center">
                <FileText className="w-12 h-12 text-blue-500 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">{bill.invoiceNumber}</p>
                <p className="text-[11px] text-slate-400 mt-1">Protected Cloudflare R2 Document Vault</p>
                <a
                  href={`http://localhost:5000${bill.fileUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block px-3 py-1.5 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm"
                >
                  View Signed Invoice
                </a>
              </div>
            </div>
          </div>

          {/* Rejection Mode Input */}
          {rejectMode && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
              <label className="block text-xs font-bold text-red-900">
                Mandatory Rejection Reason:
              </label>
              <textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="e.g. Invoice image is unreadable, or invoice amount does not match bill total..."
                rows={3}
                className="w-full text-xs p-2.5 rounded-lg border border-red-300 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRejectMode(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm"
                >
                  {isSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {!rejectMode && bill.status !== 'APPROVED' && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end space-x-3 bg-slate-50/50">
            <button
              onClick={() => setRejectMode(true)}
              className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
            >
              <XCircle className="w-4 h-4" />
              <span>Reject Bill</span>
            </button>
            <button
              onClick={handleApprove}
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-200 transition flex items-center space-x-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Approving...' : 'Approve & Credit Reward'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
