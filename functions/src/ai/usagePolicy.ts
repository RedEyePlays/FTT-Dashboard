/**
 * WHAT THE SHOP IS SPENDING, AND THE LIMIT IT CANNOT GO PAST.
 *
 * Two separate things, deliberately:
 *
 *   THE LOG is per call — which op, which provider, which model, roughly how
 *   many tokens each way, how long it took, and who asked. It carries NO
 *   inventory contents, NO customer data and NO model output, because a usage
 *   log that quietly becomes a second copy of the shop's data is a liability
 *   rather than a tool.
 *
 *   THE CAP is per workspace per day, enforced server-side. A client-side cap
 *   is a suggestion; this is the thing that actually stops a runaway loop
 *   costing the shop money overnight. Hitting it produces a plain message, not
 *   a silent failure — the one behaviour that would send somebody hunting for
 *   a bug that is not there.
 *
 * Pure: no Firebase. usage.ts does the reading and writing.
 */

/** The default ceiling. Owner-adjustable in Settings (settings.operations). */
export const DEFAULT_DAILY_AI_CALLS = 200;
/** Nobody may set it lower than this, or the feature is simply off. */
export const MIN_DAILY_AI_CALLS = 10;
/** Or higher than this without asking, which is the point of a cap. */
export const MAX_DAILY_AI_CALLS = 5_000;

export const clampDailyCap = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_DAILY_AI_CALLS;
  return Math.min(MAX_DAILY_AI_CALLS, Math.max(MIN_DAILY_AI_CALLS, n));
};

/** The day a call belongs to, in UTC — one definition, shared by both ends. */
export const usageDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

export interface UsageEntry {
  op: string;
  provider: string;
  model: string;
  /** Approximate, from character counts — see estimateTokens. */
  inputTokens: number;
  outputTokens: number;
  ms: number;
  /** The uid that asked. Never an email, never a name. */
  uid: string;
  at: number;
}

/**
 * A rough token count from characters.
 *
 * DELIBERATELY APPROXIMATE, and labelled as such everywhere it surfaces. The
 * providers report exact usage per call, but the two of them report it in
 * different shapes and the router deliberately knows nothing about either
 * vendor's response body. ~4 characters per token is close enough for the
 * question this exists to answer — "is something costing far more than we
 * thought" — and being consistently wrong by a small factor does not change
 * that answer.
 */
export const estimateTokens = (text: string): number =>
  Math.max(0, Math.ceil((text || "").length / 4));

export interface CapState {
  used: number;
  cap: number;
}

export const overCap = (s: CapState): boolean => s.used >= s.cap;

export const capMessage = (s: CapState): string =>
  `The shop's daily AI limit (${s.cap} requests) has been reached. It resets at midnight UTC. `
  + "An owner can raise the limit in Settings → Operations.";

/* ---------------- The usage view ---------------- */

export interface DayUsage {
  day: string;
  total: number;
  byOp: Record<string, number>;
}

export interface UsageReport {
  today: number;
  cap: number;
  monthToDate: number;
  byOp: Record<string, number>;
  days: DayUsage[];
}

/** Roll a set of day documents into what the owner's Settings panel shows. */
export const buildUsageReport = (days: DayUsage[], cap: number, todayKey: string): UsageReport => {
  const month = todayKey.slice(0, 7);
  const inMonth = days.filter((d) => d.day.startsWith(month));
  const byOp: Record<string, number> = {};
  for (const d of inMonth) {
    for (const [op, n] of Object.entries(d.byOp || {})) byOp[op] = (byOp[op] || 0) + n;
  }
  return {
    today: days.find((d) => d.day === todayKey)?.total ?? 0,
    cap,
    monthToDate: inMonth.reduce((n, d) => n + (d.total || 0), 0),
    byOp,
    days: [...days].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30),
  };
};
