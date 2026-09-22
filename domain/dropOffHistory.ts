import { DeviceBuyer, DropOff, DropOffStatus, Settlement } from '../types';
import { normalizeForLookup } from './identifierSearch';

/**
 * WHICH DROP-OFFS ARE STILL LIVE, AND WHERE THE REST GO.
 *
 * THE PROBLEM: the Drop-Offs list showed every drop-off ever taken, with a
 * status filter that defaulted to "All". Devices that were settled months ago —
 * and devices that were rejected and handed straight back — sat in the same
 * list as the ones the store is still owed money for, forever. The list only
 * grows, so the work in front of somebody gets steadily harder to see.
 *
 * The split is by what is still OUTSTANDING, not by age:
 *
 *   ACTIVE   pending / accepted / paid out — money is still on the street, or a
 *            decision has not been made. This is the working list.
 *   HISTORY  settled / rejected — closed. Kept, searchable, never deleted.
 *
 * NOTHING IS MIGRATED. Every drop-off keeps the status it already has; this
 * module only decides which list it is shown in. A settled drop-off that is
 * somehow re-opened reappears in the working list on its own.
 *
 * Pure: no DOM, no Firestore.
 */

export const ACTIVE_DROPOFF_STATUSES: DropOffStatus[] = ['pending', 'accepted', 'paidout'];
export const HISTORY_DROPOFF_STATUSES: DropOffStatus[] = ['settled', 'rejected'];

export const isActiveDropOff = (d: Pick<DropOff, 'status'>): boolean =>
  ACTIVE_DROPOFF_STATUSES.includes(d.status);

export const isHistoryDropOff = (d: Pick<DropOff, 'status'>): boolean =>
  HISTORY_DROPOFF_STATUSES.includes(d.status);

/** The working list: everything still owed for or still undecided. */
export const activeDropOffs = (dropOffs: DropOff[]): DropOff[] => dropOffs.filter(isActiveDropOff);

/** Everything closed — the History tab's whole population. */
export const historyDropOffs = (dropOffs: DropOff[]): DropOff[] => dropOffs.filter(isHistoryDropOff);

/* ---------------- Searching history ---------------- */

export interface HistoryFilter {
  /** IMEI/serial, device name, or device buyer name. */
  query?: string;
  /** Inclusive YYYY-MM-DD bounds on the drop-off date. */
  start?: string;
  end?: string;
}

/**
 * The date a history row is filed under.
 *
 * For a settled drop-off that is its SETTLEMENT's date where one is known, not
 * the day the device came in: somebody looking through history is looking for
 * the week the money moved. Falls back to the drop-off date when the settlement
 * record can't be resolved, so a row is never undated.
 */
export const historyDateOf = (d: DropOff, settlement?: Settlement): string =>
  (d.status === 'settled' && settlement?.date) || d.dateDropped || '';

const inRange = (date: string, f: HistoryFilter): boolean => {
  if (f.start && (!date || date < f.start)) return false;
  if (f.end && (!date || date > f.end)) return false;
  return true;
};

/**
 * Does this drop-off match the search box?
 *
 * The IMEI is compared with separators stripped on BOTH sides (the shared
 * normalizeForLookup), so a stored "35 123456 789012 3" is found by a scanned
 * "351234567890123" here exactly as it is in Inventory. Device name and buyer
 * name stay ordinary case-insensitive substring searches — they are words, not
 * codes.
 */
export const matchesHistoryQuery = (d: DropOff, buyerName: string, query: string): boolean => {
  const raw = (query || '').trim();
  if (!raw) return true;
  const q = raw.toLowerCase();
  if ([d.item, buyerName, d.sellerName].some(v => (v || '').toLowerCase().includes(q))) return true;
  if ((d.imei || '').toLowerCase().includes(q)) return true;
  const nq = normalizeForLookup(raw);
  return !!nq && normalizeForLookup(d.imei).includes(nq);
};

/* ---------------- Grouping settled drop-offs ---------------- */

export interface SettlementGroup {
  /** The settlement record, when it could be resolved. */
  settlement?: Settlement;
  /**
   * The grouping key: a settlementId, or '' for settled drop-offs that carry
   * none. Those exist — drop-offs settled before settlementId was stamped —
   * and dropping them would lose real history, so they get their own group.
   */
  settlementId: string;
  /** The settlement's date, or the newest drop-off date as a stand-in. */
  date: string;
  dropOffs: DropOff[];
}

/**
 * Settled drop-offs, grouped by the settlement that closed them, newest first.
 *
 * Reads the settlement record for the date, week ending, buyer, total and
 * payment method rather than recomputing any of it — those figures were agreed
 * and recorded on the day, and a total recomputed now from today's fee values
 * would quietly restate what was actually paid.
 */
export const groupSettledBySettlement = (
  dropOffs: DropOff[],
  settlements: Settlement[],
  filter: HistoryFilter = {},
  buyerNameOf: (buyerId: string) => string = () => '',
): SettlementGroup[] => {
  const byId = new Map(settlements.map(s => [s.id, s]));
  const groups = new Map<string, SettlementGroup>();

  for (const d of dropOffs) {
    if (d.status !== 'settled') continue;
    const settlement = d.settlementId ? byId.get(d.settlementId) : undefined;
    if (!matchesHistoryQuery(d, buyerNameOf(d.buyerId), filter.query || '')) continue;
    if (!inRange(historyDateOf(d, settlement), filter)) continue;

    const key = d.settlementId || '';
    const existing = groups.get(key);
    if (existing) existing.dropOffs.push(d);
    else groups.set(key, { settlement, settlementId: key, date: historyDateOf(d, settlement), dropOffs: [d] });
  }

  // A group with no settlement record is dated by its newest device, so it
  // still sorts sensibly among the real ones.
  for (const g of groups.values()) {
    if (!g.settlement) {
      g.date = g.dropOffs.reduce((max, d) => (d.dateDropped > max ? d.dateDropped : max), '');
    }
    g.dropOffs.sort((a, b) => (b.dateDropped || '').localeCompare(a.dateDropped || ''));
  }

  return [...groups.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
};

/** Rejected drop-offs matching the filter, newest first — their own section. */
export const rejectedHistory = (
  dropOffs: DropOff[],
  filter: HistoryFilter = {},
  buyerNameOf: (buyerId: string) => string = () => '',
): DropOff[] =>
  dropOffs
    .filter(d => d.status === 'rejected')
    .filter(d => matchesHistoryQuery(d, buyerNameOf(d.buyerId), filter.query || ''))
    .filter(d => inRange(d.dateDropped, filter))
    .sort((a, b) => (b.dateDropped || '').localeCompare(a.dateDropped || ''));

/** A buyerId → name lookup, so callers don't scan the buyer list per row. */
export const buyerNameFrom = (buyers: DeviceBuyer[]) => {
  const byId = new Map(buyers.map(b => [b.id, b.name]));
  return (id: string): string => byId.get(id) || 'Unknown';
};
