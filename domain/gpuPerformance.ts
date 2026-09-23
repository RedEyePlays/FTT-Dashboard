import { PcBuild } from '../types';

/**
 * WHAT A MACHINE ACTUALLY RUNS AT.
 *
 * "Will it run Warzone?" is the question every PC buyer asks, and the shop had
 * no answer that was the same twice. This module holds the answer: ONE table,
 * per GPU, reviewed by a human, reused by every build with that card.
 *
 * WHY A TABLE AND NOT A GENERATED SENTENCE PER ADVERT. An fps figure is a
 * performance claim. A model asked for one fresh on each listing produces
 * confident, differing numbers for the same card — and two of the shop's own
 * ads quoting different fps for an RTX 5060 Ti is exactly the screenshot a
 * buyer sends back. The AI fills the table once (functions/src/ai/gpuPolicy.ts);
 * the owner edits and confirms it; every build reads it.
 *
 * ESTIMATED vs TESTED. A figure from the table is an ESTIMATE from published
 * benchmarks and is always labelled as one. A figure the shop measured on the
 * bench REPLACES it for that build only, and is labelled "tested in-shop" —
 * which is a much stronger thing to be able to say, and is true.
 *
 * Pure: no DOM, no Firestore.
 */

/** The six, fixed. Mirrors functions/src/ai/gpuPolicy.ts's GPU_GAMES. */
export const GPU_GAMES = [
  'Fortnite',
  'Valorant',
  'CS2',
  'Warzone',
  // Vanilla Minecraft runs at several hundred frames on any modern card, so an
  // unqualified figure for it would be meaningless in an advert.
  'Minecraft (with shaders)',
  'Cyberpunk 2077',
] as const;

export type GpuGame = typeof GPU_GAMES[number];

export const GPU_RESOLUTIONS = ['1080p', '1440p'] as const;
export type GpuResolution = typeof GPU_RESOLUTIONS[number];

/** Where a row's numbers came from. Shown, never hidden. */
export type FpsSource = 'ai' | 'measured' | 'manual';

export const FPS_SOURCE_LABEL: Record<FpsSource, string> = {
  ai: 'From published benchmarks',
  measured: 'Tested in-shop',
  manual: 'Set by the shop',
};

export interface GpuPerformanceRow {
  id: string;
  /** The card, as the shop writes it: "RTX 5060 Ti". */
  gpuModel: string;
  game: string;
  resolution: string;
  /** "High", "Competitive", "Ultra, ray tracing off". Free text. */
  preset: string;
  fpsLow: number;
  fpsHigh: number;
  source: FpsSource;
  /** When the figure was last confirmed, YYYY-MM-DD. */
  checkedAt?: string;
  note?: string;
  /** Where the numbers came from, kept so the owner can check them later. */
  sources?: string[];
  /** Ticked by a human who has looked at it. */
  verified?: boolean;
}

/**
 * ONE MEASUREMENT, ON ONE MACHINE.
 *
 * Stored on the BUILD, never in the table: it is a fact about this computer,
 * not about the model of card. Measuring an RTX 5060 Ti in one build must not
 * silently restate the estimate every other build with that card is quoting.
 */
export interface MeasuredFps {
  id: string;
  game: string;
  resolution: string;
  preset: string;
  fps: number;
  /** Who put the number in — an fps figure is a claim, so it has an author. */
  measuredBy: string;
  measuredByEmail?: string;
  measuredAt: number;
}

const round = (n: number): number => Math.round(n);

/* ---------------- Reading the table ---------------- */

/** Loose match: "RTX 5060 Ti" against "Gigabyte RTX 5060 Ti Windforce OC". */
export const gpuMatches = (tableModel: string, buildPart: string): boolean => {
  const a = normalizeGpu(tableModel), b = normalizeGpu(buildPart);
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
};

/**
 * Strip the things that differ between two names for the same card: the board
 * partner, the cooler, the memory size and the marketing words. What is left
 * is the bit that decides performance.
 */
export const normalizeGpu = (name: string): string =>
  (name || '')
    .toLowerCase()
    .replace(/\b(gigabyte|asus|msi|zotac|evga|sapphire|xfx|powercolor|pny|inno3d|palit|gainward)\b/g, '')
    .replace(/\b(windforce|gaming|oc|ventus|tuf|rog|strix|eagle|aero|trinity|twin|dual|edition|founders|fe)\b/g, '')
    .replace(/\b\d+\s*gb\b/g, '')
    .replace(/\b(gddr\d x?|graphics card|gpu)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The GPU part on a build, or null when there isn't one yet. */
export const buildGpu = (build: Pick<PcBuild, 'parts'>): string | null => {
  const gpu = (build.parts || []).find(p => p.category === 'GPU' && (p.name || '').trim());
  return gpu ? gpu.name.trim() : null;
};

export interface PerformanceLine {
  game: string;
  resolution: string;
  preset: string;
  fpsLow: number;
  fpsHigh: number;
  /** True when the shop measured it on this machine. */
  measured: boolean;
  /** The author of a measured figure, for the build screen. */
  measuredBy?: string;
}

/**
 * What to show for ONE build: the table's estimates for its card, with any
 * figure the shop measured on this machine replacing the matching row.
 *
 * A MEASURED FIGURE IS ONE NUMBER, and a single number is not a range — so it
 * is presented as a range of itself (low = high = the measurement) and labelled
 * "tested in-shop". That keeps every figure on the screen the same shape and
 * stops a bare number sitting among ranges looking like a promise.
 *
 * A build whose GPU has no rows returns [] — the section is then omitted
 * everywhere, rather than improvised.
 */
export const performanceFor = (
  build: Pick<PcBuild, 'parts' | 'measuredFps'>,
  table: GpuPerformanceRow[],
): PerformanceLine[] => {
  const gpu = buildGpu(build);
  const lines: PerformanceLine[] = [];

  if (gpu) {
    for (const row of table || []) {
      if (!gpuMatches(row.gpuModel, gpu)) continue;
      if (!(row.fpsHigh > 0) || !(row.fpsLow > 0)) continue;
      // The owner's own ordering in Settings is what the page reads.
      if (lines.some(l => l.game === row.game && l.resolution === row.resolution)) continue;
      lines.push({
        game: row.game,
        resolution: row.resolution,
        preset: row.preset,
        fpsLow: round(Math.min(row.fpsLow, row.fpsHigh)),
        fpsHigh: round(Math.max(row.fpsLow, row.fpsHigh)),
        measured: false,
      });
    }
  }

  for (const m of build.measuredFps || []) {
    if (!(m.fps > 0)) continue;
    const at = lines.findIndex(l => l.game === m.game && l.resolution === m.resolution);
    const line: PerformanceLine = {
      game: m.game,
      resolution: m.resolution,
      preset: m.preset,
      fpsLow: round(m.fps),
      fpsHigh: round(m.fps),
      measured: true,
      ...(m.measuredByEmail ? { measuredBy: m.measuredByEmail } : {}),
    };
    // A measurement REPLACES the estimate for this build. It is also shown when
    // the table has nothing for that game at all — the shop tested it, so it
    // can say so whether or not anybody published a benchmark.
    if (at >= 0) lines[at] = line; else lines.push(line);
  }

  return lines;
};

/** "120–160 fps", or "142 fps" for a measurement. */
export const fpsLabel = (line: Pick<PerformanceLine, 'fpsLow' | 'fpsHigh'>): string =>
  line.fpsLow === line.fpsHigh ? `${line.fpsLow} fps` : `${line.fpsLow}–${line.fpsHigh} fps`;

/** The line that sits under every performance block, everywhere it appears. */
export const PERFORMANCE_CAVEAT =
  'Estimates based on published benchmarks; actual performance varies with settings and game updates.';

export const MEASURED_LABEL = 'tested in-shop';

/* ---------------- Editing the table ---------------- */

/** Rows for one card, in the owner's order. */
export const rowsForGpu = (table: GpuPerformanceRow[], gpuModel: string): GpuPerformanceRow[] =>
  (table || []).filter(r => normalizeGpu(r.gpuModel) === normalizeGpu(gpuModel));

/** Every card the table knows about, first-seen order. */
export const gpusInTable = (table: GpuPerformanceRow[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of table || []) {
    const key = normalizeGpu(r.gpuModel);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r.gpuModel.trim());
  }
  return out;
};

/**
 * Replace every row for one card with a reviewed set.
 *
 * Used when the owner confirms a proposal: the card's old rows go and the
 * confirmed ones take their place, so a second fill cannot leave a mixture of
 * two generations of figures with no way to tell them apart.
 */
export const replaceGpuRows = (
  table: GpuPerformanceRow[],
  gpuModel: string,
  rows: GpuPerformanceRow[],
): GpuPerformanceRow[] => [
  ...(table || []).filter(r => normalizeGpu(r.gpuModel) !== normalizeGpu(gpuModel)),
  ...rows,
];
