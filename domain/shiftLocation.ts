import { AppUser, Location, TimeEntry } from '../types';
import { PayPeriod, PeriodPay, periodPayFor, PaidBreakReasons, RateAt } from './timeclock';
import { permittedLocations } from './locations';

/**
 * WHERE A SHIFT WAS WORKED. MULTI-STORE STAGE 3.
 *
 * THE OWNER'S RULE, AND IT IS THE WHOLE DESIGN: a shift's location comes from
 * the KIOSK it was punched on, never from the person. Staff work both stores,
 * and their hours split automatically with nobody choosing anything —
 * Brampton's iPad stamps Brampton, Mississauga's stamps Mississauga.
 *
 * NOTE THE ASYMMETRY WITH STAGE 2, WHICH IS DELIBERATE AND MUST SURVIVE:
 *
 *   users.locationIds       → which TILL a person may touch.
 *   users.kioskLocationId   → where a DEVICE's punches land.
 *
 * Those answer different questions. A person's store list must never decide
 * where their hours are filed, so nothing in this module resolves a shift's
 * location from its `userId` — only from the entry itself.
 *
 * The one exception is the APP punch (components/TimeClockView.tsx), which has
 * no kiosk to vouch for it. There the person is asked, from their own store
 * list, and the answer is recorded as `locationSource: 'self_selected'` — a
 * claim rather than evidence, surfaced as such at payroll.
 *
 * Pure: no Firestore, no DOM, no clock.
 */

/* ---------------- Reading a stored shift ---------------- */

/**
 * Which store a stored shift belongs to.
 *
 * An entry with no location is the DEFAULT store's — the same rule the cash
 * drawer follows for a bare-date record (domain/drawerKey.ts), and the same
 * one stage 1's backfill applied: every shift worked before the second store
 * existed happened at Brampton. Returns '' when there is no store list at all,
 * which is a workspace that has not been split and where nothing filters.
 */
export const shiftLocationId = (
  entry: Pick<TimeEntry, 'locationId'>,
  defaultLocationId?: string,
): string => entry.locationId || defaultLocationId || '';

/** One store's shifts. With no store asked for, the list passes through. */
export const shiftsAtStore = (
  entries: TimeEntry[],
  locationId: string,
  defaultLocationId?: string,
): TimeEntry[] =>
  (!locationId
    ? (entries || [])
    : (entries || []).filter(e => shiftLocationId(e, defaultLocationId) === locationId));

/**
 * A punch the person chose the location of themselves.
 *
 * NOT derived from `source`: an entry from before stage 3 has no `source` and
 * a backfilled location nobody chose, so deriving it would call the whole of
 * history self-selected. Only an explicit stamp counts.
 */
export const isSelfSelectedLocation = (e: Pick<TimeEntry, 'locationSource'>): boolean =>
  e.locationSource === 'self_selected';

/* ---------------- Which stores a screen may show ---------------- */

/**
 * The stores whose hours this viewer may look at.
 *
 * The owner sees every store; everyone else sees the stores they work at
 * (stage 2's list, where an empty list still means the default store rather
 * than nothing). This governs VISIBILITY on the Time Clock screen only — it
 * does not decide where anybody's hours land.
 */
export const visibleStoresFor = (
  viewer: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
): Location[] => permittedLocations(viewer, locations);

/* ---------------- The app punch's store picker ---------------- */

/**
 * The stores the app's own Clock In may offer.
 *
 * Only the stores on this person's list: somebody who works Brampton alone
 * must not be able to file hours to Mississauga. There is deliberately NO
 * default and NO pre-selection — the caller must not pick one of these for
 * the user. A defaulted picker is a wrong answer waiting to be tapped past,
 * and this is pay.
 *
 * A person with exactly ONE store is still asked. The saved tap is worth less
 * than the consistency, and it is what keeps `self_selected` meaningful: if
 * one-store staff were auto-stamped, the flag would mean "has two stores"
 * rather than "chose it themselves".
 */
export const clockInStoreChoices = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
): Location[] => permittedLocations(user, locations);

/** May this person file a shift against this store from the app? */
export const canClockInAt = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
  locationId: string,
): boolean => !!locationId && clockInStoreChoices(user, locations).some(l => l.id === locationId);

/* ---------------- Hours per store ---------------- */

export interface StorePay {
  locationId: string;
  pay: PeriodPay;
}

/**
 * ONE PERSON'S PAY PERIOD, BROKEN DOWN BY STORE.
 *
 * The owner needs to know what each store's wage cost was. A person who
 * worked both appears in both breakdowns with their own hours.
 *
 * THEIR TOTAL IS STILL ONE NUMBER, and it is NOT recomputed from these parts.
 * The caller keeps using `periodPayFor` for the person's own figure — one
 * employee, one approval, one paycheque — and this is a breakdown OF that
 * figure, never a replacement for it. Approval and payment stay per person;
 * splitting a pay period by store would mean two stubs for one person, which
 * is not what the owner asked for.
 *
 * Each store's figure goes through `periodPayFor` itself rather than through a
 * second copy of the arithmetic, so a store's hours are priced with the same
 * rate history, paid-break rules and rounding as the total. Each store's
 * hours and gross are therefore rounded in their own right, and in a period
 * with an odd number of half-cents the lines can differ from the total by a
 * cent. The total on screen is always the person's authoritative figure.
 *
 * Stores with no hours are omitted — an empty row says nothing.
 */
export const periodPayByStore = (
  entries: TimeEntry[],
  user: Pick<AppUser, 'id' | 'hourlyRate'>,
  period: PayPeriod,
  now: number,
  opts: {
    stores: string[];
    defaultLocationId?: string;
    paidReasons?: PaidBreakReasons;
    rateAt?: RateAt;
  },
): StorePay[] => {
  const { stores, defaultLocationId, paidReasons = [], rateAt } = opts;
  const out: StorePay[] = [];
  for (const locationId of stores) {
    const mine = shiftsAtStore(entries, locationId, defaultLocationId);
    const pay = periodPayFor(mine, user.id, user.hourlyRate, period, now, paidReasons, rateAt);
    if (pay.hours > 0 || pay.gross > 0) out.push({ locationId, pay });
  }
  return out;
};

export interface StoreTotal {
  locationId: string;
  hours: number;
  gross: number;
  /** How many people worked this store in the period. */
  people: number;
}

/**
 * THE WHOLE PERIOD'S WAGE COST PER STORE — what the owner is actually asking
 * when they ask what each shop cost to run.
 *
 * Built from the same per-person breakdown above, so a figure here can always
 * be traced to the people in it, and someone who worked both stores is
 * counted in both with their own hours and once in each store's headcount.
 */
export const storeTotalsFor = (
  rows: { user: Pick<AppUser, 'id' | 'hourlyRate'>; byStore: StorePay[] }[],
  stores: string[],
): StoreTotal[] => {
  const byStore = new Map<string, StoreTotal>();
  for (const id of stores) byStore.set(id, { locationId: id, hours: 0, gross: 0, people: 0 });
  for (const row of rows) {
    for (const s of row.byStore) {
      const t = byStore.get(s.locationId);
      if (!t) continue;
      t.hours = Math.round((t.hours + s.pay.hours) * 100) / 100;
      t.gross = Math.round((t.gross + s.pay.gross) * 100) / 100;
      t.people += 1;
    }
  }
  return stores.map(id => byStore.get(id)!).filter(t => t.hours > 0 || t.gross > 0);
};
