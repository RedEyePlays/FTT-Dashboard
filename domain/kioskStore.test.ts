import { describe, it, expect } from 'vitest';
import { KioskStaff, TimeEntry } from '../types';
import {
  kioskStoreFor, kioskStoreIssue, KIOSK_STORE_ISSUE_MESSAGE, KIOSK_NOT_SET_MESSAGE,
  buildKioskClockIn, buildKioskClockOut, buildKioskStartBreak, buildKioskEndBreak,
} from './kiosk';
import { correctClockOut } from './timeclock';

/**
 * THE KIOSK STAMPS ITS OWN STORE ON EVERY PUNCH. MULTI-STORE STAGE 3.
 *
 * The owner's rule: a shift's location comes from the KIOSK, not from the
 * person. Staff work both stores and their hours split automatically with
 * nobody choosing anything.
 *
 * The four things that would make that false, pinned here:
 *
 *  1. an unconfigured kiosk quietly stamping the default store;
 *  2. a punch taking its store from the person instead of the device;
 *  3. a device reconfigured mid-shift rewriting where that shift happened;
 *  4. a manager's clock-out correction moving a shift to another store.
 */

const BRAMPTON = 'brampton';
const MISS = 'mississauga';

const person = (uid: string): Pick<KioskStaff, 'uid'> => ({ uid });

const loc = (id: string, name: string, active = true) => ({ id, name, active });

describe('which store an iPad is', () => {
  it('is whatever the owner assigned to that DEVICE account', () => {
    const store = kioskStoreFor({ kioskLocationId: MISS, kioskLocationName: 'Mississauga' });
    expect(store).toEqual({ locationId: MISS, name: 'Mississauga', ready: true });
  });

  it('IS NOT READY WHEN UNSET — and it does NOT fall back to a default', () => {
    // The whole point of refusing. Stamping the default store would file
    // Mississauga's first week into Brampton and nobody would notice until
    // payroll; a kiosk that will not punch is noticed in a minute.
    for (const device of [undefined, null, {}, { kioskLocationId: '' }, { kioskLocationId: '   ' }]) {
      const store = kioskStoreFor(device as any);
      expect(store.ready).toBe(false);
      expect(store.locationId).toBe('');
    }
  });

  it('still names itself when only the id was stored', () => {
    // An older device record may carry the id without the denormalized name.
    // The header must not go blank — it is the one thing on the screen that
    // says where hours are being filed.
    expect(kioskStoreFor({ kioskLocationId: BRAMPTON }).name).toBe('this store');
  });

  it('tells staff what to do, and whose job it is', () => {
    expect(KIOSK_NOT_SET_MESSAGE).toMatch(/owner/i);
    expect(KIOSK_NOT_SET_MESSAGE).toMatch(/Clock-in kiosk/);
    // It must not suggest the punch worked.
    expect(KIOSK_NOT_SET_MESSAGE).toMatch(/cannot record hours/i);
  });
});

describe("the owner's view of the same question", () => {
  const stores = [loc(BRAMPTON, 'Brampton'), loc(MISS, 'Mississauga')];

  it('a correctly set device has nothing to report', () => {
    expect(kioskStoreIssue({ kioskLocationId: MISS, kioskLocationName: 'Mississauga' }, stores)).toBeNull();
  });

  it('flags an unset device as one that will not record hours', () => {
    expect(kioskStoreIssue({}, stores)).toBe('not-set');
    expect(KIOSK_STORE_ISSUE_MESSAGE['not-set']).toMatch(/refuse/i);
  });

  it('flags a device pointed at a store that no longer exists', () => {
    expect(kioskStoreIssue({ kioskLocationId: 'gone', kioskLocationName: 'Gone' }, stores)).toBe('unknown-store');
  });

  it('flags a device pointed at a CLOSED store', () => {
    const closed = [loc(BRAMPTON, 'Brampton'), loc(MISS, 'Mississauga', false)];
    expect(kioskStoreIssue({ kioskLocationId: MISS, kioskLocationName: 'Mississauga' }, closed)).toBe('closed-store');
  });

  it('flags a stale NAME, and says the hours are still right', () => {
    // The trade-off of not letting the kiosk read the store list: the id it
    // stamps is correct, the name it shows is a snapshot. The owner is the
    // one who can see and fix it.
    expect(kioskStoreIssue({ kioskLocationId: BRAMPTON, kioskLocationName: 'Brampton' },
      [loc(BRAMPTON, 'Brampton North')])).toBe('stale-name');
    expect(KIOSK_STORE_ISSUE_MESSAGE['stale-name']).toMatch(/already being recorded against the right store/);
  });
});

describe('the punch carries the DEVICE\'s store', () => {
  it('a clock-in is stamped with the kiosk\'s store, and says a device said so', () => {
    const e = buildKioskClockIn(person('u1'), 'e1', 1000, MISS);
    expect(e.locationId).toBe(MISS);
    expect(e.locationSource).toBe('kiosk');
    expect(e.source).toBe('kiosk');
  });

  it('WHOEVER PUNCHES — the store comes from the iPad, never the person', () => {
    const a = buildKioskClockIn(person('alice'), 'e1', 1000, MISS);
    const b = buildKioskClockIn(person('bob'), 'e2', 2000, MISS);
    expect([a.locationId, b.locationId]).toEqual([MISS, MISS]);
  });

  it('the same person at each shop on different days files at each shop', () => {
    const mon = buildKioskClockIn(person('alice'), 'e1', 1000, BRAMPTON);
    const tue = buildKioskClockIn(person('alice'), 'e2', 90_000_000, MISS);
    expect([mon.locationId, tue.locationId]).toEqual([BRAMPTON, MISS]);
  });

  it('stamps nothing in a workspace with no stores — exactly as before', () => {
    const e = buildKioskClockIn(person('u1'), 'e1', 1000);
    expect(e.locationId).toBeUndefined();
    expect(e.locationSource).toBeUndefined();
  });
});

describe('A SHIFT BELONGS TO WHERE IT STARTED', () => {
  const open = buildKioskClockIn(person('u1'), 'e1', 1000, BRAMPTON);

  it('clocking out does not re-read the device — reconfiguring mid-shift changes nothing', () => {
    // The iPad is carried to the other shop, or the owner changes its store,
    // while somebody is still on shift. Re-reading would rewrite history.
    const out = buildKioskClockOut(open, 5000);
    expect(out.locationId).toBe(BRAMPTON);
    expect(out.locationSource).toBe('kiosk');
  });

  it('breaks belong to their shift and carry no location of their own', () => {
    const started = buildKioskStartBreak(open, 'b1', 'lunch', 2000);
    const ended = buildKioskEndBreak(started, 3000);
    expect(started.locationId).toBe(BRAMPTON);
    expect(ended.locationId).toBe(BRAMPTON);
    for (const b of ended.breaks) expect(b).not.toHaveProperty('locationId');
  });

  it('A MANAGER CORRECTION LEAVES THE STORE UNTOUCHED — it corrects times, nothing else', () => {
    const closed: TimeEntry = { ...open, clockOut: 5000 };
    const fixed = correctClockOut(closed, 9000, 'mgr-uid', 10_000, { correctedByEmail: 'mgr@shop.test' });
    expect(fixed.clockOut).toBe(9000);
    expect(fixed.locationId).toBe(BRAMPTON);
    expect(fixed.locationSource).toBe('kiosk');
    expect(fixed.corrections).toHaveLength(1);
  });
});
