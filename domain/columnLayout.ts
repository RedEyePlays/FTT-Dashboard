// Independent column widths for the inventory table. Each column keeps its own
// width — resizing one column never changes another. The table simply grows as
// wide as the sum of its columns and scrolls horizontally inside its container
// (the page never gains a horizontal scrollbar). This module only clamps and
// sanitizes widths against each column's bounds.

export interface ColSpec {
  key: string;
  w: number;        // default width
  min?: number;     // minimum width (default 60)
  max?: number;     // maximum width (default 800)
  flex?: boolean;   // unused by the layout; kept for column metadata
}

const DEFAULT_MIN = 60;
const DEFAULT_MAX = 800;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const minOf = (c: ColSpec) => c.min ?? DEFAULT_MIN;
export const maxOf = (c: ColSpec) => c.max ?? DEFAULT_MAX;

// A single column's effective width: the stored override if valid, else the
// default — always clamped to the column's [min, max].
export const columnWidth = (c: ColSpec, stored?: Record<string, number>): number => {
  const raw = stored?.[c.key];
  const base = (typeof raw === 'number' && isFinite(raw) && raw > 0) ? raw : c.w;
  return Math.round(clamp(base, minOf(c), maxOf(c)));
};

// Clamp a proposed drag width to the column's bounds.
export const clampWidth = (c: ColSpec, w: number): number => Math.round(clamp(w, minOf(c), maxOf(c)));

// Drop invalid/stale stored widths and clamp the rest to each column's bounds so
// a saved layout can't produce absurd or broken columns.
export function sanitizeWidths(cols: ColSpec[], stored: Record<string, number> | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stored || typeof stored !== 'object') return out;
  const byKey = new Map(cols.map(c => [c.key, c]));
  for (const [key, raw] of Object.entries(stored)) {
    const c = byKey.get(key);
    if (!c) continue; // unknown column
    if (typeof raw !== 'number' || !isFinite(raw) || raw <= 0) continue;
    out[key] = Math.round(clamp(raw, minOf(c), maxOf(c)));
  }
  return out;
}

// Total table width = the fixed actions column plus every column's width.
export function tableWidth(cols: ColSpec[], actionsW: number, stored?: Record<string, number>): number {
  return actionsW + cols.reduce((s, c) => s + columnWidth(c, stored), 0);
}
