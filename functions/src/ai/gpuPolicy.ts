import { JsonSchema } from "./types";

/**
 * EXPECTED GAME PERFORMANCE FOR ONE GRAPHICS CARD.
 *
 * An fps figure in an advert is a PERFORMANCE CLAIM, so this op is shaped
 * around not making one carelessly:
 *
 *   • it runs ONCE PER CARD, not once per listing — two of the shop's own ads
 *     quoting different fps for the same GPU is the screenshot a buyer sends
 *     back, and asking a model fresh each time guarantees exactly that;
 *   • it answers in RANGES, never a single number, because a frame rate is a
 *     range: settings, drivers, the CPU beside it and the next game patch all
 *     move it;
 *   • it uses WEB SEARCH, so the numbers come from published benchmarks rather
 *     than recall, and the sources come back with them;
 *   • NOTHING IT RETURNS IS SAVED. These are proposals for a human to edit and
 *     confirm (domain/gpuPerformance.ts).
 *
 * Pure: no Firebase, no provider, no network.
 *
 * The game list and the resolutions mirror domain/gpuPerformance.ts. Two
 * definitions, as with showroomPolicy.ts and listingPolicy.ts: functions/ and
 * the app are separate TypeScript projects, and the validator has to run where
 * the retry is.
 */

/**
 * The six, fixed. A shop that benchmarks whatever it fancies ends up with a
 * table nobody can compare two machines with.
 *
 * MINECRAFT IS QUALIFIED ON PURPOSE. Vanilla Minecraft runs at several hundred
 * frames on anything with a fan, so a number for it would be meaningless and
 * faintly dishonest in an advert. Shaders is what a buyer asking about
 * Minecraft actually means.
 */
export const GPU_GAMES = [
  "Fortnite",
  "Valorant",
  "CS2",
  "Warzone",
  "Minecraft (with shaders)",
  "Cyberpunk 2077",
] as const;

export const GPU_RESOLUTIONS = ["1080p", "1440p"] as const;

/**
 * Bounds a claim has to sit inside to be believable.
 *
 * Not a judgement about any particular card — it is a sanity check on the
 * ANSWER. A 0 means the model did not know and said so numerically; a 4000
 * means it has confused an fps figure with something else. Either way the row
 * is worthless and must not reach a review screen looking like data.
 */
export const MIN_PLAUSIBLE_FPS = 5;
export const MAX_PLAUSIBLE_FPS = 1000;

export interface GpuPerformanceRow {
  game: string;
  resolution: string;
  preset: string;
  fpsLow: number;
  fpsHigh: number;
}

export interface GpuPerformanceProposal {
  gpuModel: string;
  rows: GpuPerformanceRow[];
  /** Where the numbers came from, stored with them so they can be checked. */
  sources: string[];
}

export const GPU_PERFORMANCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      description:
        `One row per game per resolution — ${GPU_GAMES.length} games × ${GPU_RESOLUTIONS.length} resolutions.`,
      items: {
        type: "object",
        properties: {
          game: { type: "string", description: `Exactly one of: ${GPU_GAMES.join("; ")}` },
          resolution: { type: "string", description: "Either '1080p' or '1440p'." },
          preset: { type: "string", description: "The settings preset the figures are for, e.g. 'High', 'Competitive', 'Ray tracing off'." },
          fpsLow: { type: "number", description: "The low end of the typical range. Never a single-number estimate." },
          fpsHigh: { type: "number", description: "The high end of the typical range. Must be greater than fpsLow." },
        },
        required: ["game", "resolution", "preset", "fpsLow", "fpsHigh"],
        additionalProperties: false,
      },
    },
    sources: {
      type: "array",
      description: "The benchmark sources used, as URLs or publication names.",
      items: { type: "string" },
    },
  },
  required: ["rows", "sources"],
  additionalProperties: false,
};

export const gpuPerformanceSystemPrompt = (): string => [
  "You research published gaming benchmarks for PC graphics cards.",
  "",
  "You are given ONE graphics card. Search for recent published benchmarks and report the typical",
  "frame rates a buyer should expect, as RANGES.",
  "",
  "RULES:",
  `1. Cover exactly these games: ${GPU_GAMES.join("; ")}.`,
  `2. Cover both resolutions for each: ${GPU_RESOLUTIONS.join(" and ")}. That is ${GPU_GAMES.length * GPU_RESOLUTIONS.length} rows.`,
  "3. Every figure is a RANGE — fpsLow and fpsHigh, with fpsHigh greater than fpsLow. Never report a",
  "   single number, and never make the range artificially narrow to look precise.",
  "4. Name the settings preset each range is for. Be specific: 'High', 'Competitive/Low', 'Ultra, ray tracing off'.",
  "5. Minecraft means Minecraft WITH SHADERS. Vanilla runs at several hundred frames on any modern card",
  "   and a figure for it would mislead a buyer.",
  "6. These figures assume a reasonable CPU pairing. Do not assume an unusually fast or slow one.",
  "7. If the published benchmarks disagree, widen the range rather than picking a side.",
  "8. List the sources you actually used. Do not invent a source.",
].join("\n");

export const gpuPerformanceUserPrompt = (gpuModel: string): string =>
  `Graphics card: ${gpuModel}\n\nReport the expected frame-rate ranges.`;

export type GpuValidation =
  | { ok: true; value: GpuPerformanceProposal }
  | { ok: false; reason: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Match a game name loosely — "Minecraft" for "Minecraft (with shaders)". */
const canonicalGame = (name: string): string | undefined => {
  const n = name.toLowerCase();
  return GPU_GAMES.find((g) => {
    const gl = g.toLowerCase();
    return gl === n || gl.startsWith(n.split("(")[0].trim()) || n.startsWith(gl.split("(")[0].trim());
  });
};

const canonicalResolution = (value: string): string | undefined =>
  GPU_RESOLUTIONS.find((r) => value.toLowerCase().includes(r));

/**
 * Everything a schema cannot say.
 *
 * A row that fails ANY of these is dropped rather than shown with a caveat:
 * the review screen's job is to check plausible numbers, not to spot a broken
 * one hiding among them. If what survives does not cover every game at every
 * resolution, the whole answer is rejected and asked for again.
 */
export const validateGpuPerformance = (gpuModel: string, raw: unknown): GpuValidation => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "The answer was not an object with rows." };
  }
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : null;
  if (!list) return { ok: false, reason: "The answer had no rows array." };

  const rows: GpuPerformanceRow[] = [];
  const dropped: string[] = [];
  for (const row of list) {
    const game = canonicalGame(str(row.game));
    const resolution = canonicalResolution(str(row.resolution));
    const preset = str(row.preset);
    const low = num(row.fpsLow);
    const high = num(row.fpsHigh);
    if (!game || !resolution || !preset) { dropped.push(str(row.game) || "a row"); continue; }
    if (low == null || high == null) { dropped.push(`${game} ${resolution}`); continue; }
    // A RANGE, not a number dressed as one.
    if (!(high > low)) { dropped.push(`${game} ${resolution} (not a range)`); continue; }
    if (low < MIN_PLAUSIBLE_FPS || high > MAX_PLAUSIBLE_FPS) {
      dropped.push(`${game} ${resolution} (implausible)`);
      continue;
    }
    // Same game, same resolution, twice: keep the first and say nothing — a
    // duplicate is not a failure, it is noise.
    if (rows.some((x) => x.game === game && x.resolution === resolution)) continue;
    rows.push({ game, resolution, preset, fpsLow: Math.round(low), fpsHigh: Math.round(high) });
  }

  // COMPLETE MEANS EVERY GAME AT EVERY RESOLUTION, not every game somewhere.
  // Accepting a table with Fortnite at 1080p but not 1440p would put a gap in
  // front of the owner with nothing to say it was ever asked for — and a build
  // page that shows five rows where another shows six looks like the card is
  // worse, not like the answer was short.
  const missing: string[] = [];
  for (const game of GPU_GAMES) {
    for (const resolution of GPU_RESOLUTIONS) {
      if (!rows.some((row) => row.game === game && row.resolution === resolution)) {
        missing.push(`${game} at ${resolution}`);
      }
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `These were missing or unusable: ${missing.join(", ")}.`
        + (dropped.length ? ` Rejected rows: ${dropped.join(", ")}.` : "")
        + " Return every game at both resolutions, each as a low-to-high range.",
    };
  }

  const sources = Array.isArray(r.sources)
    ? (r.sources as unknown[]).map(str).filter(Boolean).slice(0, 10)
    : [];

  return { ok: true, value: { gpuModel: gpuModel.trim(), rows, sources } };
};
