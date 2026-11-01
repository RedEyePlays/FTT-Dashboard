import { CashReconciliation } from '../types';

/**
 * ONE CASH DRAWER PER STORE. STAGE 2 OF MULTI-STORE.
 *
 * THE BUG THIS CLOSES. A day's drawer record was keyed by the DATE alone
 * (`cashReconciliations/2026-10-27`). With a second store open, both tills
 * write the same document on the same day: Mississauga's opening float
 * overwrites Brampton's, one store's count lands on the other's day, and the
 * variance that results explains nothing. Cash records are the last data in
 * this app anyone should lose, and this one loses them silently.
 *
 * THE KEY, FROM HERE ON: `{YYYY-MM-DD}__{locationId}`.
 *
 *   2026-10-27__brampton
 *   2026-10-27__mississauga
 *
 * Date FIRST, deliberately: document ids sort lexicographically, so a day's
 * drawers stay adjacent and an id range is still a date range — which is what
 * every existing query, export and backup over this collection assumes. A
 * separate subcollection per store would have done the same job, at the price
 * of re-shaping `COLLECTIONS`, the subscription, the backup export and every
 * rules path for one collection only; the composite id costs none of that.
 *
 * HISTORY IS NOT RE-KEYED. Every record written before this stage carries a
 * bare date as its id, and those ids stay exactly as they are. Nothing copies,
 * rewrites or deletes a historical cash document — not as part of the deploy,
 * and not as a migration afterwards. A bare-date id is read as belonging to
 * the location in its own `locationId` field (stamped by stage 1's backfill),
 * and failing that to the DEFAULT location — Brampton. So:
 *
 *   • history keeps reading exactly as it does today;
 *   • today's half-finished drawer keeps being written where it already is
 *     (see `drawerIdFor` — a legacy id still in play wins over the composite
 *     one), so the morning's float and movements do not vanish at the moment
 *     this ships;
 *   • from here on, EVERY new document is composite, Brampton's included, so
 *     the bare form is purely historical and never ambiguous.
 *
 * BEFORE THE OWNER CREATES ANY LOCATION, NOTHING HERE CHANGES ANYTHING. With
 * no locations configured the resolved location id is '' , `drawerIdFor`
 * returns the bare date, and `drawersAt` filters nothing out. Stage 2 is
 * invisible until stage 1's store list exists.
 *
 * Pure: no Firestore, no DOM, no clock.
 */

/** Between the date and the location. Two underscores — see `parseDrawerKey`. */
export const DRAWER_KEY_SEP = '__';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The document id for one store's drawer on one day.
 *
 * An empty `locationId` yields the bare date, which is what a workspace with
 * no store list uses — and what every record written before this stage holds.
 */
export const drawerKey = (date: string, locationId?: string): string =>
  (locationId ? `${date}${DRAWER_KEY_SEP}${locationId}` : date);

/**
 * Split an id back into its parts.
 *
 * The date is a fixed ten characters, so the separator is found by position
 * rather than by searching — a location id containing `__` itself cannot
 * confuse this, and the location part is returned whole.
 */
export const parseDrawerKey = (id: string): { date: string; locationId?: string } => {
  const raw = id || '';
  const head = raw.slice(0, 10);
  if (!DATE_RE.test(head)) return { date: raw };
  const rest = raw.slice(10);
  if (!rest) return { date: head };
  if (!rest.startsWith(DRAWER_KEY_SEP)) return { date: raw };
  const locationId = rest.slice(DRAWER_KEY_SEP.length);
  return locationId ? { date: head, locationId } : { date: head };
};

/** An id from before this stage: a bare date, no store in it. */
export const isLegacyDrawerId = (id: string): boolean =>
  DATE_RE.test(id || '') && !parseDrawerKey(id).locationId;

/**
 * WHICH STORE A STORED RECORD BELONGS TO.
 *
 * The id wins when it carries a location: the key is what decides which
 * document a write lands on, so a field that disagreed with it would be the
 * field that is wrong. Then the record's own `locationId` (stage 1's
 * backfill), then the default store — a bare-date record is Brampton's, which
 * is the truth about every day the shop had one store.
 *
 * Returns '' only when there is no store list at all to resolve against.
 */
export const drawerLocationId = (
  rec: Pick<CashReconciliation, 'id' | 'locationId'>,
  defaultLocationId?: string,
): string => parseDrawerKey(rec.id).locationId || rec.locationId || defaultLocationId || '';

/**
 * One store's drawer records, and nothing else.
 *
 * This is what keeps the carry-over, the unreconciled-days flag, Day History
 * and the close-out inside a single store: every one of them takes a LIST of
 * reconciliations, so scoping the list is what scopes them all — rather than
 * teaching each of them separately about locations and leaving one behind.
 *
 * With no location asked for (no store list yet) the list passes through
 * whole, which is today's behaviour exactly.
 */
export const drawersAt = (
  recs: CashReconciliation[],
  locationId: string,
  defaultLocationId?: string,
): CashReconciliation[] =>
  (!locationId
    ? (recs || [])
    : (recs || []).filter(r => drawerLocationId(r, defaultLocationId) === locationId));

/** One store's record for one day. */
export const drawerOn = (
  recs: CashReconciliation[],
  date: string,
  locationId: string,
  defaultLocationId?: string,
): CashReconciliation | undefined =>
  drawersAt(recs, locationId, defaultLocationId).find(r => r.date === date);

/**
 * WHERE THE NEXT WRITE FOR (store, day) GOES.
 *
 * The composite key, unless a legacy bare-date record for that same day
 * already exists AND resolves to this store — in which case the write goes to
 * that document, because that is where the day's float and movements already
 * are. Without this, the day stage 2 ships would split in two: the morning in
 * `2026-10-27`, the afternoon in `2026-10-27__brampton`, and both halves
 * wrong.
 *
 * It cannot go the other way round: once a composite document exists for the
 * day it is preferred, so a day never drifts back onto the legacy id.
 */
export const drawerIdFor = (
  recs: CashReconciliation[],
  date: string,
  locationId: string,
  defaultLocationId?: string,
): string => {
  const composite = drawerKey(date, locationId);
  if (!locationId) return date;
  if ((recs || []).some(r => r.id === composite)) return composite;
  const legacy = (recs || []).find(
    r => r.id === date && isLegacyDrawerId(r.id) && drawerLocationId(r, defaultLocationId) === locationId,
  );
  return legacy ? legacy.id : composite;
};
