// Business calendar dates ("what day did this happen on?") are LOCAL dates,
// everywhere in this app.
//
// This module exists because they weren't. Records were stamped with
// `new Date().toISOString().split('T')[0]`, which is the **UTC** calendar date,
// while every aggregation reads them back as **local** dates —
// domain/analytics.ts's `presetRange` builds ranges from a local `startOfDay`,
// and its `ymdMs` parses 'YYYY-MM-DD' as local midnight. Those two agree only
// while local time and UTC happen to fall on the same calendar day.
//
// For the shop's own timezone (America/Toronto, UTC−4/−5) they stop agreeing at
// 8pm local: a sale rung up at 20:30 on Aug 26 was stamped '2026-08-27' and
// therefore fell outside "Today" (local Aug 26 00:00 → Aug 27 00:00). Evening
// sales silently dropped out of the day's revenue and profit — on the Dashboard
// tiles, Close Out, Daily History and the P&L alike. Because closing the
// register also happens in the evening, this read as "closing the drawer stops
// counting profit", but the drawer was never involved: the trigger is the clock
// crossing UTC midnight, not the close.
//
// The same skew hits every other date-stamped record (repair completion dates,
// drawer/reconciliation dates, drop-offs, inventory sold dates), which is why
// this is one shared helper rather than a fix at the sale site only.
//
// Timezone note: "local" means the terminal's timezone, which is the shop's.
// That matches how analytics already interprets stored dates, so using it here
// makes the write and read sides agree — which is the actual bug. Rendering a
// workspace's books in `AppSettings.general.timeZone` regardless of where the
// terminal sits would be a separate, larger change.

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The LOCAL calendar date of an instant, as 'YYYY-MM-DD'.
 *
 * Use this for anything that answers "what day did this happen on" — never
 * `toISOString().split('T')[0]`, which silently yields tomorrow's date for any
 * evening event in a negative-UTC-offset timezone (and yesterday's for a
 * morning event in a positive-offset one).
 */
export function toISODate(when: Date | number = Date.now()): string {
  const d = typeof when === 'number' ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's local calendar date, 'YYYY-MM-DD'. */
export function todayISO(now: number = Date.now()): string {
  return toISODate(now);
}

/** Local midnight of a 'YYYY-MM-DD' date, as epoch ms. Mirrors toISODate. */
export function isoDateToMs(ymd: string): number {
  if (!ymd) return 0;
  const t = new Date(`${ymd}T00:00:00`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Move a range's START forward to the books start date, when one is set.
 *
 * THE PROBLEM. The shop only began using the system in full in September. The
 * partial data from before that — half-entered sales, expenses that were
 * never logged, days nobody reconciled — is real history and must not be
 * deleted, but folding it into a total produces a figure that is simply
 * wrong: revenue without its costs, an expense ledger with holes, drawer
 * alerts for days the drawer was never run.
 *
 * So every range-based FIGURE starts here instead. This is deliberately only
 * about totals: individual sales, expenses, repairs, customers and inventory
 * stay fully visible and searchable, exactly as they are.
 *
 * Unset or empty `start` returns `lo` untouched — a workspace that never sets
 * one behaves exactly as it always did. A range that already begins on or
 * after the books start is likewise untouched; only a range reaching further
 * back is pulled forward.
 */
export function clampToBooksStart(lo: string, start?: string): string {
  if (!start || !lo) return lo;
  return lo < start ? start : lo;
}

/**
 * The epoch-ms twin of clampToBooksStart, for the ranges that work in
 * timestamps rather than YYYY-MM-DD strings (analytics, technician
 * performance). Clamps to LOCAL MIDNIGHT of the books start date, matching
 * how every other date in this app is interpreted.
 */
export function clampToBooksStartMs(startMs: number, start?: string): number {
  if (!start) return startMs;
  const floor = isoDateToMs(start);
  return floor && startMs < floor ? floor : startMs;
}

/**
 * True when a range was actually clamped — i.e. the report is showing less
 * than the dates its own controls say. The screens and CSV headers use this
 * to say so out loud rather than quietly returning a smaller number.
 */
export function booksStartClamps(lo: string, start?: string): boolean {
  return !!start && !!lo && lo < start;
}

/**
 * The SATURDAY that ends the settlement week a local date falls in.
 *
 * The shop settles with its device buyers on Saturdays, so a week runs Sunday
 * → Saturday and every drop-off belongs to exactly one of them. A date that
 * IS a Saturday is its own week end, never pushed to the next one.
 *
 * Built on isoDateToMs (local midnight) rather than Date parsing or
 * toISOString, for the reason this whole module exists: a UTC round-trip
 * shifts an evening date to the next day and would file that drop-off under
 * the wrong week — which, at the week boundary, is a whole extra settlement.
 */
export function weekEndingSaturday(ymd: string): string {
  const ms = isoDateToMs(ymd);
  if (!ms) return ymd;
  const d = new Date(ms);
  return shiftISODate(ymd, (6 - d.getDay() + 7) % 7);
}

/** `n` days before/after a local date, as 'YYYY-MM-DD'. */
export function shiftISODate(ymd: string, days: number): string {
  const ms = isoDateToMs(ymd);
  if (!ms) return ymd;
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
