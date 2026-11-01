import React from 'react';
import { ArrowRight, AlertTriangle, Check, Ban, Truck } from 'lucide-react';
import { AppUser, InventoryItem, InventoryTransfer, Location } from '../types';
import { locationName } from '../domain/locations';
import {
  canCancel, canReceive, daysInTransit, isStaleTransfer, inTransitTransfers,
  TRANSFER_STALE_DAYS,
} from '../domain/transfers';
import { getDeviceDisplayName } from '../domain/inventory';

/**
 * WHAT IS CURRENTLY IN A CAR — multi-store stage 4.
 *
 * In transit is where things get lost, and a device nobody is looking at is a
 * device nobody chases. So this list is visible to BOTH stores and the owner,
 * whichever end they work at, and a transfer unreceived for
 * TRANSFER_STALE_DAYS is flagged rather than left to rot the way 44 devices
 * are currently rotting in repair.
 *
 * RECEIVING IS NOT A FORMALITY. The button appears only for somebody at the
 * DESTINATION who did not send it (domain/transfers.ts's canReceive) — for
 * everybody else the row says who it is waiting on. Nothing auto-receives.
 */
export const InTransitPanel: React.FC<{
  transfers: InventoryTransfer[];
  inventory: InventoryItem[];
  locations: Location[];
  me?: AppUser | null;
  now: number;
  onReceive: (transfer: InventoryTransfer) => void;
  onCancel: (transfer: InventoryTransfer) => void;
}> = ({ transfers, inventory, locations, me, now, onReceive, onCancel }) => {
  const live = inTransitTransfers(transfers);
  const byId = new Map(inventory.map(i => [i.id, i]));
  const store = (id: string) => locationName(locations, id) || id;

  if (live.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 text-sm text-slate-400 flex items-center gap-2">
        <Truck className="w-4 h-4" /> Nothing is in transit between stores.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {live.map(t => {
        const stale = isStaleTransfer(t, now);
        const days = daysInTransit(t, now);
        const items = t.itemIds.map(id => byId.get(id)).filter(Boolean) as InventoryItem[];
        const mayReceive = canReceive(me || undefined, locations, t);
        const mayCancel = canCancel(me || undefined, t);
        return (
          <div key={t.id}
            className={`rounded-xl border p-4 ${stale
              ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                {store(t.fromLocationId)} <ArrowRight className="w-4 h-4 text-slate-400" /> {store(t.toLocationId)}
                <span className="text-xs font-normal text-slate-400">
                  {items.length || t.itemIds.length} device{(items.length || t.itemIds.length) === 1 ? '' : 's'}
                  {' · '}{days === 0 ? 'sent today' : days === 1 ? 'sent yesterday' : `sent ${days} days ago`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {mayReceive && (
                  <button onClick={() => onReceive(t)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Confirm arrived
                  </button>
                )}
                {mayCancel && (
                  <button onClick={() => onCancel(t)}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5">
                    <Ban className="w-3.5 h-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>

            {/* UNRECEIVED FOR TOO LONG. The shortest threshold in the app,
                because in transit is the one state with nobody responsible. */}
            {stale && (
              <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                Not confirmed after {days} days (over {TRANSFER_STALE_DAYS}) — check it actually arrived at {store(t.toLocationId)}.
              </p>
            )}

            <ul className="mt-2 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
              {items.map(i => (
                <li key={i.id} className="flex items-center gap-2">
                  <span className="truncate">{getDeviceDisplayName(i)}</span>
                  <span className="text-slate-400 shrink-0">{i.sku}</span>
                  {t.reservedOverrides?.includes(i.id) && (
                    <span className="text-[10px] font-semibold px-1.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">layaway override</span>
                  )}
                </li>
              ))}
              {/* A device id with no record is worth seeing rather than
                  silently skipping — it means the device was deleted while in
                  transit, which somebody should know. */}
              {t.itemIds.filter(id => !byId.has(id)).map(id => (
                <li key={id} className="text-rose-500">Device no longer in inventory ({id.slice(0, 8)})</li>
              ))}
            </ul>

            <p className="mt-2 text-[11px] text-slate-400">
              Sent by {t.sentByEmail || t.sentBy}
              {t.note ? ` · ${t.note}` : ''}
              {!mayReceive && ` · waiting on ${store(t.toLocationId)} to confirm`}
            </p>
          </div>
        );
      })}
    </div>
  );
};
