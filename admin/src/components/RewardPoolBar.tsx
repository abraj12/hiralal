import React from 'react';
import { ShieldAlert, TrendingUp } from 'lucide-react';

interface RewardPoolBarProps {
  totalPoolCap: number;
  usedAmount: number;
  remainingAmount: number;
  percentageUsed: number;
  isCapped?: boolean;
}

export default function RewardPoolBar({
  totalPoolCap = 50000,
  usedAmount = 37850,
  remainingAmount = 12150,
  percentageUsed = 75.7,
  isCapped = false,
}: RewardPoolBarProps) {
  const isHighUsage = percentageUsed >= 75;
  const isCritical = percentageUsed >= 90 || isCapped;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Monthly Reward Pool</h3>
            <p className="text-xs text-slate-500">Enforced atomically across all professions</p>
          </div>
        </div>

        <div className="text-right">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
              isCritical
                ? 'bg-red-100 text-red-700'
                : isHighUsage
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {isCritical && <ShieldAlert className="w-3.5 h-3.5 mr-1" />}
            {percentageUsed.toFixed(1)}% Used
          </span>
        </div>
      </div>

      {/* Figures */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
          ₹{usedAmount.toLocaleString('en-IN')}{' '}
          <span className="text-sm font-semibold text-slate-400">
            / ₹{totalPoolCap.toLocaleString('en-IN')}
          </span>
        </div>
        <div className="text-xs font-semibold text-slate-500">
          Remaining:{' '}
          <span className="text-slate-800 font-bold">
            ₹{remainingAmount.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200/50">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isCritical
              ? 'bg-red-600'
              : isHighUsage
              ? 'bg-amber-500'
              : 'bg-blue-600'
          }`}
          style={{ width: `${Math.min(100, percentageUsed)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-medium">
        <span>0%</span>
        <span>Monthly Cap: ₹{totalPoolCap.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
}
