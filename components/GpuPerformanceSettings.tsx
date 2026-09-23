import React, { useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  FPS_SOURCE_LABEL, GPU_GAMES, GPU_RESOLUTIONS, GpuPerformanceRow,
  PERFORMANCE_CAVEAT, gpusInTable, replaceGpuRows, rowsForGpu,
} from '../domain/gpuPerformance';
import { newId } from '../domain/ids';
import { todayISO } from '../domain/dates';
import { proposeGpuPerformance } from '../services/geminiService';
import { writeErrorMessage } from '../domain/writeErrors';

/**
 * THE PER-GPU FRAME-RATE TABLE — the shop's data, which the AI only proposes.
 *
 * NOTHING THE MODEL RETURNS IS SAVED BY THE CALL. A fill lands in a REVIEW
 * list: the owner reads it, edits anything that looks wrong, and presses save.
 * Only then does it reach settings, stamped with where it came from and when.
 *
 * ONE CARD AT A TIME, ON DEMAND. No bulk fill and no refresh-on-open — each
 * call costs money, and a table that quietly rewrites itself is a table
 * nobody can trust to still say what they approved.
 */

interface Props {
  rows: GpuPerformanceRow[];
  onChange: (rows: GpuPerformanceRow[]) => void;
}

interface Draft {
  gpuModel: string;
  rows: GpuPerformanceRow[];
  sources: string[];
}

const cell = 'px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-800 dark:text-slate-100';

export const GpuPerformanceSettings: React.FC<Props> = ({ rows, onChange }) => {
  const [gpuModel, setGpuModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const cards = gpusInTable(rows);

  const fill = async () => {
    const model = gpuModel.trim();
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const proposal = await proposeGpuPerformance(model);
      setDraft({
        gpuModel: proposal.gpuModel,
        sources: proposal.sources,
        rows: proposal.rows.map(r => ({
          id: newId(),
          gpuModel: proposal.gpuModel,
          game: r.game,
          resolution: r.resolution,
          preset: r.preset,
          fpsLow: r.fpsLow,
          fpsHigh: r.fpsHigh,
          source: 'ai' as const,
          checkedAt: todayISO(),
          sources: proposal.sources,
        })),
      });
    } catch (e) {
      setError(writeErrorMessage(e, 'Could not look up that card.'));
    } finally {
      setBusy(false);
    }
  };

  const patchDraft = (id: string, p: Partial<GpuPerformanceRow>) =>
    setDraft(d => (d ? { ...d, rows: d.rows.map(r => (r.id === id ? { ...r, ...p } : r)) } : d));

  const confirmDraft = () => {
    if (!draft) return;
    // Replacing the card's rows wholesale is what stops a second fill leaving
    // a mixture of two generations of figures with nothing to tell them apart.
    onChange(replaceGpuRows(rows, draft.gpuModel, draft.rows.map(r => ({ ...r, verified: true }))));
    setDraft(null);
    setGpuModel('');
  };

  const patchRow = (id: string, p: Partial<GpuPerformanceRow>) =>
    onChange(rows.map(r => (r.id === id ? { ...r, ...p } : r)));
  const removeRow = (id: string) => onChange(rows.filter(r => r.id !== id));
  const removeCard = (model: string) => {
    if (!window.confirm(`Remove every figure for ${model}?\n\nBuilds with that card will stop showing a performance section until it is filled in again.`)) return;
    onChange(replaceGpuRows(rows, model, []));
  };

  const addManualRow = (model: string) => onChange([...rows, {
    id: newId(), gpuModel: model, game: GPU_GAMES[0], resolution: GPU_RESOLUTIONS[0],
    preset: 'High', fpsLow: 60, fpsHigh: 90, source: 'manual', checkedAt: todayISO(), verified: true,
  }]);

  return (
    <div className="space-y-5">
      {/* Fill a card */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Add a graphics card</label>
        <div className="flex flex-wrap items-center gap-2">
          <input value={gpuModel} onChange={e => setGpuModel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) void fill(); }}
            placeholder="e.g. RTX 5060 Ti" className={`${cell} flex-1 min-w-[180px] py-2`} />
          <button onClick={() => void fill()} disabled={busy || !gpuModel.trim()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? 'Looking it up…' : 'Look up benchmarks'}
          </button>
          {gpuModel.trim() && !busy && (
            <button onClick={() => { addManualRow(gpuModel.trim()); setGpuModel(''); }}
              className="px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              Add by hand
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Searches published benchmarks and proposes a range per game. Nothing is saved until you have read it and pressed save.
        </p>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>

      {/* The review list */}
      {draft && (
        <div className="border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-900/10 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{draft.gpuModel} — check these before saving</h4>
            <button onClick={() => setDraft(null)} className="text-xs text-slate-500 hover:text-rose-600 underline">Discard</button>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            These go into adverts under the shop’s name. Anything you are not happy to stand behind, change or delete now.
          </p>
          <div className="space-y-1">
            {draft.rows.map(r => (
              <RowEditor key={r.id} row={r} onPatch={p => patchDraft(r.id, p)}
                onRemove={() => setDraft(d => (d ? { ...d, rows: d.rows.filter(x => x.id !== r.id) } : d))} />
            ))}
          </div>
          {draft.sources.length > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Sources: {draft.sources.join(' · ')}
            </p>
          )}
          <button onClick={confirmDraft}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
            <Check className="w-4 h-4" /> Save {draft.rows.length} figures for {draft.gpuModel}
          </button>
        </div>
      )}

      {/* The table itself */}
      {cards.length === 0 && !draft && (
        <p className="text-sm text-slate-400">
          No cards yet. A build whose graphics card is not in this table simply shows no performance section — it never guesses.
        </p>
      )}

      {cards.map(model => (
        <div key={model} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{model}</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => addManualRow(model)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
                <Plus className="w-3.5 h-3.5" /> Row
              </button>
              <button onClick={() => removeCard(model)} className="text-xs text-slate-400 hover:text-rose-600">Remove card</button>
            </div>
          </div>
          <div className="space-y-1">
            {rowsForGpu(rows, model).map(r => (
              <RowEditor key={r.id} row={r} onPatch={p => patchRow(r.id, p)} onRemove={() => removeRow(r.id)} showSource />
            ))}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-slate-400">{PERFORMANCE_CAVEAT}</p>
    </div>
  );
};

const RowEditor: React.FC<{
  row: GpuPerformanceRow;
  onPatch: (p: Partial<GpuPerformanceRow>) => void;
  onRemove: () => void;
  showSource?: boolean;
}> = ({ row, onPatch, onRemove, showSource }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <select value={row.game} onChange={e => onPatch({ game: e.target.value })} className={`${cell} w-44`} aria-label="Game">
      {GPU_GAMES.map(g => <option key={g} value={g}>{g}</option>)}
      {!(GPU_GAMES as readonly string[]).includes(row.game) && <option value={row.game}>{row.game}</option>}
    </select>
    <select value={row.resolution} onChange={e => onPatch({ resolution: e.target.value })} className={`${cell} w-24`} aria-label="Resolution">
      {GPU_RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
      {!(GPU_RESOLUTIONS as readonly string[]).includes(row.resolution) && <option value={row.resolution}>{row.resolution}</option>}
    </select>
    <input value={row.preset} onChange={e => onPatch({ preset: e.target.value })}
      placeholder="Preset" className={`${cell} w-32`} aria-label="Preset" />
    <input type="number" min="1" value={row.fpsLow} onChange={e => onPatch({ fpsLow: Math.max(0, parseInt(e.target.value, 10) || 0) })}
      className={`${cell} w-20`} aria-label="Lowest fps" />
    <span className="text-slate-400 text-sm">–</span>
    <input type="number" min="1" value={row.fpsHigh} onChange={e => onPatch({ fpsHigh: Math.max(0, parseInt(e.target.value, 10) || 0) })}
      className={`${cell} w-20`} aria-label="Highest fps" />
    <span className="text-[11px] text-slate-400">fps</span>
    {showSource && (
      <button onClick={() => onPatch({ verified: !row.verified, checkedAt: todayISO() })}
        title={row.verified ? 'Checked by the shop' : 'Not checked yet — click when you have read it'}
        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${row.verified
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
        {row.verified ? 'Verified' : 'Unchecked'}
      </button>
    )}
    {showSource && <span className="text-[10px] text-slate-400">{FPS_SOURCE_LABEL[row.source]}</span>}
    <button onClick={onRemove} aria-label="Delete row" className="p-1 text-slate-400 hover:text-rose-600">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  </div>
);
