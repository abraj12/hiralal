import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  FileText,
  ExternalLink,
  AlertTriangle,
  ShieldCheck,
  Calculator,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Info,
} from 'lucide-react';
import { AdminApiClient } from '../lib/api';
import { calculateBillFinancials, safeDocumentUrl } from '../lib/financial-utils';

interface BillVerificationModalProps {
  bill: any;
  onClose: () => void;
  onVerified: () => void;
}

export default function BillVerificationModal({ bill, onClose, onVerified }: BillVerificationModalProps) {
  const isPending = bill.status === 'PENDING' || bill.status === 'UNDER_REVIEW';
  const isApproved = bill.status === 'APPROVED';
  const isRejected = bill.status === 'REJECTED';

  const [rejectMode, setRejectMode] = useState(false);
  const [rejectionReason, setRejectionReason] = useState(bill.rejectionReason || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic GST & Financial Verification Controls
  const [gstIncluded, setGstIncluded] = useState(Boolean(bill.gstIncluded));
  const [gstRules, setGstRules] = useState<any[]>([]);
  const [selectedGstRate, setSelectedGstRate] = useState<number>(
    typeof bill.gstRate === 'number'
      ? bill.gstRate
      : (bill.gstRate !== null && bill.gstRate !== undefined && !isNaN(Number(bill.gstRate)))
      ? Number(bill.gstRate)
      : 0
  );
  const [selectedGstRuleId, setSelectedGstRuleId] = useState<string>(bill.gstRuleId || '');

  // HIR-H-01: Vendor identity scopes invoice uniqueness to the issuing vendor
  const [vendorGstin, setVendorGstin] = useState<string>(bill.vendorGstin || '');
  const [merchantName, setMerchantName] = useState<string>(bill.merchantName || '');
  const hasVendorIdentity = vendorGstin.trim().length > 0 || merchantName.trim().length >= 2;

  const [rewardPercentage, setRewardPercentage] = useState<number | null>(
    bill.rewardRateSnapshot !== null && bill.rewardRateSnapshot !== undefined
      ? Number(bill.rewardRateSnapshot)
      : bill.rewardPercentage !== null && bill.rewardPercentage !== undefined
      ? Number(bill.rewardPercentage)
      : null
  );
  const [ruleVersion, setRuleVersion] = useState<number | null>(bill.rewardRule?.version ?? null);
  const [submissionTimestamp, setSubmissionTimestamp] = useState<string | null>(
    bill.createdAt || null
  );
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [rulesUnavailable, setRulesUnavailable] = useState(false);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');

  useEffect(() => {
    const user = AdminApiClient.getUser();
    if (user?.role) {
      setCurrentUserRole(user.role);
    }
  }, []);

  // Image zoom control
  const [isZoomed, setIsZoomed] = useState(false);

  // Document Preview & Signed URL Refresh
  const [docUrl, setDocUrl] = useState<string | null>(bill.fileUrl || null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const handleRefreshDocumentUrl = async () => {
    setDocLoading(true);
    setDocError(null);
    try {
      const res = await AdminApiClient.getBillDocumentUrl(bill.id);
      if (res && res.documentUrl) {
        setDocUrl(res.documentUrl);
      } else {
        setDocError('Document file could not be located in secure storage vault.');
      }
    } catch (err: any) {
      setDocError(err.message || 'Failed to refresh signed document link.');
    } finally {
      setDocLoading(false);
    }
  };

  // Auto-refresh signed document URL on mount to prevent expired presigned links
  useEffect(() => {
    let active = true;
    if (bill?.id) {
      setDocLoading(true);
      setDocError(null);
      AdminApiClient.getBillDocumentUrl(bill.id)
        .then((res) => {
          if (active && res && res.documentUrl) {
            setDocUrl(res.documentUrl);
          }
        })
        .catch((err) => {
          console.warn('Auto-refresh document URL notice:', err?.message);
        })
        .finally(() => {
          if (active) setDocLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [bill?.id]);

  // VULN-MED-09: Use authoritative safeDocumentUrl to strictly reject backslashes and protocol-relative injections
  const rawTarget = safeDocumentUrl(docUrl || bill?.fileUrl);
  const targetUrl = rawTarget !== '#' ? rawTarget : null;
  const isPdf = Boolean(
    bill.fileName?.toLowerCase().endsWith('.pdf') ||
    bill.mimeType === 'application/pdf' ||
    targetUrl?.toLowerCase().includes('.pdf')
  );
  const isImage = !isPdf && Boolean(
    bill.fileName?.match(/\.(jpg|jpeg|png|webp)$/i) ||
    bill.mimeType?.startsWith('image/') ||
    targetUrl?.match(/\.(jpg|jpeg|png|webp)/i)
  );

  // Safe accessor for professional info
  const workerFullName = bill.userFullName || bill.user?.fullName || 'Worker';
  const workerMobile = bill.userMobile || bill.user?.mobile || '';
  const profession = bill.profession || bill.user?.profession || bill.userProfession;
  const isPlumber = profession === 'PLUMBER';
  const grossAmount = Number(bill.grossBillAmount || bill.billAmount || 0);

  // Load bill-specific review config for pending verification
  useEffect(() => {
    if (!isPending) return;

    async function loadReviewConfig() {
      try {
        setError(null);
        setRulesUnavailable(false);
        const res = await AdminApiClient.getBillReviewConfig(bill.id);

        if (res && res.submissionTimestamp) {
          setSubmissionTimestamp(res.submissionTimestamp);
        }

        if (res && res.gstRules && res.gstRules.length > 0) {
          setGstRules(res.gstRules);
          const defaultRule = res.gstRules.find((r: any) => r.isDefault) || res.gstRules[0];
          setSelectedGstRate(Number(defaultRule.ratePercentage));
          setSelectedGstRuleId(defaultRule.id);
        } else {
          setGstRules([]);
          setSelectedGstRuleId('');
          setRulesUnavailable(true);
        }

        if (res && res.rewardRule && typeof res.rewardRule.rewardPercentage === 'number') {
          setRewardPercentage(Number(res.rewardRule.rewardPercentage));
          setRuleVersion(res.rewardRule.version ?? null);
        } else {
          setRewardPercentage(null);
          setRuleVersion(null);
          setRulesUnavailable(true);
        }
      } catch (e: any) {
        setRulesUnavailable(true);
        setError(
          e.message ||
            'Bill review configuration could not be loaded. Approval is disabled to preserve financial integrity.'
        );
      }
    }
    loadReviewConfig();
  }, [bill.id, isPending]);

  // Financial calculations: Submitted gross amount is immutable.
  const effectiveGross = grossAmount;

  let gstAmount = 0;
  let eligibleRewardAmount = effectiveGross;
  let calculatedReward = 0;

  if (isPending) {
    const liveFinancials = calculateBillFinancials(
      effectiveGross,
      gstIncluded,
      selectedGstRate,
      rewardPercentage
    );
    gstAmount = liveFinancials.gstAmount;
    eligibleRewardAmount = liveFinancials.eligibleRewardAmount;
    calculatedReward = liveFinancials.calculatedReward;
  } else {
    // Stored audited numbers for historical records
    gstAmount = Number(bill.gstAmount || 0);
    eligibleRewardAmount = Number(
      bill.eligibleRewardAmount !== null && bill.eligibleRewardAmount !== undefined
        ? bill.eligibleRewardAmount
        : grossAmount
    );
    calculatedReward = Number(bill.calculatedReward || 0);
  }

  const isSecondary = Boolean(bill.requiresSecondaryApproval);
  const isRoleAuthorized = Boolean(currentUserRole) && (isSecondary ? currentUserRole === 'OPERATIONS_ADMIN' : currentUserRole === 'BILL_ADMIN');

  const handleApprove = async () => {
    if (!hasVendorIdentity) {
      setError('Enter the vendor GSTIN printed on the invoice, or the merchant/shop name if it has no GSTIN.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await AdminApiClient.verifyBill(bill.id, {
        action: 'APPROVE',
        gstIncluded,
        gstRate: gstIncluded ? selectedGstRate : 0,
        gstRuleId: gstIncluded ? (selectedGstRuleId || undefined) : undefined,
        vendorGstin: vendorGstin.trim() ? vendorGstin.trim().toUpperCase() : undefined,
        merchantName: merchantName.trim() || undefined,
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
    if (!rejectionReason.trim() || rejectionReason.trim().length < 3) {
      setError('Please provide a specific rejection reason for the worker (at least 3 characters).');
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

  const handleCancel = async () => {
    if (!cancellationReason.trim() || cancellationReason.trim().length < 3) {
      setError('Please provide a specific cancellation reason (at least 3 characters).');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await AdminApiClient.verifyBill(bill.id, {
        action: 'CANCEL',
        cancellationReason: cancellationReason.trim(),
      });
      onVerified();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-100 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-xl ${
                isPlumber ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-900">
                  {isPending ? 'Verify Invoice Document' : 'Invoice Record Details'}
                </h3>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                    isApproved
                      ? 'bg-emerald-100 text-emerald-800'
                      : isRejected
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {bill.status}
                </span>
                {bill.revisionNumber && bill.revisionNumber > 1 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    Rev #{bill.revisionNumber}
                  </span>
                )}
                {bill.requiresSecondaryApproval && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                    Secondary Review
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">Invoice: #{bill.invoiceNumber}</p>
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

        {isPending && currentUserRole && !isRoleAuthorized && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              {isSecondary
                ? 'This invoice revision has upward price inflation (>25%) and strictly requires Operations Admin review.'
                : 'Standard invoice verification must be performed by a Bill Review Administrator.'}
            </span>
          </div>
        )}

        <div className="p-6 space-y-6 flex-1">
          {/* Historical Status Alert for Approved/Rejected */}
          {isApproved && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Verified & Approved:</strong> {calculatedReward.toFixed(2)} Points was credited to{' '}
                {workerFullName}'s rewards wallet using an active snapshot reward rule.
              </span>
            </div>
          )}

          {isRejected && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl space-y-1">
              <div className="flex items-center space-x-2 font-bold">
                <XCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>Invoice Rejected</span>
              </div>
              <p className="text-xs pl-6">Reason: {rejectionReason || 'No reason provided.'}</p>
            </div>
          )}

          {/* User & Bill Overview Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs text-slate-400 font-medium">Worker / Professional</div>
              <div className="text-sm font-bold text-slate-900 mt-1">{workerFullName}</div>
              {workerMobile && (
                <div className="text-xs text-slate-500 font-mono">+91 {workerMobile}</div>
              )}
              <div className="mt-2">
                <span
                  className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-md ${
                    isPlumber ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {isPlumber ? 'PLUMBER' : 'TILE INSTALLER'}
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400 font-medium">Submitted Gross Amount</div>
                <span className="text-[10px] text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Immutable Submission
                </span>
              </div>
              <div className="text-xl font-black text-slate-900 mt-1">
                ₹{grossAmount.toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Invoice Date:{' '}
                {bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
              </div>
              {submissionTimestamp && (
                <div className="text-[11px] text-blue-600 font-medium mt-0.5">
                  Submitted: {new Date(submissionTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
              )}
            </div>
          </div>

          {/* GST & Financial Verification Section */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
            {isPending ? (
              <>
                <div className="space-y-2 pb-3 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-900 block">Vendor on invoice (required)</span>
                  <input
                    type="text"
                    value={vendorGstin}
                    onChange={(e) => setVendorGstin(e.target.value)}
                    maxLength={15}
                    placeholder="Vendor GSTIN, e.g. 08AAAAA0000A1Z5"
                    aria-label="Vendor GSTIN"
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                  />
                  <input
                    type="text"
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    maxLength={200}
                    placeholder="Merchant / shop name (required if no GSTIN)"
                    aria-label="Merchant name"
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Used to stop the same invoice being rewarded to more than one account.
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <label
                    htmlFor="gstIncludedCheckbox"
                    className="flex items-start space-x-3 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      id="gstIncludedCheckbox"
                      checked={gstIncluded}
                      onChange={(e) => setGstIncluded(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        GST is included in this bill total — deduct GST before calculating reward.
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        Unchecked: GST deducted = ₹0, full valid bill amount eligible. Checked: embedded
                        GST deducted via reverse GST formula.
                      </span>
                    </div>
                  </label>
                </div>

                {gstIncluded && (
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Applicable GST Rule (Configured by Operations Administrator):
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
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Select the tax rule applicable to this invoice. Manual custom GST rate overrides
                      are disabled to maintain accounting integrity.
                    </span>
                  </div>
                )}
              </>
            ) : (
              /* Read-only view for already resolved bills */
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-xs font-bold text-slate-700">Tax Auditing:</span>
                <span className="text-xs font-bold text-slate-900">
                  {bill.gstIncluded ? `GST Included (${bill.gstRate}%)` : 'GST Excluded (0%)'}
                </span>
              </div>
            )}

            {/* Financial Calculation Breakdown Table */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 grid grid-cols-3 gap-3 text-center">
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">GST Component</span>
                <span className="text-sm font-bold text-slate-800">
                  {(isPending ? gstIncluded : bill.gstIncluded)
                    ? `₹${gstAmount.toFixed(2)}`
                    : '₹0.00'}
                </span>
                {(isPending ? gstIncluded : bill.gstIncluded) && (
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    ({isPending ? selectedGstRate : bill.gstRate}% inclusive)
                  </span>
                )}
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Eligible Base</span>
                <span className="text-sm font-bold text-blue-700">
                  ₹{eligibleRewardAmount.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Tax-exclusive base</span>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Calculated Reward</span>
                {isPending && rewardPercentage === null && !rulesUnavailable ? (
                  <span className="inline-flex items-center text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded animate-pulse mt-0.5">
                    Calculating...
                  </span>
                ) : (
                  <span className="text-sm font-extrabold text-emerald-600">
                    {calculatedReward.toFixed(2)} Points
                  </span>
                )}
                <span className="text-[10px] text-emerald-700 font-medium block mt-0.5">
                  {rewardPercentage !== null ? `@${rewardPercentage}%` : 'Rule unavailable'}
                  {ruleVersion !== null ? ` (v${ruleVersion})` : ''}
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Original Invoice Document
                </span>
              </div>
              <div className="flex items-center space-x-2">
                {isImage && targetUrl && (
                  <button
                    type="button"
                    onClick={() => setIsZoomed(!isZoomed)}
                    className="text-xs text-slate-600 hover:text-slate-900 flex items-center space-x-1 font-semibold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 transition"
                    title={isZoomed ? 'Reset zoom' : 'Enlarge view'}
                  >
                    {isZoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                    <span>{isZoomed ? 'Reset' : 'Zoom'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRefreshDocumentUrl}
                  disabled={docLoading}
                  className="text-xs text-slate-600 hover:text-slate-900 flex items-center space-x-1 font-semibold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 transition"
                  title="Request fresh signed URL from Cloudflare R2 vault"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${docLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh Link</span>
                </button>
                {targetUrl && (
                  <a
                    href={safeDocumentUrl(targetUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1 font-semibold px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 transition"
                  >
                    <span>Fullscreen</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl p-3 bg-slate-100/70 overflow-hidden min-h-[180px] flex flex-col justify-center items-center">
              {docLoading ? (
                <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                  <span>Retrieving secure signed invoice...</span>
                </div>
              ) : docError ? (
                <div className="py-6 px-4 text-center max-w-sm">
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-800">Document Unavailable</p>
                  <p className="text-[11px] text-slate-500 mt-1">{docError}</p>
                  <button
                    type="button"
                    onClick={handleRefreshDocumentUrl}
                    className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 shadow-sm transition"
                  >
                    Retry Loading Document
                  </button>
                </div>
              ) : !targetUrl ? (
                <div className="py-8 text-center">
                  <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No active signed URL</p>
                  <button
                    type="button"
                    onClick={handleRefreshDocumentUrl}
                    className="mt-2 px-3 py-1 bg-white border border-slate-300 text-xs font-bold text-slate-700 rounded-lg hover:bg-slate-50"
                  >
                    Load Document
                  </button>
                </div>
              ) : isImage ? (
                <div className="w-full text-center overflow-auto max-h-[460px]">
                  <img
                    src={targetUrl}
                    alt={`Invoice #${bill.invoiceNumber}`}
                    className={`mx-auto rounded-lg object-contain shadow-sm border border-slate-200 bg-white transition-all duration-200 ${
                      isZoomed ? 'scale-150 my-12' : 'max-h-[380px] w-auto'
                    }`}
                    onError={() => setDocError('Image failed to load. The signed URL may have expired.')}
                  />
                  <p className="text-[11px] text-slate-400 mt-2">
                    {bill.fileName || 'Original invoice image'} • Cloudflare R2 Protected Vault
                  </p>
                </div>
              ) : isPdf ? (
                <div className="w-full">
                  <iframe
                    src={`${targetUrl}#toolbar=0`}
                    className="w-full h-80 rounded-lg border border-slate-200 bg-white"
                    title={`Invoice PDF ${bill.invoiceNumber}`}
                    sandbox="allow-same-origin"
                    referrerPolicy="no-referrer"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 px-1">
                    <span>{bill.fileName || 'Invoice Document (PDF)'}</span>
                    <a
                      href={safeDocumentUrl(targetUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 font-bold hover:underline flex items-center space-x-1"
                    >
                      <span>Open in new window</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <FileText className="w-12 h-12 text-blue-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-800">{bill.invoiceNumber}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{bill.fileName || 'Uploaded Invoice Document'}</p>
                  <a
                    href={safeDocumentUrl(targetUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 shadow-sm transition"
                  >
                    <span>View / Download Document</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Rejection Mode Input */}
          {rejectMode && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
              <label className="block text-xs font-bold text-red-900">
                Mandatory Rejection Reason (visible to worker):
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Invoice image is blurry or truncated, amount does not match bill total, or invalid dealer stamp..."
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
                  disabled={isSubmitting || !isRoleAuthorized}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          )}

          {/* Cancellation Mode Input */}
          {cancelMode && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <label className="block text-xs font-bold text-amber-900">
                Mandatory Cancellation Reason (fraudulent / invalid invoice):
              </label>
              <textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g. Fraudulent invoice submission, forged seal or duplicate altered document..."
                rows={3}
                className="w-full text-xs p-2.5 rounded-lg border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setCancelMode(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSubmitting || !isRoleAuthorized}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Action Buttons */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl transition"
          >
            Close
          </button>

          {!rejectMode && !cancelMode && isPending && (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={!isRoleAuthorized}
                onClick={() => setCancelMode(true)}
                className={`px-3 py-2 border border-amber-200 text-amber-700 hover:bg-amber-50 text-xs font-bold rounded-xl transition flex items-center space-x-1 ${!isRoleAuthorized ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!isRoleAuthorized ? (isSecondary ? 'Requires Operations Admin role' : 'Requires Bill Review Admin role') : 'Cancel fraudulent or invalid submission'}
              >
                <span>Cancel</span>
              </button>
              <button
                type="button"
                disabled={!isRoleAuthorized}
                onClick={() => setRejectMode(true)}
                className={`px-3 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl transition flex items-center space-x-1 ${!isRoleAuthorized ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!isRoleAuthorized ? (isSecondary ? 'Requires Operations Admin role' : 'Requires Bill Review Admin role') : undefined}
              >
                <XCircle className="w-4 h-4" />
                <span>Reject</span>
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={
                  isSubmitting ||
                  rulesUnavailable ||
                  rewardPercentage === null ||
                  (gstIncluded && !selectedGstRuleId) ||
                  !hasVendorIdentity ||
                  !isRoleAuthorized
                }
                title={!isRoleAuthorized ? (isSecondary ? 'Requires Operations Admin role' : 'Requires Bill Review Admin role') : undefined}
                className={`px-4 py-2 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center space-x-1.5 ${
                  rulesUnavailable ||
                  rewardPercentage === null ||
                  (gstIncluded && !selectedGstRuleId) ||
                  !hasVendorIdentity ||
                  !isRoleAuthorized
                    ? 'bg-slate-400 opacity-50 cursor-not-allowed shadow-none'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'Approving...'
                    : `Approve & Credit ${calculatedReward.toFixed(2)} Pts`}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
