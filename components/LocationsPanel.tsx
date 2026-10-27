import React, { useMemo, useState } from 'react';
import {
  Store, Plus, Loader2, Check, AlertTriangle, Power, Star, Pencil, X,
} from 'lucide-react';
import { Location } from '../types';
import {
  DEFAULT_BACKFILL_COLLECTIONS, LOCATION_PROBLEM_MESSAGE, LOCATION_TAGGED_COLLECTIONS,
  LocationTaggedCollection, activeLocations, canDeactivate, checkLocation,
  deactivateLocation, defaultLocation, reactivateLocation, renameLocation,
  seedLocationFrom, setDefaultLocation,
} from '../domain/locations';
import {
  LocationBackfillProgress, backfillLocationIds, saveLocation,
} from '../services/firestoreDb';
import { newId } from '../domain/ids';

/**
 * THE SHOP'S STORES, AND THE ONE-OFF BACKFILL BEHIND THEM.
 *
 * Multi-store stage 1. Nothing else in the app shows or asks for a location
 * yet — this is the only screen that knows they exist, and it is owner-only.
 *
 * THE BACKFILL IS THE DANGEROUS PART and is treated as such: it is behind an
 * explicit action (never automatic on login or deploy), it reports per
 * collection what it scanned, wrote and skipped rather than showing a spinner,
 * and it writes an audit entry when it finishes. It only ever touches rows
 * with NO location.
 */

const input = 'px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export interface BackfillRunSummary {
  locationId: string;
  locationName: string;
  perCollection: Record<string, { scanned: number; written: number; skipped: number }>;
  totalWritten: number;
}

export const LocationsPanel: React.FC<{
  locations: Location[];
  /** settings.general — Brampton is seeded from it, so nothing is retyped. */
  general: { storeName?: string; address?: string };
  workspaceId?: string;
  currentUserId?: string;
  /** Writes the audit entry recording that the backfill ran. */
  onBackfillComplete?: (summary: BackfillRunSummary) => void;
}> = ({ locations, general, workspaceId, currentUserId, onBackfillComplete }) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [withExpenses, setWithExpenses] = useState(false);
  const [progress, setProgress] = useState<Record<string, { scanned: number; written: number; skipped: number }>>({});
  const [finished, setFinished] = useState(false);

  const list = useMemo(
    () => [...(locations || [])].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name)),
    [locations],
  );
  const target = defaultLocation(locations);

  const write = (l: Location) => {
    if (!workspaceId) return Promise.resolve();
    return saveLocation(workspaceId, l).catch(() => setError('That could not be saved. Try again.'));
  };

  const seed = async () => {
    setError(null);
    await write(seedLocationFrom(general, Date.now(), newId(), currentUserId));
  };

  const add = async () => {
    setError(null);
    const draft: Location = {
      id: newId(), name: name.trim(), active: true, createdAt: Date.now(),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(currentUserId ? { createdBy: currentUserId } : {}),
      // The first store ever added becomes the default; after that the owner
      // moves it deliberately.
      ...(list.length === 0 ? { isDefault: true } : {}),
    };
    const problem = checkLocation(draft, locations);
    if (problem) { setError(LOCATION_PROBLEM_MESSAGE[problem]); return; }
    await write(draft);
    setName(''); setAddress('');
  };

  const rename = async (l: Location) => {
    setError(null);
    const problem = checkLocation({ id: l.id, name: editName }, locations);
    if (problem) { setError(LOCATION_PROBLEM_MESSAGE[problem]); return; }
    await write(renameLocation(l, editName, Date.now()));
    setEditing(null);
  };

  const close = async (l: Location) => {
    setError(null);
    if (!canDeactivate(l, locations)) {
      setError('Make another store the default before closing this one.');
      return;
    }
    if (!window.confirm(
      `Close ${l.name}?\n\nIt stops appearing in pickers. Nothing is deleted — every device, sale, repair and shift that happened there stays exactly as it is, and still reads.`,
    )) return;
    await write(deactivateLocation(l, Date.now()));
  };

  const makeDefault = async (l: Location) => {
    setError(null);
    for (const changed of setDefaultLocation(locations, l.id, Date.now())) await write(changed);
  };

  /**
   * Walk every collection to completion, one page at a time.
   *
   * Loops on the cursor each call hands back rather than assuming one call is
   * enough, so a workspace with thousands of records finishes instead of
   * stopping silently part-way.
   */
  const runBackfill = async () => {
    if (!workspaceId || !target) return;
    const collections: LocationTaggedCollection[] = withExpenses
      ? [...LOCATION_TAGGED_COLLECTIONS]
      : DEFAULT_BACKFILL_COLLECTIONS;
    if (!window.confirm(
      `Assign ${collections.length} collections to ${target.name}?\n\n`
      + 'This rewrites every device, sale, repair, drop-off, settlement, shift and drawer record that does not already have a store.\n\n'
      + 'Rows that already have one are never touched. Make sure you have VERIFIED a backup restore first.',
    )) return;

    setRunning(true); setError(null); setFinished(false);
    const totals: Record<string, { scanned: number; written: number; skipped: number }> = {};
    try {
      for (const collection of collections) {
        let after: string | undefined;
        totals[collection] = { scanned: 0, written: 0, skipped: 0 };
        for (let page = 0; page < 200; page++) {
          const step: LocationBackfillProgress = await backfillLocationIds(
            workspaceId, target.id, { collection, after },
          );
          totals[collection].scanned += step.scanned;
          totals[collection].written += step.written;
          totals[collection].skipped += step.skipped;
          setProgress({ ...totals });
          if (step.done || !step.nextAfter) break;
          after = step.nextAfter;
        }
      }
      setFinished(true);
      onBackfillComplete?.({
        locationId: target.id,
        locationName: target.name,
        perCollection: totals,
        totalWritten: Object.values(totals).reduce((n, t) => n + t.written, 0),
      });
    } catch (e) {
      // Partial progress is reported rather than discarded: the run is
      // resumable, and the owner needs to know how far it got.
      setError(e instanceof Error ? e.message : 'The backfill could not finish. It is safe to run again — it resumes and never double-writes.');
    } finally {
      setRunning(false);
    }
  };

  const written = Object.values(progress).reduce((n, t) => n + t.written, 0);

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <Store className="w-4 h-4 text-indigo-500" /> Stores
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          One set of books, filterable by store. Nothing on any other screen asks for a store yet —
          this sets them up and assigns existing records. Receipts keep printing exactly what they print today.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            No stores set up yet. Start with the one you already have — the name and address come from
            Settings → General, so nothing is retyped.
          </p>
          <button onClick={seed} disabled={!workspaceId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            <Plus className="w-4 h-4" /> Add {(general.storeName || '').trim() || 'my store'}
          </button>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {list.map(l => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {editing === l.id ? (
                <>
                  <input autoFocus className={`${input} flex-1 min-w-[140px]`} value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void rename(l); if (e.key === 'Escape') setEditing(null); }} />
                  <button onClick={() => void rename(l)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">Save</button>
                  <button onClick={() => setEditing(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <span className={`text-sm font-medium ${l.active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 line-through'}`}>
                    {l.name}
                  </span>
                  {l.isDefault && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                      <Star className="w-3 h-3" /> default
                    </span>
                  )}
                  {!l.active && <span className="text-[10px] text-slate-400">closed · history intact</span>}
                  {l.address && <span className="text-[11px] text-slate-400 truncate">{l.address}</span>}
                  <span className="flex-1" />
                  <button onClick={() => { setEditing(l.id); setEditName(l.name); }} title="Rename"
                    className="p-1 text-slate-400 hover:text-indigo-600"><Pencil className="w-3.5 h-3.5" /></button>
                  {l.active && !l.isDefault && (
                    <button onClick={() => void makeDefault(l)} className="text-[11px] text-slate-500 hover:text-indigo-600 underline">Make default</button>
                  )}
                  {l.active ? (
                    <button onClick={() => void close(l)} title="Close this store"
                      className="p-1 text-slate-400 hover:text-amber-600"><Power className="w-3.5 h-3.5" /></button>
                  ) : (
                    <button onClick={() => void write(reactivateLocation(l, Date.now()))}
                      className="text-[11px] text-slate-500 hover:text-indigo-600 underline">Reopen</button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[130px]">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Store name</span>
            <input className={`${input} w-full`} placeholder="Mississauga" value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
          </label>
          <label className="flex-[2] min-w-[160px]">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Address (optional)</span>
            <input className={`${input} w-full`} value={address} onChange={e => setAddress(e.target.value)} />
          </label>
          <button onClick={() => void add()} disabled={!name.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            <Plus className="w-4 h-4" /> Add store
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {error}
        </p>
      )}

      {/* --- The backfill ------------------------------------------------- */}
      {target && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Assign existing records to {target.name}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Everything in this workspace predates the second store, so it all belongs to {target.name}.
            Run this once. It only touches records with no store — anything already assigned is left
            alone, and running it twice writes nothing.
          </p>
          {/* THE WARNING THAT MATTERS, and it is not decoration: this rewrites
              every record in the workspace and the restore has never been
              tested. */}
          <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-2">
            <strong>Verify a backup restore first.</strong> This is the largest single data change the
            app has made. Download a backup and confirm it restores into a scratch project before
            running this against live data.
          </p>
          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="mt-0.5" checked={withExpenses}
              onChange={e => setWithExpenses(e.target.checked)} />
            {/* Off by default, and the reason is stated rather than buried:
                nothing in a stored expense says whether it was a store cost or
                a company cost. */}
            <span>
              Also assign historical <strong>expenses</strong> to {target.name}. Off by default: parts
              orders, the app's own costs and your own pay are company costs, not {target.name}'s, and
              nothing in an old expense says which is which. Left off, they stay untagged and keep
              showing in the combined P&amp;L exactly as they do today.
            </span>
          </label>
          <button onClick={() => void runBackfill()} disabled={running || !workspaceId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 disabled:opacity-40">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {running ? 'Working…' : 'Assign existing records'}
          </button>

          {Object.keys(progress).length > 0 && (
            <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
              <p className="font-medium">
                {finished ? 'Finished.' : 'In progress…'} {written} record{written !== 1 ? 's' : ''} assigned.
              </p>
              {/* PER COLLECTION, so the owner can see it finished rather than
                  trusting a spinner. */}
              <ul className="font-mono">
                {Object.entries(progress).map(([c, t]) => (
                  <li key={c}>
                    {c}: {t.scanned} checked · {t.written} assigned · {t.skipped} already had one
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
