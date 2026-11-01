import { describe, it, expect } from 'vitest';
import { AppUser, Location, TimeEntry } from '../types';
import {
  shiftLocationId, shiftsAtStore, isSelfSelectedLocation,
  visibleStoresFor, clockInStoreChoices, canClockInAt,
  periodPayByStore, storeTotalsFor,
} from './shiftLocation';
import { periodPayFor, PayPeriod } from './timeclock';

/**
 * HOURS PER STORE — MULTI-STORE STAGE 3.
 *
 * Two promises that cost real money if they break:
 *
 *  1. A PERSON'S STORE LIST NEVER DECIDES WHERE THEIR HOURS LAND. Stage 2's
 *     `locationIds` says which TILL somebody may touch. A shift's location
 *     comes from the kiosk it was punched on. Conflating the two was the
 *     explicit instruction not to "simplify" — so nothing here resolves a
 *     shift's store from its userId.
 *
 *  2. ONE EMPLOYEE, ONE PAYCHEQUE. The per-store breakdown exists so the
 *     owner can see what each shop cost to run. It must never split a
 *     person's pay period into two: one approval, one stub, whatever stores
 *     they worked.
 */

const BRAMPTON = 'brampton';
const MISS = 'mississauga';
const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;                 // period start
const PERIOD: PayPeriod = { start: T0, end: T0 + 14 * 24 * HOUR, index: 0 };
const NOW = T0 + 15 * 24 * HOUR;              // after the period, so all shifts are closed

const shift = (p: Partial<TimeEntry> & { userId: string; clockIn: number; hours: number }): TimeEntry => ({
  id: `e${p.clockIn}`,
  userId: p.userId,
  clockIn: p.clockIn,
  clockOut: p.clockIn + p.hours * HOUR,
  breaks: [],
  ...(p.locationId ? { locationId: p.locationId } : {}),
  ...(p.locationSource ? { locationSource: p.locationSource } : {}),
});

const loc = (id: string, name: string, extra: Partial<Location> = {}): Location =>
  ({ id, name, active: true, createdAt: 1, ...extra });

const user = (p: Partial<AppUser> = {}): AppUser =>
  ({ id: 'u1', email: 'alice@shop.test', role: 'employee', workspaceId: 'ws', hourlyRate: 20, ...p } as AppUser);

/* ---------------- Reading a shift ---------------- */

describe('which store a stored shift belongs to', () => {
  it('the one stamped on it', () => {
    expect(shiftLocationId({ locationId: MISS }, BRAMPTON)).toBe(MISS);
  });

  it('HISTORICAL ENTRIES READ AS THE DEFAULT STORE — Brampton, as stage 1\'s backfill assigned', () => {
    // "Historical entries have Brampton from stage 1's backfill and must keep
    // reading exactly as they do today."
    expect(shiftLocationId({}, BRAMPTON)).toBe(BRAMPTON);
    expect(shiftLocationId({ locationId: undefined }, BRAMPTON)).toBe(BRAMPTON);
  });

  it('resolves to nothing in a workspace that was never split', () => {
    expect(shiftLocationId({})).toBe('');
  });

  it('scopes a list to one store, untagged history included in the default', () => {
    const entries = [
      shift({ userId: 'u1', clockIn: T0, hours: 8, locationId: BRAMPTON }),
      shift({ userId: 'u1', clockIn: T0 + 24 * HOUR, hours: 6, locationId: MISS }),
      shift({ userId: 'u1', clockIn: T0 + 48 * HOUR, hours: 5 }),            // history
    ];
    expect(shiftsAtStore(entries, BRAMPTON, BRAMPTON)).toHaveLength(2);
    expect(shiftsAtStore(entries, MISS, BRAMPTON)).toHaveLength(1);
    // No store asked for: the list passes through, exactly as before.
    expect(shiftsAtStore(entries, '', '')).toHaveLength(3);
  });
});

describe('self-selected is RECORDED, never inferred', () => {
  it('only an explicit stamp counts', () => {
    expect(isSelfSelectedLocation({ locationSource: 'self_selected' })).toBe(true);
    expect(isSelfSelectedLocation({ locationSource: 'kiosk' })).toBe(false);
  });

  it('A HISTORICAL ENTRY IS NOT SELF-SELECTED — nobody chose it, a migration assigned it', () => {
    // This is why it cannot be derived from `source`: every entry written
    // before stage 3 has no source AND a backfilled location. Deriving would
    // label the whole of history as chosen by the staff being paid.
    const old = shift({ userId: 'u1', clockIn: T0, hours: 8, locationId: BRAMPTON });
    expect(old.source).toBeUndefined();
    expect(isSelfSelectedLocation(old)).toBe(false);
  });
});

/* ---------------- Who may see, and who may pick ---------------- */

describe('the app punch asks, and offers only your own stores', () => {
  const stores = [loc(BRAMPTON, 'Brampton', { isDefault: true }), loc(MISS, 'Mississauga')];

  it('somebody who works one store is offered that one', () => {
    expect(clockInStoreChoices(user({ locationIds: [MISS] }), stores).map(l => l.id)).toEqual([MISS]);
  });

  it('AND CANNOT FILE HOURS TO THE OTHER', () => {
    expect(canClockInAt(user({ locationIds: [MISS] }), stores, BRAMPTON)).toBe(false);
    expect(canClockInAt(user({ locationIds: [MISS] }), stores, MISS)).toBe(true);
  });

  it('A PERSON WITH ONE STORE IS STILL ASKED — the list is non-empty, so the caller must pick', () => {
    // Consistency over the saved tap: it is what keeps the self-selected flag
    // meaning "they chose it" rather than "they have two stores".
    expect(clockInStoreChoices(user({ locationIds: [BRAMPTON] }), stores)).toHaveLength(1);
  });

  it('somebody with no list set gets the default store, not a lockout', () => {
    expect(clockInStoreChoices(user({}), stores).map(l => l.id)).toEqual([BRAMPTON]);
  });

  it('the owner may file at any store, and sees every store\'s hours', () => {
    expect(clockInStoreChoices(user({ role: 'owner' }), stores)).toHaveLength(2);
    expect(visibleStoresFor(user({ role: 'owner', locationIds: [MISS] }), stores)).toHaveLength(2);
  });

  it('everyone else sees only the stores they work at', () => {
    expect(visibleStoresFor(user({ locationIds: [MISS] }), stores).map(l => l.id)).toEqual([MISS]);
  });

  it('a workspace with no stores asks nothing and filters nothing', () => {
    expect(clockInStoreChoices(user({}), [])).toEqual([]);
    expect(visibleStoresFor(user({}), [])).toEqual([]);
  });
});

/* ---------------- Hours per store ---------------- */

describe('a pay period broken down by store', () => {
  // Alice works both shops: 8 h at Brampton, 6 h at Mississauga, plus a 5 h
  // shift from before the split (which reads as Brampton).
  const alice = user({ id: 'u1', hourlyRate: 20 });
  const entries = [
    shift({ userId: 'u1', clockIn: T0 + HOUR, hours: 8, locationId: BRAMPTON }),
    shift({ userId: 'u1', clockIn: T0 + 24 * HOUR, hours: 6, locationId: MISS }),
    shift({ userId: 'u1', clockIn: T0 + 48 * HOUR, hours: 5 }),
    // Another period entirely — must not leak in.
    shift({ userId: 'u1', clockIn: T0 - 10 * 24 * HOUR, hours: 9, locationId: MISS }),
  ];
  const byStore = periodPayByStore(entries, alice, PERIOD, NOW, {
    stores: [BRAMPTON, MISS], defaultLocationId: BRAMPTON,
  });

  it('shows them at BOTH stores, with the hours they worked at each', () => {
    expect(byStore.map(b => [b.locationId, b.pay.hours])).toEqual([
      [BRAMPTON, 13],   // 8 + the 5 h historical shift
      [MISS, 6],
    ]);
  });

  it('THE PARTS SUM TO THE PERSON\'S ONE TOTAL, counted once', () => {
    const whole = periodPayFor(entries, 'u1', alice.hourlyRate, PERIOD, NOW);
    expect(whole.hours).toBe(19);
    expect(byStore.reduce((n, b) => n + b.pay.hours, 0)).toBe(whole.hours);
    expect(byStore.reduce((n, b) => n + b.pay.gross, 0)).toBe(whole.gross);
  });

  it('prices each store with the same rate the total uses', () => {
    expect(byStore.map(b => b.pay.gross)).toEqual([260, 120]);   // 13×20, 6×20
  });

  it('omits a store the person did not work', () => {
    const bobOnly = periodPayByStore(entries, user({ id: 'nobody' }), PERIOD, NOW, {
      stores: [BRAMPTON, MISS], defaultLocationId: BRAMPTON,
    });
    expect(bobOnly).toEqual([]);
  });

  it('A PERSON\'S STORE LIST IS IRRELEVANT HERE — the shift says where it happened', () => {
    // The asymmetry the owner insisted on. Alice is rostered to Brampton
    // only, and her Mississauga shift still counts at Mississauga: she
    // punched in on that shop's iPad.
    const rosteredToBramptonOnly = user({ id: 'u1', hourlyRate: 20, locationIds: [BRAMPTON] });
    const out = periodPayByStore(entries, rosteredToBramptonOnly, PERIOD, NOW, {
      stores: [BRAMPTON, MISS], defaultLocationId: BRAMPTON,
    });
    expect(out.find(b => b.locationId === MISS)?.pay.hours).toBe(6);
  });
});

describe('what each store cost to run', () => {
  const alice = user({ id: 'u1', hourlyRate: 20 });
  const bob = user({ id: 'u2', email: 'bob@shop.test', hourlyRate: 25 });
  const entries = [
    shift({ userId: 'u1', clockIn: T0 + HOUR, hours: 8, locationId: BRAMPTON }),
    shift({ userId: 'u1', clockIn: T0 + 24 * HOUR, hours: 6, locationId: MISS }),
    shift({ userId: 'u2', clockIn: T0 + HOUR, hours: 10, locationId: MISS }),
  ];
  const opts = { stores: [BRAMPTON, MISS], defaultLocationId: BRAMPTON };
  const rows = [alice, bob].map(u => ({ user: u, byStore: periodPayByStore(entries, u, PERIOD, NOW, opts) }));
  const totals = storeTotalsFor(rows, [BRAMPTON, MISS]);

  it('adds up each store\'s hours and wage cost', () => {
    expect(totals).toEqual([
      { locationId: BRAMPTON, hours: 8, gross: 160, people: 1 },
      { locationId: MISS, hours: 16, gross: 370, people: 2 },   // 6×20 + 10×25
    ]);
  });

  it('counts a both-stores worker in both, and the company total once', () => {
    const companyHours = rows.reduce(
      (n, r) => n + periodPayFor(entries, r.user.id, r.user.hourlyRate, PERIOD, NOW).hours, 0);
    expect(companyHours).toBe(24);
    expect(totals.reduce((n, t) => n + t.hours, 0)).toBe(companyHours);
    // Alice appears in both headcounts; nobody is counted twice in the hours.
    expect(totals.map(t => t.people)).toEqual([1, 2]);
  });

  it('omits a store nobody worked', () => {
    expect(storeTotalsFor(rows, [BRAMPTON, MISS, 'ghost'])).toHaveLength(2);
  });
});
