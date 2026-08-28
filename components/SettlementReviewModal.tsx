import React, { useMemo, useState } from 'react';
import { X, CheckCircle, FileText, RotateCcw, AlertTriangle } from 'lucide-react';
import { DropOff, Runner, SettlementPaymentMethod } from '../types';
import {
  SettlementReviewLine, initSettlementReview, settlementReviewTotals, buildSettlementFromReview,
  settlementDirection, settlementDirectionLabel,
} from '../domain/dropoffs';
import { printSettlementInvoice } from '../services/settlementInvoice';
import { useEscapeKey } from '../hooks/useEscapeKey';

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const PAID_BY_LABEL: Record<string, string> = { runner: 'Runner paid', store: 'Store paid', personal: 'Personal paid' };

interface Props {
  runner: Runner;
  dropOffs: DropOff[]; // the settleable set for this runner (settleableDropOffs)
  settlementId: string;
  date: string;
  paymentMethod: SettlementPaymentMethod;
  notes: string;
  storeName: string;
  isSubmitting: boolean;
  onClose: () => void;
  // Hands back the reviewed state; the caller (SettlementTab) builds the
  // final Settlement (same buildSettlementFromReview this modal uses for its
  // own preview) and writes it through the existing guarded settle() path —
  // this modal never writes anything itself.
  onConfirm: (lines: SettlementReviewLine[], adjustmentAmount: number, adjustmentNote: string) => void;
}

// The pre-settlement review screen: every drop-off in the pending batch as an
// editable line (fee correctable, or excludable from this run entirely),
// live-recalculating totals, plus a settlement-level adjustment for a
// one-off correction that doesn't belong to any single device. Nothing here
// writes to Firestore — this is pure review state until "Confirm Settlement"
// is pressed, which hands the reviewed lines back up to SettlementTab.
export const SettlementReviewModal: React.FC<Props> = ({
  runner, dropOffs, settlementId, date, paymentMethod, notes, storeName, isSubmitting, onClose, onConfirm,
}) => {
  const [lines, setLines] = useState<SettlementReviewLine[]>(() => initSettlementReview(dropOffs));
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');

  useEscapeKey(onClose);

  const byId = useMemo(() => new Map(dropOffs.map(d => [d.id, d])), [dropOffs]);
  const adjAmount = parseFloat(adjustmentAmount) || 0;
  const totals = settlementReviewTotals(dropOffs, lines, adjAmount);
  const direction = settlementDirection(totals.netAmount);

  const updateFee = (dropOffId: string, fee: number) =>
    setLines(prev => prev.map(l => l.dropOffId === dropOffId ? { ...l, fee } : l));
  const toggleIncluded = (dropOffId: string) =>
    setLines(prev => prev.map(l => l.dropOffId === dropOffId ? { ...l, included: !l.included } : l));
  const resetFee = (dropOffId: string) => {
    const d = byId.get(dropOffId);
    if (d) updateFee(dropOffId, d.dropOffFee || 0);
  };

  const draftSettlement = () => buildSettlementFromReview(
    { id: settlementId, runnerId: runner.id, date, paymentMethod, notes },
    dropOffs, lines, adjAmount, adjustmentNote,
  );

  const printPreview = () => printSettlementInvoice(draftSettlement(), runner, dropOffs, { storeName });

  const confirm = () => {
    if (totals.deviceCount === 0) return;
    onConfirm(lines, adjAmount, adjustmentNote);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <h2 className="font-bold text-slate-800 dark:text-slate-100">Review Settlement — {runner.name}</h2>
            <p className="text-xs text-slate-400">Check every line with the runner before confirming. Nothing is saved yet.</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map(l => {
              const d = byId.get(l.dropOffId);
              if (!d) return null;
              const edited = round2(l.fee) !== round2(d.dropOffFee || 0);
              return (
                <div key={l.dropOffId} className={`p-3 flex items-start gap-3 ${!l.included ? 'opacity-50' : ''}`}>
                  <input type="checkbox" className="mt-1 rounded" checked={l.included}
                    onChange={() => toggleIncluded(l.dropOffId)}
                    aria-label={l.included ? `Exclude ${d.item} from this settlement` : `Include ${d.item} in this settlement`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{d.item}</p>
                    <p className="text-[11px] text-slate-400">
                      {d.imei || 'No IMEI'} · Dropped {d.dateDropped} · {PAID_BY_LABEL[d.paidBy] || 'Store paid'} · Purchase {money(d.purchasePrice)}
                    </p>
                    {!l.included && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Excluded — stays unsettled, eligible for a later settlement.</p>}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <label className="text-[11px] text-slate-400">Fee</label>
                    <input type="number" step="0.01" disabled={!l.included} value={l.fee}
                      onChange={e => updateFee(l.dropOffId, parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 text-sm text-right bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md disabled:opacity-50" />
                    {edited && (
                      <button type="button" onClick={() => resetFee(l.dropOffId)} title={`Originally ${money(d.dropOffFee || 0)} — click to revert`}
                        className="text-amber-500 hover:text-amber-600"><RotateCcw className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Settlement-level adjustment ($)</label>
              <input type="number" step="0.01" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)}
                placeholder="0.00" className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
              <p className="text-[11px] text-slate-400 mt-1">Positive adds to what's owed the runner; negative deducts. For a one-off correction not tied to a single device.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Adjustment note</label>
              <input value={adjustmentNote} onChange={e => setAdjustmentNote(e.target.value)}
                placeholder="Why — required if adjusting"
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
            </div>
          </div>
          {adjAmount !== 0 && !adjustmentNote.trim() && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Add a note explaining the adjustment — it's kept on the settlement record.</p>
          )}

          <div className="space-y-1.5 text-sm border-t border-slate-100 dark:border-slate-800 pt-3">
            <Row label="Devices this settlement" value={String(totals.deviceCount)} raw />
            <Row label="Purchase cash fronted by runner" value={money(totals.cashFronted)} raw />
            <Row label="Total drop-off fees" value={money(totals.totalFees)} raw />
            {adjAmount !== 0 && <Row label="Settlement adjustment" value={`${adjAmount < 0 ? '-' : '+'}${money(Math.abs(adjAmount))}`} raw />}
            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
            <div className={`rounded-lg p-2 text-center font-semibold ${direction === 'runner_owes' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'}`}>
              {settlementDirectionLabel(totals.netAmount, direction)}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2 sticky bottom-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={printPreview} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <FileText className="w-4 h-4" /> Print Preview
          </button>
          <button onClick={confirm} disabled={totals.deviceCount === 0 || isSubmitting}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold">
            <CheckCircle className="w-4 h-4" /> {isSubmitting ? 'Settling…' : 'Confirm Settlement'}
          </button>
        </div>
      </div>
    </div>
  );
};

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

const Row: React.FC<{ label: string; value: string; raw?: boolean }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-slate-700 dark:text-slate-200 font-medium">{value}</span>
  </div>
);
