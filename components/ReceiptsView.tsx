import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, Images, Receipt as ReceiptIcon, Search, X, Check, Trash2, Loader2,
  AlertTriangle, CloudOff, FileText, ChevronLeft, ChevronRight, Ban, Plus,
} from 'lucide-react';
import { AppUser, Expense, Receipt, ReceiptStatus } from '../types';
import { ExpenseCategory } from '../domain/expenses';
import {
  ExpenseDraft, RECEIPT_STATUSES, RECEIPT_STATUS_LABEL, ReceiptQuery,
  applyEdit, clampCategory, correctedFields, draftFromReceipt, effectiveFields,
  receiptStatus, searchReceipts,
} from '../domain/receipt';
import {
  PendingReceiptRow, QueuedScan, pendingRows, unsentWarning,
} from '../domain/receiptQueue';
import { toISODate } from '../domain/dates';
import { receiptUrl } from '../services/receiptUpload';

/**
 * THE RECEIPT ARCHIVE. The archive is the product.
 *
 * One button to photograph a receipt. The photo is filed and kept. Nothing
 * else is required, and most receipts here will never be anything but filed —
 * which is success, not a backlog.
 *
 * THE EXPENSE IS AN OPTIONAL ACTION ON TOP OF THE FILE. There is exactly one
 * control in this component that creates an Expense: the "Create expense"
 * button in ReviewPanel, which calls `onCreateExpense` with the draft the
 * owner is looking at. No effect, no timer and no status transition calls it.
 * A test asserts that nothing else can.
 *
 * `unreviewed` IS NEVER HIDDEN BY DEFAULT. The status filter starts empty,
 * meaning everything, and the list is newest first.
 */

interface Props {
  me: AppUser;
  receipts: Receipt[];
  /** Scans still held on THIS DEVICE (services/receiptQueue.ts). */
  queue: QueuedScan[];
  categories: ExpenseCategory[];
  /** Live expenses, so a linked receipt can show (and reach) its expense. */
  expenses: Pick<Expense, 'id' | 'date' | 'amount' | 'category'>[];
  canDelete: boolean;
  isOffline: boolean;
  /** Start one or more scans. The caller queues, uploads and parses. */
  onScan: (files: File[]) => void;
  /** Add pages to an existing receipt — a two-page invoice is one receipt. */
  onAddPages: (receiptId: string, files: File[]) => void;
  onEditFields: (receiptId: string, patch: Parameters<typeof applyEdit>[1]) => void;
  /** THE ONLY expense-creating callback. Called from a tap, never automatically. */
  onCreateExpense: (receipt: Receipt, draft: ExpenseDraft) => void;
  onMarkNotExpense: (receipt: Receipt, reason?: string) => void;
  onReopen: (receipt: Receipt) => void;
  onDelete: (receipt: Receipt) => void;
  onRetryQueued: () => void;
  onOpenExpenses?: () => void;
}

const money = (n?: number): string =>
  typeof n === 'number' ? `$${n.toFixed(2)}` : '—';

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl';
const input = 'px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const label = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

const STATUS_CLASS: Record<ReceiptStatus, string> = {
  unreviewed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  linked: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  not_expense: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

/** A stored image, fetched on demand. Thumbnails keep the list cheap. */
const StoredImage: React.FC<{ path?: string; alt: string; className?: string }> = ({ path, alt, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null); setFailed(false);
    if (!path) return;
    receiptUrl(path).then(u => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path]);
  if (failed || !path) {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400`}>
        <FileText className="w-5 h-5" />
      </div>
    );
  }
  if (!url) {
    return <div className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800`}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />;
};

export const ReceiptsView: React.FC<Props> = ({
  me, receipts, queue, categories, expenses, canDelete, isOffline,
  onScan, onAddPages, onEditFields, onCreateExpense, onMarkNotExpense,
  onReopen, onDelete, onRetryQueued, onOpenExpenses,
}) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);

  // THE FILTER STARTS EMPTY — every status, newest first. Defaulting it to
  // anything that hides `unreviewed` would hide most of a working archive.
  const [q, setQ] = useState<ReceiptQuery>({});
  const [statuses, setStatuses] = useState<ReceiptStatus[]>([]);

  const results = useMemo(
    () => searchReceipts(receipts, { ...q, statuses }, toISODate),
    [receipts, q, statuses],
  );
  const pending = useMemo(() => pendingRows(queue), [queue]);
  const warning = useMemo(() => unsentWarning(queue), [queue]);
  const active = useMemo(() => receipts.find(r => r.id === open) || null, [receipts, open]);

  const pick = (ref: React.RefObject<HTMLInputElement>) => () => ref.current?.click();
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    // Reset so photographing the same receipt twice in a row still fires.
    e.target.value = '';
    if (files.length) onScan(files);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ReceiptIcon className="w-5 h-5 text-indigo-500" /> Receipts
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Photograph it and it is filed. Creating an expense from it is optional — nothing is posted to the books unless you tap to create it.
          </p>
        </div>
        {/* CAPTURE, and SEVERAL IN A ROW with no review step between them:
            backlog capture after a supplier trip is a named use case and a
            modal per receipt would not be tolerated. */}
        <div className="flex items-center gap-2">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={take} />
          <input ref={galleryRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={take} />
          <button onClick={pick(cameraRef)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
            <Camera className="w-4 h-4" /> Scan receipt
          </button>
          <button onClick={pick(galleryRef)}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <Images className="w-4 h-4" /> Upload
          </button>
        </div>
      </div>

      {/* SAVED ON THIS DEVICE IS NOT FILED, and says so for as long as it is
          true. One dropped phone is the whole risk this warns about. */}
      {warning && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <CloudOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-300 font-medium flex-1">{warning}</span>
          <button onClick={onRetryQueued} disabled={isOffline}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white">
            {isOffline ? 'Offline' : 'Try now'}
          </button>
        </div>
      )}

      {/* --- Search ------------------------------------------------------- */}
      <div className={`${card} p-4 space-y-3`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Search className="w-4 h-4 text-indigo-500" /> Find a receipt
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <label><span className={label}>From</span>
            <input type="date" className={`${input} w-full`} value={q.from || ''}
              onChange={e => setQ({ ...q, from: e.target.value || undefined })} /></label>
          <label><span className={label}>To</span>
            <input type="date" className={`${input} w-full`} value={q.to || ''}
              onChange={e => setQ({ ...q, to: e.target.value || undefined })} /></label>
          <label><span className={label}>Payee</span>
            <input className={`${input} w-full`} placeholder="Any" value={q.payee || ''}
              onChange={e => setQ({ ...q, payee: e.target.value || undefined })} /></label>
          <label><span className={label}>Min $</span>
            <input type="number" min={0} step="0.01" className={`${input} w-full`} value={q.minAmount ?? ''}
              onChange={e => setQ({ ...q, minAmount: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label><span className={label}>Max $</span>
            <input type="number" min={0} step="0.01" className={`${input} w-full`} value={q.maxAmount ?? ''}
              onChange={e => setQ({ ...q, maxAmount: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[180px]`} placeholder="Search the text read off the receipts"
            value={q.text || ''} onChange={e => setQ({ ...q, text: e.target.value || undefined })} />
          {/* No status selected = all of them. */}
          {RECEIPT_STATUSES.map(s => {
            const on = statuses.includes(s);
            return (
              <button key={s} onClick={() => setStatuses(on ? statuses.filter(x => x !== s) : [...statuses, s])}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${on
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {RECEIPT_STATUS_LABEL[s]}
              </button>
            );
          })}
          {(statuses.length > 0 || Object.values(q).some(v => v !== undefined && v !== '')) && (
            <button onClick={() => { setQ({}); setStatuses([]); }}
              className="text-xs text-slate-500 hover:text-indigo-600 underline">Clear</button>
          )}
        </div>
      </div>

      {/* --- The archive -------------------------------------------------- */}
      <div className={card}>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {results.length} receipt{results.length !== 1 ? 's' : ''}
            {pending.length > 0 && <span className="text-amber-600 dark:text-amber-400"> · {pending.length} not uploaded</span>}
          </span>
          <span className="text-[11px] text-slate-400">Newest first</span>
        </div>

        {pending.map(p => <PendingRow key={p.id} row={p} />)}

        {results.length === 0 && pending.length === 0 ? (
          <p className="text-sm text-slate-400 py-12 text-center">
            Nothing filed yet. Tap <span className="font-semibold">Scan receipt</span> — the photo is kept whether or not it ever becomes an expense.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {results.map(r => (
              <ReceiptRow key={r.id} receipt={r} categories={categories}
                expense={expenses.find(e => e.id === r.linkedExpenseId)}
                onOpen={() => setOpen(r.id === open ? null : r.id)}
                selected={r.id === open} />
            ))}
          </div>
        )}
      </div>

      {active && (
        <ReviewPanel
          receipt={active}
          categories={categories}
          canDelete={canDelete}
          expense={expenses.find(e => e.id === active.linkedExpenseId)}
          onClose={() => setOpen(null)}
          onAddPages={files => onAddPages(active.id, files)}
          onEditFields={patch => onEditFields(active.id, patch)}
          onCreateExpense={draft => { onCreateExpense(active, draft); }}
          onMarkNotExpense={reason => onMarkNotExpense(active, reason)}
          onReopen={() => onReopen(active)}
          onDelete={() => onDelete(active)}
          onOpenExpenses={onOpenExpenses}
        />
      )}
    </div>
  );
};

/* ---------------- One row ---------------- */

const PendingRow: React.FC<{ row: PendingReceiptRow }> = ({ row }) => (
  <div className="px-4 py-3 flex items-center gap-3 bg-amber-50/60 dark:bg-amber-900/10">
    <div className="w-12 h-12 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
      {row.state === 'uploading'
        ? <Loader2 className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-400" />
        : <CloudOff className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
    </div>
    <div className="min-w-0 flex-1">
      {/* The wording comes from domain/receiptQueue.ts's queueLabel, which is
          the ONLY place it is written — so no screen can say "Filed" while it
          means "on this device". */}
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{row.label}</p>
      <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
        {row.pages} page{row.pages !== 1 ? 's' : ''} · photographed {new Date(row.capturedAt).toLocaleString()}
      </p>
    </div>
  </div>
);

const ReceiptRow: React.FC<{
  receipt: Receipt;
  categories: ExpenseCategory[];
  expense?: Pick<Expense, 'id' | 'date' | 'amount' | 'category'>;
  selected: boolean;
  onOpen: () => void;
}> = ({ receipt, categories, expense, selected, onOpen }) => {
  const f = effectiveFields(receipt);
  const status = receiptStatus(receipt.status);
  const cat = categories.find(c => c.key === f.category);
  const unreadable = !!receipt.parsed && !f.total && !f.payee && !f.date;

  return (
    <button onClick={onOpen}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected ? 'bg-indigo-50/60 dark:bg-indigo-900/10' : ''}`}>
      <StoredImage path={receipt.pages?.[0]?.thumbPath || receipt.pages?.[0]?.path}
        alt="Receipt" className="w-12 h-12 rounded-lg object-cover shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {f.payee || 'Unnamed receipt'}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLASS[status]}`}>
            {RECEIPT_STATUS_LABEL[status]}
          </span>
          {receipt.pages?.length > 1 && (
            <span className="text-[10px] text-slate-400">{receipt.pages.length} pages</span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {f.date || `filed ${toISODate(receipt.uploadedAt)}`}
          {cat ? ` · ${cat.label}` : ''}
          {/* A parse that read nothing is stated plainly rather than shown as
              an error — the receipt is still filed, viewable and searchable. */}
          {unreadable ? ' · nothing could be read from the photo' : ''}
          {expense ? ` · expense ${money(expense.amount)}` : ''}
        </p>
      </div>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">{money(f.total)}</span>
    </button>
  );
};

/* ---------------- Review ---------------- */

/**
 * THE DRAFT, BESIDE THE PHOTO, EVERY FIELD EDITABLE.
 *
 * Correcting a parse has to be cheap — typing three fields next to the image,
 * never re-scanning. If the fastest correction were "photograph it again" the
 * design would be wrong.
 *
 * Edits go to `entered` through `applyEdit` and NEVER touch `parsed`, so the
 * original reading survives the correction and "was the parsing any good?"
 * stays answerable.
 */
const ReviewPanel: React.FC<{
  receipt: Receipt;
  categories: ExpenseCategory[];
  canDelete: boolean;
  expense?: Pick<Expense, 'id' | 'date' | 'amount' | 'category'>;
  onClose: () => void;
  onAddPages: (files: File[]) => void;
  onEditFields: (patch: Parameters<typeof applyEdit>[1]) => void;
  onCreateExpense: (draft: ExpenseDraft) => void;
  onMarkNotExpense: (reason?: string) => void;
  onReopen: () => void;
  onDelete: () => void;
  onOpenExpenses?: () => void;
}> = ({
  receipt, categories, canDelete, expense, onClose, onAddPages, onEditFields,
  onCreateExpense, onMarkNotExpense, onReopen, onDelete, onOpenExpenses,
}) => {
  const pagesRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');

  const live = categories.filter(c => !c.archived);
  const draft = draftFromReceipt(receipt, categories);
  const f = effectiveFields(receipt);
  const corrected = correctedFields(receipt);
  const status = receiptStatus(receipt.status);
  const pageCount = receipt.pages?.length || 0;
  const current = receipt.pages?.[Math.min(page, Math.max(0, pageCount - 1))];

  const set = (patch: Parameters<typeof applyEdit>[1]) => onEditFields(patch);

  return (
    <div className={`${card} p-4 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {status === 'linked' ? 'Filed · expense created' : status === 'not_expense' ? 'Filed · not an expense' : 'Filed'}
          </h3>
          <p className="text-[11px] text-slate-400">
            Photographed {new Date(receipt.uploadedAt).toLocaleString()} by {receipt.uploadedByEmail || receipt.uploadedBy}
          </p>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* The photo. */}
        <div className="space-y-2">
          <StoredImage path={current?.path} alt={`Receipt page ${page + 1}`}
            className="w-full max-h-[420px] object-contain rounded-xl bg-slate-50 dark:bg-slate-800" />
          <div className="flex items-center justify-between gap-2">
            {pageCount > 1 ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="p-1 disabled:opacity-30 hover:text-indigo-600"><ChevronLeft className="w-4 h-4" /></button>
                Page {page + 1} of {pageCount}
                <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                  className="p-1 disabled:opacity-30 hover:text-indigo-600"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ) : <span className="text-xs text-slate-400">Single page</span>}
            {/* A two-page supplier invoice is ONE receipt. */}
            <input ref={pagesRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onAddPages(files); }} />
            <button onClick={() => pagesRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">
              <Plus className="w-3.5 h-3.5" /> Add page
            </button>
          </div>
        </div>

        {/* The fields. */}
        <div className="space-y-3">
          {receipt.parsed?.failed && (
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
              The photo could not be read automatically ({receipt.parsed.failed}). It is still filed and searchable — fill anything in you need.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label><span className={label}>Date</span>
              <input type="date" className={`${input} w-full`} value={f.date || ''}
                onChange={e => set({ date: e.target.value })} /></label>
            <label><span className={label}>Total</span>
              <input type="number" min={0} step="0.01" className={`${input} w-full`} value={f.total ?? ''}
                onChange={e => set({ total: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            <label className="col-span-2"><span className={label}>Payee</span>
              <input className={`${input} w-full`} value={f.payee || ''}
                onChange={e => set({ payee: e.target.value })} /></label>
            <label><span className={label}>Tax</span>
              <input type="number" min={0} step="0.01" className={`${input} w-full`} value={f.tax ?? ''}
                onChange={e => set({ tax: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            <label><span className={label}>Category</span>
              {/* Only this workspace's own categories — a suggestion is clamped
                  to this list server-side and again in domain/receipt.ts. */}
              <select className={`${input} w-full`} value={clampCategory(f.category, categories) || ''}
                onChange={e => set({ category: e.target.value })}>
                <option value="">Choose…</option>
                {live.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select></label>
            <label className="col-span-2"><span className={label}>Note</span>
              <input className={`${input} w-full`} value={f.note || ''} placeholder="Optional"
                onChange={e => set({ note: e.target.value })} /></label>
          </div>

          {/* The original reading is kept and shown, not overwritten. */}
          {corrected.length > 0 && receipt.parsed && (
            <p className="text-[11px] text-slate-400">
              Corrected {corrected.join(', ')}. Originally read:{' '}
              {corrected.map(k => `${k} ${String((receipt.parsed as Record<string, unknown>)[k])}`).join(' · ')}
            </p>
          )}

          {status === 'linked' ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Expense created{expense ? ` — ${money(expense.amount)} on ${expense.date}` : ''}
              </span>
              {onOpenExpenses && (
                <button onClick={onOpenExpenses} className="text-xs text-indigo-600 hover:underline">Open expenses</button>
              )}
            </div>
          ) : status === 'not_expense' ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">
                Marked not an expense{receipt.notExpenseReason ? ` — ${receipt.notExpenseReason}` : ''}. The photo is kept.
              </span>
              <button onClick={onReopen} className="text-xs text-indigo-600 hover:underline">Undo</button>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              {/* THE ONLY CONTROL IN THE APP THAT CREATES AN EXPENSE FROM A
                  RECEIPT. Disabled until the draft is complete, because a
                  blank the owner has not looked at must never be filled with a
                  guess. */}
              <button onClick={() => onCreateExpense(draft)} disabled={!draft.complete}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
                <Check className="w-4 h-4" /> Create expense{draft.amount ? ` — ${money(draft.amount)}` : ''}
              </button>
              {!draft.complete && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Fill in {draft.missing.join(', ')} to create an expense. Or leave it filed — that is a perfectly good outcome.
                </p>
              )}
              {/* ONE TAP, and never phrased as deleting. */}
              {!reasonOpen ? (
                <button onClick={() => setReasonOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400">
                  <Ban className="w-4 h-4" /> Not an expense
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${input} flex-1 min-w-[140px]`} autoFocus value={reason}
                    placeholder="Why? (optional — personal, duplicate…)"
                    onChange={e => setReason(e.target.value)} />
                  <button onClick={() => { onMarkNotExpense(reason.trim() || undefined); setReasonOpen(false); setReason(''); }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-800 text-white">Mark it</button>
                  <button onClick={() => { setReasonOpen(false); setReason(''); }}
                    className="px-2 py-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                </div>
              )}
              <p className="text-[11px] text-slate-400">The photo is kept either way.</p>
            </div>
          )}
        </div>
      </div>

      {canDelete && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Deleting removes the photo for good. To say it is not a business cost, use “Not an expense” — that keeps it.
          </span>
          <button onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20">
            <Trash2 className="w-3.5 h-3.5" /> Delete receipt
          </button>
        </div>
      )}
    </div>
  );
};
