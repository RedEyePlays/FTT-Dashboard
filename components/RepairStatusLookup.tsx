import React, { useState } from 'react';
import { Search, Wrench, CheckCircle2, Clock, PackageCheck, AlertTriangle, ArrowLeft } from 'lucide-react';
import { lookupRepairStatus, RepairStatusResult } from '../services/repairStatus';

// Standalone PUBLIC page (rendered at /status before any auth — see index.tsx).
// A customer enters their ticket number plus the name or last-4 phone on file and
// sees only the minimal status of that one repair. It never lists or searches
// across tickets; verification + field selection happen server-side in the
// repairStatusLookup Cloud Function.

const statusTone = (status?: string): { icon: React.ReactNode; cls: string } => {
  switch (status) {
    case 'Ready for Pickup':
      return { icon: <PackageCheck className="w-5 h-5" />, cls: 'bg-emerald-100 text-emerald-700' };
    case 'Completed':
      return { icon: <CheckCircle2 className="w-5 h-5" />, cls: 'bg-teal-100 text-teal-700' };
    case 'Cancelled':
      return { icon: <AlertTriangle className="w-5 h-5" />, cls: 'bg-rose-100 text-rose-700' };
    default:
      return { icon: <Clock className="w-5 h-5" />, cls: 'bg-indigo-100 text-indigo-700' };
  }
};

export const RepairStatusLookup: React.FC = () => {
  const [ticket, setTicket] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RepairStatusResult | null>(null);

  const canSubmit = ticket.trim().length > 0 && identifier.trim().length >= 3 && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await lookupRepairStatus(ticket, identifier);
      setResult(r);
    } catch (err: any) {
      const code = err?.code || '';
      setError(
        code.includes('resource-exhausted')
          ? 'Too many attempts. Please wait a minute and try again.'
          : code.includes('invalid-argument')
            ? 'Enter your ticket number and the name or phone on the ticket.'
            : 'Something went wrong. Please try again in a moment.',
      );
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setResult(null); setError(null); };

  const input = 'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center"><Wrench className="w-5 h-5" /></div>
          <h1 className="text-xl font-bold">Repair Status</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          {!result ? (
            <>
              <p className="text-sm text-slate-500 mb-4">Enter your repair ticket number and the name or phone number on the ticket to check its status.</p>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Ticket number</label>
                  <input value={ticket} onChange={e => setTicket(e.target.value)} placeholder="e.g. RPR-000123" className={input} autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Name or phone on ticket</label>
                  <input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Your name, or last 4 digits of your phone" className={input} />
                </div>
                {error && <p className="text-sm text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}
                <button type="submit" disabled={!canSubmit} className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
                  <Search className="w-4 h-4" /> {loading ? 'Checking…' : 'Check status'}
                </button>
              </form>
            </>
          ) : result.found ? (
            <div className="text-center">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${statusTone(result.status).cls}`}>
                {statusTone(result.status).icon} {result.status}
              </div>
              <p className="mt-4 text-lg font-bold">{result.device}</p>
              <p className="text-sm text-slate-500">Ticket {result.ticket}</p>
              {result.readyDate && <p className="mt-3 text-sm text-slate-600"><span className="font-medium">{result.status === 'Ready for Pickup' ? 'Ready since' : 'Completed'}:</span> {result.readyDate}</p>}
              {result.estimatedDate && <p className="mt-3 text-sm text-slate-600"><span className="font-medium">Estimated completion:</span> {result.estimatedDate}</p>}
              <p className="mt-4 text-xs text-slate-400">Questions? Contact the shop and reference your ticket number.</p>
              <button onClick={reset} className="mt-5 text-sm font-medium text-indigo-600 hover:underline flex items-center gap-1 mx-auto"><ArrowLeft className="w-4 h-4" /> Check another ticket</button>
            </div>
          ) : (
            <div className="text-center py-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-600"><AlertTriangle className="w-4 h-4" /> No matching repair</div>
              <p className="mt-4 text-sm text-slate-500">We couldn't find a repair matching that ticket number and name/phone. Double-check both and try again — or contact the shop.</p>
              <button onClick={reset} className="mt-5 text-sm font-medium text-indigo-600 hover:underline flex items-center gap-1 mx-auto"><ArrowLeft className="w-4 h-4" /> Try again</button>
            </div>
          )}
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-xs text-slate-400 hover:text-slate-600">Staff sign in →</a>
        </div>
      </div>
    </div>
  );
};
