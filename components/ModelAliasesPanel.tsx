import React, { useState } from 'react';
import { Plus, Trash2, Loader2, Check, AlertTriangle, Tags } from 'lucide-react';
import { ModelAlias } from '../domain/modelAliases';
import { ReindexProgress, reindexModelKeys } from '../services/firestoreDb';

/**
 * THE OWNER'S OWN SHORTHAND, and the one-off re-index behind it.
 *
 * "how many 15pm in stock" used to get a shrug: "15pm" appears nowhere in the
 * data, and even with the right words the assistant read a capped sample and
 * could only give examples. Both halves are fixed elsewhere; this is where the
 * owner tells it HIS words, because they change with every phone generation
 * and hardcoding them would mean a code change each September.
 *
 * The re-index is here rather than run automatically because it is a write
 * over every device row. It is resumable and idempotent, and it reports rows
 * it could not key rather than quietly counting them as done — see
 * services/firestoreDb.ts's reindexModelKeys.
 */

const input = 'px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const ModelAliasesPanel: React.FC<{
  value: ModelAlias[];
  onChange: (next: ModelAlias[]) => void;
  canManage: boolean;
  workspaceId?: string;
}> = ({ value, onChange, canManage, workspaceId }) => {
  const [alias, setAlias] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ReindexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = value || [];

  const add = () => {
    const a = alias.trim().toLowerCase();
    const m = model.trim();
    // Two characters minimum: a one-letter alias would match half the shop.
    if (a.length < 2 || !m) return;
    onChange([...list.filter(x => x.alias.toLowerCase() !== a), { alias: a, model: m }]);
    setAlias(''); setModel('');
  };

  const remove = (a: string) => onChange(list.filter(x => x.alias !== a));

  /**
   * Walk the whole collection in pages until it reports done.
   *
   * Loops on the cursor the service hands back rather than assuming one call
   * is enough, so a shop with thousands of devices finishes instead of
   * stopping silently part-way.
   */
  const reindex = async () => {
    if (!workspaceId) return;
    setBusy(true); setError(null); setProgress(null);
    const total: ReindexProgress = { scanned: 0, written: 0, unkeyable: 0, done: false };
    try {
      let after: string | undefined;
      for (let page = 0; page < 50; page++) {
        const step = await reindexModelKeys(workspaceId, { after });
        total.scanned += step.scanned;
        total.written += step.written;
        total.unkeyable += step.unkeyable;
        setProgress({ ...total, done: step.done });
        if (step.done) { total.done = true; break; }
        after = step.nextAfter;
        if (!after) { total.done = true; break; }
      }
      setProgress({ ...total });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The re-index could not finish.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <Tags className="w-4 h-4 text-indigo-500" /> Your shorthand for models
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Type what you actually say. The assistant understands these when you ask things like
          “how many 15pm in stock”. Adding one never changes a question that already worked — it only
          gives the assistant another way to recognise a model.
        </p>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map(a => (
            <span key={a.alias}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-mono font-semibold">{a.alias}</span>
              <span className="text-slate-400">→</span>
              <span>{a.model}</span>
              {canManage && (
                <button onClick={() => remove(a.alias)} title={`Remove ${a.alias}`}
                  className="p-0.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-3 h-3" /></button>
              )}
            </span>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[110px]">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">You say</span>
            <input className={`${input} w-full font-mono`} placeholder="15pm" value={alias}
              onChange={e => setAlias(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          </label>
          <label className="flex-[2] min-w-[160px]">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">It means</span>
            <input className={`${input} w-full`} placeholder="iPhone 15 Pro Max" value={model}
              onChange={e => setModel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          </label>
          <button onClick={add} disabled={alias.trim().length < 2 || !model.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      )}

      {/* The one-off migration. Named for what it does FOR the owner, not for
          the field it writes. */}
      {canManage && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Re-index stock for counting</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Devices added from now on are indexed automatically. Run this once so older stock is
                counted too — until then the assistant says how many devices it could not include.
              </p>
            </div>
            <button onClick={reindex} disabled={busy || !workspaceId}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 disabled:opacity-40 shrink-0">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {busy ? 'Working…' : 'Re-index now'}
            </button>
          </div>
          {progress && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {progress.done ? 'Finished: ' : 'In progress: '}
              checked {progress.scanned} device{progress.scanned !== 1 ? 's' : ''}, indexed {progress.written}.
              {/* Reported rather than hidden: a row with no model and no name
                  cannot be keyed, and pretending otherwise would make the
                  count look complete when it is not. */}
              {progress.unkeyable > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}{progress.unkeyable} had no model or name to index — those stay uncounted until you fill one in.
                </span>
              )}
            </p>
          )}
          {error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
