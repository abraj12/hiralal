import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, FileText, ExternalLink, AlertTriangle, ShieldCheck, Calculator } from 'lucide-react';
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

  // Dynamic GST & Financial Verification Controls
  const [gstIncluded, setGstIncluded] = useState(false);
  const [gstRules, setGstRules] = useState<any[]>([]);
  const [selectedGstRate, setSelectedGstRate] = useState<number>(18.0);
  const [selectedGstRuleId, setSelectedGstRuleId] = useState<string>('');
  const [gstOverrideReason, setGstOverrideReason] = useState<string>('');
  const [customRewardAmount, setCustomRewardAmount] = useState<string>('');

  const [rewardPercentage, setRewardPercentage] = useState<number | null>(null);
  const [rulesUnavailable, setRulesUnavailable] = useState(false);

  const isPlumber = (bill.profession || bill.userProfession) === 'PLUMBER';
  const grossAmount = Number(bill.grossBillAmount || bill.billAmount || 0);

  // Load configured GST rules and reward rules on mount
  useEffect(() => {
    async function loadRules() {
      try {
        const profession = bill.profession || bill.userProfession || (bill.user && bill.user.profession);
        const [gstRes, rewardRes] = await Promise.all([
          AdminApiClient.getGstRules(),
          AdminApiClient.getRewardRules(profession || 'ALL'),
        ]);

        if (gstRes.rules && gstRes.rules.length > 0) {
          setGstRules(gstRes.rules);
          const defaultRule = gstRes.rules.find((r: any) => r.isDefault) || gstRes.rules[0];
          setSelectedGstRate(Number(defaultRule.ratePercentage));
          setSelectedGstRuleId(defaultRule.id);
        } else {
          setRulesUnavailable(true);
        }

        const activeRewardRule = rewardRes.rules?.find((r: any) => r.isActive && (!profession || r.profession === profession));
        if (activeRewardRule) {
          setRewardPercentage(Number(activeRewardRule.rewardPercentage));
        } else {
          setRulesUnavailable(true);
        }
      } catch (e: any) {
        setRulesUnavailable(true);
        setError('Real GST or reward rules could not be loaded from database. Approval is disabled to preserve financial integrity.');
      }
    }
    loadRules();
  }, [bill]);

  // Live Reverse GST Calculation (paise-rounded)
  const gstAmount = gstIncluded && selectedGstRate > 0
    ? Math.round(((grossAmount * selectedGstRate) / (100 + selectedGstRate)) * 100) / 100
    : 0.0;

  const eligibleRewardAmount = Math.max(0, Math.round((grossAmount - gstAmount) * 100) / 100);

  // Profession-specific reward rate preview (internal admin display from authoritative database rule)
  const configuredRewardPercentage = rewardPercentage ?? (isPlumber ? 0.50 : 0.75);
  const calculatedReward = customRewardAmount && !isNaN(parseFloat(customRewardAmount))
    ? parseFloat(customRewardAmount)
    : Math.round(eligibleRewardAmount * (configuredRewardPercentage / 100) * 100) / 100;

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await AdminApiClient.verifyBill(bill.id, {
        action: 'APPROVE',
        gstIncluded,
        gstRate: gstIncluded ? selectedGstRate : 0,
        gstRuleId: gstIncluded ? (selectedGstRuleId || undefined) : undefined,
        gstOverrideReason: gstOverrideReason.trim() || undefined,
        customRewardAmount: customRewardAmount ? parseFloat(customRewardAmount) : undefined,
      });
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
      await AdminApiClient.verifyBill(bill.id, {
        action: 'REJECT',
        rejectionReason: rejectionReason.trim(),
      });
      onVerified();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reject bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl ${isPlumber ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Verify Invoice Document</h3>
              <p className="text-xs text-slate-500">Invoice: {bill.invoiceNumber}</p>
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
              <div className="text-xs text-slate-400 font-medium">Gross Invoice Amount</div>
              <div className="text-xl font-black text-slate-900 mt-1">
                ₹{grossAmount.toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Date: {new Date(bill.invoiceDate).toLocaleDateString('en-IN')}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Status: <span className="font-semibold text-slate-700">{bill.status}</span>
              </div>
            </div>
          </div>

          {/* Dynamic GST Audit Section (Admin Control) */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Calculator className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Tax / GST Treatment (Admin Decision)
                </span>
              </div>
              <div className="flex items-center space-x-1.5 bg-slate-200/80 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setGstIncluded(false)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition ${
                    !gstIncluded ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  GST Excluded (NO)
                </button>
                <button
                  type="button"
                  onClick={() => setGstIncluded(true)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition ${
                    gstIncluded ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  GST Included (YES)
                </button>
              </div>
            </div>

            {gstIncluded && (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Applicable GST Rate:
                  </label>
                  <select
                    value={selectedGstRuleId}
                    onChange={(e) => {
                      const ruleId = e.target.value;
                      setSelectedGstRuleId(ruleId);
                      const found = gstRules.find((r) => r.id === ruleId);
                      if (found) setSelectedGstRate(Number(found.ratePercentage));
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    {gstRules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.ratePercentage}% GST {r.description ? `(${r.description})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Override Reason (Optional):
                  </label>
                  <input
                    type="text"
                    value={gstOverrideReason}
                    onChange={(e) => setGstOverrideReason(e.target.value)}
                    placeholder="e.g. Verified tax breakdown on invoice"
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {/* Financial Calculation Breakdown Table */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 grid grid-cols-3 gap-3 text-center">
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">GST Component</span>
                <span className="text-sm font-bold text-slate-800">
                  {gstIncluded ? `₹${gstAmount.toFixed(2)}` : '₹0.00'}
                </span>
                {gstIncluded && (
                  <span className="text-[10px] text-slate-400 block mt-0.5">({selectedGstRate}% inclusive)</span>
                )}
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Eligible Amount</span>
                <span className="text-sm font-bold text-blue-700">
                  ₹{eligibleRewardAmount.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Tax-exclusive base</span>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Calculated Reward</span>
                <span className="text-sm font-extrabold text-emerald-600">
                  ₹{calculatedReward.toFixed(2)}
                </span>
                <span className="text-[10px] text-emerald-700 font-medium block mt-0.5">
                  Internal: {configuredRewardPercentage}%
                </span>
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
                href={bill.fileUrl?.startsWith('http') ? bill.fileUrl : (bill.fileUrl?.startsWith('/') ? bill.fileUrl : `/${bill.fileUrl || ''}`)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center space-x-1 font-medium"
              >
                <span>Open in Fullscreen</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-100/60 flex items-center justify-center min-h-[200px]">
              <div className="text-center">
                <FileText className="w-12 h-12 text-blue-500 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">{bill.invoiceNumber}</p>
                <p className="text-[11px] text-slate-400 mt-1">Protected Cloudflare R2 Document Vault</p>
                <a
                  href={bill.fileUrl?.startsWith('http') ? bill.fileUrl : (bill.fileUrl?.startsWith('/') ? bill.fileUrl : `/${bill.fileUrl || ''}`)}
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
                onChange={(e) => setRejectionReason(e.target.value)}
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
              disabled={isSubmitting || rulesUnavailable}
              className={`px-5 py-2 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center space-x-1.5 ${
                rulesUnavailable
                  ? 'bg-slate-400 opacity-50 cursor-not-allowed shadow-none'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Approving...' : `Approve & Credit ₹${calculatedReward.toFixed(2)}`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
