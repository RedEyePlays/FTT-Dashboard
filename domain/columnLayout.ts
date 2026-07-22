// Bounded independent column widths for the inventory table.
//
// The table always stays WITHIN its visible container — it never scrolls
// horizontally and no column is pushed off-screen. Each column keeps its own
// width (resizing one column never shrinks a neighbour), but growth is bounded:
// a column can only widen into whatever container width is currently unused.
// Any remaining space is a trailing "spacer" so the table visually fills the
// container. When the columns' natural widths exceed the container (a narrow
// viewport, or stale over-wide saved widths), they are shrunk proportionally —
// never below their per-column minimum — so the whole table still fits.

export interface ColSpec {
  key: string;
  w: number;        // default width
  min?: number;     // minimum width (default 48)
  max?: number;     // maximum width (default 640)
  flex?: boolean;   // column metadata only; the layout treats all columns alike
}

const DEFAULT_MIN = 48;
const DEFAULT_MAX = 640;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const minOf = (c: ColSpec) => c.min ?? DEFAULT_MIN;
export const maxOf = (c: ColSpec) => c.max ?? DEFAULT_MAX;

// A single column's requested width: the stored override if valid, else the
// default — always clamped to the column's own [min, max].
export const columnWidth = (c: ColSpec, stored?: Record<string, number>): number => {
  const raw = stored?.[c.key];
  const base = (typeof raw === 'number' && isFinite(raw) && raw > 0) ? raw : c.w;
  return Math.round(clamp(base, minOf(c), maxOf(c)));
};

// Clamp a proposed drag width to the column's own bounds (the container-fit cap
// is applied separately by the caller, which knows the available slack).
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

export interface FitResult {
  widths: Record<string, number>; // fitted width per column key
  spacer: number;                 // trailing filler width (0 when columns fill/overflow)
  total: number;                  // actionsW + Σ fitted widths (≤ containerW unless mins alone overflow)
}

// Fit the columns into `containerW`:
//  • Start from each column's requested width (stored-or-default, clamped).
//  • If they fit, keep them and expose the leftover as `spacer`.
//  • If they don't, shrink proportionally toward each column's min until the
//    table fits (or every column is at its min — the hard floor).
// This is what keeps the table inside its container and clamps stale saved
// widths that are now too wide; it never grows a column beyond its request.
export function fitWidths(
  cols: ColSpec[],
  actionsW: number,
  containerW: number,
  stored?: Record<string, number>,
): FitResult {
  const widths: Record<string, number> = {};
  for (const c of cols) widths[c.key] = columnWidth(c, stored);

  const sum = cols.reduce((s, c) => s + widths[c.key], 0);
  const avail = Math.max(0, containerW - actionsW);

  // Not measured yet, or everything fits: keep requested widths, expose slack.
  if (!containerW || sum <= avail) {
    const total = actionsW + sum;
    return { widths, spacer: Math.max(0, Math.round(containerW - total)), total };
  }

  // Overflow: shrink columns that are above their min, proportionally to how much
  // room each can give, until the total fits (or all are at their minimum).
  const overflow = sum - avail;
  const room = cols.reduce((s, c) => s + (widths[c.key] - minOf(c)), 0);
  if (room > 0) {
    for (const c of cols) {
      const give = widths[c.key] - minOf(c);
      if (give <= 0) continue;
      const cut = Math.min(give, Math.round(overflow * (give / room)));
      widths[c.key] -= cut;
    }
    // Rounding can leave a small remainder — trim it from the widest shrinkable
    // columns one pixel at a time so the fit is exact.
    let rem = actionsW + cols.reduce((s, c) => s + widths[c.key], 0) - containerW;
    while (rem > 0) {
      const c = cols.filter(x => widths[x.key] > minOf(x)).sort((a, b) => widths[b.key] - widths[a.key])[0];
      if (!c) break;
      widths[c.key] -= 1;
      rem -= 1;
    }
  }
  const total = actionsW + cols.reduce((s, c) => s + widths[c.key], 0);
  return { widths, spacer: Math.max(0, Math.round(containerW - total)), total };
}
