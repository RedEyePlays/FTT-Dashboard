import React, { useState } from 'react';
import { X, HandCoins, Loader2, Printer } from 'lucide-react';
import { SalesTransaction } from '../types';
import { mixedPaymentMismatch } from '../domain/pos';
import { todayISO } from '../domain/dates';
import { printBalancePaymentReceipt } from '../services/salesReceipt';
import { getStoreProfile } from './SettingsModal';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

type PaymentMethod = 'cash' | 'card' | 'mixed' | 'etransfer';

interface Props {
  tx: SalesTransaction;
  onClose: () => void;
  // Performs the write (App.tsx's handleCollectBalance) and returns the
  // updated transaction so this modal can offer a receipt for THIS payment.
  onConfirm: (input: { amount: number; paymentMethod: PaymentMethod; cashAmount?: number; cardAmount?: number; etransferAmount?: number; date: string }) => Promise<SalesTransaction>;
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;

/**
 * The dedicated "Collect balance" mini-modal (item 1 of the layaway-
 * completion batch) — deliberately NOT new fields bolted onto Quick Sale and
 * NOT a re-route through checkout. Just payment method + amount + confirm,
 * reachable from the customer profile / invoice where the open balance
 * already shows.
 */
export const CollectBalanceModal: React.FC<Props> = ({ tx, onClose, onConfirm }) => {
  const remaining = tx.balanceOwing || 0;
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [etransferAmount, setEtransferAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transaction: SalesTransaction; fullyPaid: boolean } | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  useEscapeKey(() => { if (!isSubmitting) onClose(); });

  const amountNum = Math.min(Math.max(0, parseFloat(amount) || 0), remaining);
  const mixedTotal = (parseFloat(cashAmount) || 0) + (parseFloat(cardAmount) || 0) + (parseFloat(etransferAmount) || 0);
  const mixedInvalid = paymentMethod === 'mixed' && mixedPaymentMismatch(
    { cash: parseFloat(cashAmount) || 0, card: parseFloat(cardAmount) || 0, etransfer: parseFloat(etransferAmount) || 0 },
    amountNum,
  );
  const canSubmit = amountNum > 0.005 && !mixedInvalid;

  const submit = () => {
    if (!canSubmit) return;
    run(() => {
      setError(null);
      onConfirm({
        amount: amountNum, paymentMethod, date,
        cashAmount: paymentMethod === 'mixed' ? parseFloat(cashAmount) || 0 : undefined,
        cardAmount: paymentMethod === 'mixed' ? parseFloat(cardAmount) || 0 : undefined,
        etransferAmount: paymentMethod === 'mixed' ? parseFloat(etransferAmount) || 0 : undefined,
      }).then(transaction => {
        setResult({ transaction, fullyPaid: (transaction.balanceOwing || 0) <= 0.005 });
      }).catch(e => setError(e?.message || 'Failed to record payment. Nothing was charged.'));
    });
  };

  const inp = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  if (result) {
    const payment = result.transaction.balancePayments![result.transaction.balancePayments!.length - 1];
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <HandCoins className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{money(payment.amount)} collected</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {result.fullyPaid ? 'Paid in full — the device is now marked sold.' : `${money(result.transaction.balanceOwing || 0)} still owing.`}
            </p>
          </div>
          <button
            onClick={() => printBalancePaymentReceipt(result.transaction, payment, result.transaction.balanceOwing || 0, { storeName: getStoreProfile().storeName })}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            <Printer className="w-4 h-4" /> Print Payment Receipt
          </button>
          <button onClick={onClose} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2"><HandCoins className="w-4 h-4 text-indigo-500" /> Collect Balance</h2>
          <button onClick={onClose} disabled={isSubmitting} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between text-sm bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-500/30 rounded-lg px-3 py-2">
            <span className="text-slate-500 dark:text-slate-400">{tx.customerName || 'Walk-in'} · Sale {tx.id.slice(0, 8)}</span>
            <span className="font-bold text-sky-700 dark:text-sky-300">{money(remaining)} owing</span>
          </div>

          <div>
            <label className={lbl}>Amount collected</label>
            <input type="number" min="0" max={remaining} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inp} />
            {amountNum < remaining - 0.005 && amountNum > 0 && (
              <p className="text-[11px] text-slate-400 mt-1">Partial payment — {money(remaining - amountNum)} will remain owing; the device stays reserved.</p>
            )}
          </div>

          <div>
            <label className={lbl}>Payment method</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['cash', 'card', 'etransfer', 'mixed'] as PaymentMethod[]).map(m => (
                <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                  className={`py-1.5 rounded-lg text-xs font-medium border capitalize ${paymentMethod === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {m === 'etransfer' ? 'E-Transfer' : m}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'mixed' && (
            <div className="grid grid-cols-3 gap-2">
              <div><label className={lbl}>Cash</label><input type="number" min="0" step="0.01" value={cashAmount} onChange={e => setCashAmount(e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Card</label><input type="number" min="0" step="0.01" value={cardAmount} onChange={e => setCardAmount(e.target.value)} className={inp} /></div>
              <div><label className={lbl}>E-Transfer</label><input type="number" min="0" step="0.01" value={etransferAmount} onChange={e => setEtransferAmount(e.target.value)} className={inp} /></div>
              {mixedInvalid && <p className="col-span-3 text-[11px] text-rose-500">Cash + Card + E-Transfer must add up to {money(amountNum)}. Currently {money(mixedTotal)}.</p>}
            </div>
          )}

          <div>
            <label className={lbl}>Date</label>
            <input type="date" max={todayISO()} value={date} onChange={e => setDate(e.target.value)} className={inp} />
            <p className="text-[11px] text-slate-400 mt-1">Backdatable for record-keeping. Cash always posts to today's drawer, the day it's actually collected.</p>
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={submit} disabled={!canSubmit || isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold">
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <HandCoins className="w-4 h-4" />}
            {isSubmitting ? 'Recording…' : `Collect ${money(amountNum)}`}
          </button>
        </div>
      </div>
    </div>
  );
};
