import React, { useMemo, useState } from 'react';
import { ArrowRight, X, AlertTriangle, Store, Truck } from 'lucide-react';
import { InventoryItem, Location } from '../types';
import { activeLocations, locationName } from '../domain/locations';
import { checkSend, TRANSFER_BLOCK_MESSAGE, canOverride } from '../domain/transfers';
import { getDeviceDisplayName } from '../domain/inventory';
import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * SENDING STOCK TO THE OTHER STORE — multi-store stage 4.
 *
 * Two things this dialog exists to make unmissable:
 *
 *  1. WHAT WILL NOT GO, AND WHY. A sold device, one already in a car, an
 *     accessory — each is listed with its reason rather than silently dropped
 *     from the batch, because a transfer that quietly sent four of five
 *     devices is how one goes missing without anybody noticing.
 *
 *  2. A RESERVED DEVICE HAS A DEPOSIT ON IT. It takes a deliberate tick, per
 *     device, and the override is recorded on the transfer. It is never the
 *     default and never bundled into "send everything".
 *
 * The dialog does NOT decide who may send — the caller offers only stores this
 * person may act at, and firestore.rules has the final say.
 */
export const TransferModal: React.FC<{
  items: InventoryItem[];
  /** Where the stock is now. */
  fromLocationId: string;
  /** Stores this person may send TO — never the one it is already at. */
  locations: Location[];
  destinations: Location[];
  onClose: () => void;
  onSend: (input: { toLocationId: string; items: InventoryItem[]; note?: string; overriddenIds: string[] }) => void | Promise<unknown>;
}> = ({ items, fromLocationId, locations, destinations, onClose, onSend }) => {
  useEscapeKey(onClose);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [overrides, setOverrides] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const check = useMemo(() => checkSend(items, { overrideReservedIds: overrides }), [items, overrides]);
  const reserved = useMemo(
    () => items.filter(i => canOverride(checkSend([i]).blocked[0]?.block ?? null)),
    [items],
  );
  const options = useMemo(
    () => activeLocations(destinations).filter(l => l.id !== fromLocationId),
    [destinations, fromLocationId],
  );

  const toggle = (id: string) =>
    setOverrides(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]));

  const submit = async () => {
    if (!to || check.sendable.length === 0 || busy) return;
    setBusy(true);
    try {
      await onSend({ toLocationId: to, items: check.sendable, note: note.trim() || undefined, overriddenIds: overrides.filter(id => check.sendable.some(i => i.id === id)) });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const inp = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100';
  const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Truck className="w-4 h-4 text-indigo-500" /> Send to another store
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Store className="w-4 h-4 text-slate-400" /> {locationName(locations, fromLocationId) || 'This store'}
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <span className="flex-1">
              <label className="sr-only" htmlFor="transfer-to">Destination store</label>
              <select id="transfer-to" aria-label="Destination store" value={to} onChange={e => setTo(e.target.value)} className={inp}>
                <option value="">Choose a store…</option>
                {options.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </span>
          </div>

          <div>
            <p className={lbl}>{check.sendable.length} device{check.sendable.length === 1 ? '' : 's'} going</p>
            {check.sendable.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing in this selection can be sent.</p>
            ) : (
              <ul className="text-sm text-slate-700 dark:text-slate-200 space-y-0.5 max-h-40 overflow-y-auto">
                {check.sendable.map(i => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="truncate">{getDeviceDisplayName(i)}</span>
                    <span className="text-xs text-slate-400 shrink-0">{i.sku}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* A DEPOSIT HAS BEEN PAID on each of these. Per-device, never a
              blanket "send anyway". */}
          {reserved.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Reserved for a layaway
              </p>
              <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 mt-0.5 mb-1.5">
                Somebody has paid a deposit on these. Tick one to send it anyway — the override is recorded on the transfer.
              </p>
              {reserved.map(i => (
                <label key={i.id} className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={overrides.includes(i.id)} onChange={() => toggle(i.id)} />
                  {getDeviceDisplayName(i)} <span className="text-xs text-amber-700/80">{i.sku}</span>
                </label>
              ))}
            </div>
          )}

          {/* NOT SILENTLY DROPPED. A batch that quietly sent four of five is
              how the fifth goes missing. */}
          {check.blocked.filter(b => !canOverride(b.block)).length > 0 && (
            <div>
              <p className={lbl}>Staying here</p>
              <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                {check.blocked.filter(b => !canOverride(b.block)).map(b => (
                  <li key={b.item.id}>
                    <span className="font-medium text-slate-600 dark:text-slate-300">{getDeviceDisplayName(b.item)}</span>
                    {' — '}{TRANSFER_BLOCK_MESSAGE[b.block]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className={lbl} htmlFor="transfer-note">Note (optional)</label>
            <input id="transfer-note" value={note} onChange={e => setNote(e.target.value)} className={inp}
              placeholder="Who is driving it over, anything to know" />
          </div>

          <p className="text-[11px] text-slate-400">
            These leave this store&apos;s shelf now and reach the other store&apos;s when somebody
            there confirms they arrived. Until then they are in transit and sellable at neither —
            and nothing about them changes but where they are.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={submit} disabled={!to || check.sendable.length === 0 || busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium">
            {busy ? 'Sending…' : `Send ${check.sendable.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
};
