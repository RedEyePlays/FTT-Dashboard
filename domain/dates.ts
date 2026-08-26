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

/** `n` days before/after a local date, as 'YYYY-MM-DD'. */
export function shiftISODate(ymd: string, days: number): string {
  const ms = isoDateToMs(ymd);
  if (!ms) return ymd;
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
