// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TimeClockView } from './TimeClockView';
import { AppUser, StaffBonus, TimeEntry } from '../types';
import { resolveBonusPeriod } from '../domain/bonuses';
import { payPeriodsForUser } from '../domain/payGroups';
import { toISODate } from '../domain/timeclock';

/**
 * THE DIALOG SAYS WHERE THE MONEY IS GOING, BEFORE IT GOES.
 *
 * The resolution itself is pinned in domain/bonusPeriod.test.ts. This proves
 * the SCREEN uses it: that the dialog states the resolved period as soon as a
 * date is entered, that it changes when the date changes, and — the bug — that
 * what gets saved follows the DATE and not the period the owner happened to be
 * looking at.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ANCHOR = '2026-01-05';
const CYCLE = 'biweekly' as const;

const owner: AppUser = { id: 'o1', email: 'owner@shop.test', role: 'owner', workspaceId: 'ws' };
const staff: AppUser = {
  id: 'u1', email: 'sam@shop.test', role: 'employee', workspaceId: 'ws',
  hourlyRate: 20, payGroup: 'A',
};

/**
 * The current period and the one before it, derived from REAL today.
 *
 * The component reads its own clock (useNow), so hardcoded fixture dates would
 * drift out of the periods it actually renders — and a test pinned to a month
 * that is not the current one proves nothing about the screen.
 */
const periods = payPeriodsForUser(staff, Date.now(), CYCLE, ANCHOR, 4).map(p => toISODate(p.start));
const CURRENT = periods[0];
const ENDED = periods[1];
/** A day inside each, for typing into the date field. */
const IN_CURRENT = CURRENT;
const IN_ENDED = ENDED;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || '',
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const setValue = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const noop = () => {};

interface Saved { bonus?: Omit<StaffBonus, 'id' | 'createdBy' | 'createdByEmail' | 'createdAt'> }

const view = (saved: Saved, entries: TimeEntry[] = []) => (
  <TimeClockView
    me={owner} users={[owner, staff]} entries={entries}
    payPeriods={[]} payPeriodApprovals={[]}
    payCycle={CYCLE} payAnchorISO={ANCHOR}
    canManagePayroll canMarkPaid
    onClockIn={noop} onClockOut={noop} onStartBreak={noop} onEndBreak={noop}
    onApprovePeriod={noop} onApproveAllPeriod={noop} onMarkPaid={noop} onUnmarkPaid={noop}
    onCorrectClockOut={noop}
    canAddBonus
    staffBonuses={[]}
    onSaveBonus={b => { saved.bonus = b; }}
  />
);

/**
 * Open the bonus dialog for SAM and hand back its fields.
 *
 * Scoped to the modal rather than the whole screen: Daily Hours has its own
 * date inputs, and a bare `input[type="date"]` lookup finds those instead.
 */
function openDialog(host: HTMLElement) {
  // The "+ Bonus" button on sam's row — the owner has one too.
  const rows = [...host.querySelectorAll('tr')];
  const samRow = rows.find(r => /sam/.test(r.textContent || ''));
  expect(samRow, 'no row for sam').toBeTruthy();
  const trigger = [...samRow!.querySelectorAll('button')]
    .find(b => /bonus/i.test(b.textContent || '')) as HTMLButtonElement | undefined;
  expect(trigger, 'no bonus button on sam\'s row').toBeTruthy();
  act(() => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

  const dialog = host.querySelector('.z-\\[70\\]') as HTMLElement | null;
  expect(dialog, 'bonus dialog did not open').toBeTruthy();
  expect(dialog!.textContent).toMatch(/Bonus for sam/);
  return {
    dialog: dialog!,
    dateInput: dialog!.querySelector('input[type="date"]') as HTMLInputElement,
    amount: dialog!.querySelector('input[type="number"]') as HTMLInputElement,
    reason: dialog!.querySelector('input:not([type])') as HTMLInputElement,
    text: () => dialog!.textContent || '',
    button: (re: RegExp) => [...dialog!.querySelectorAll('button')]
      .find(b => re.test(b.textContent || '')) as HTMLButtonElement,
    checkbox: () => dialog!.querySelector('input[type="checkbox"]') as HTMLInputElement,
  };
}

describe('the bonus dialog', () => {
  it('sanity: the fixture has two adjacent periods to confuse', () => {
    expect(CURRENT).not.toBe(ENDED);
    expect(ENDED < CURRENT).toBe(true);
  });

  it('STATES THE RESOLVED PERIOD, and updates it when the date changes', () => {
    const saved: Saved = {};
    const m = mount(view(saved));
    try {
      const f = openDialog(m.host);

      setValue(f.dateInput, IN_CURRENT);
      const inCurrent = resolveBonusPeriod(staff, IN_CURRENT, CYCLE, ANCHOR);
      expect(f.text()).toContain(`Counts in the pay period ${inCurrent.periodStart}`);

      // Change the date to the ENDED period — the stated period must follow.
      setValue(f.dateInput, IN_ENDED);
      const inEnded = resolveBonusPeriod(staff, IN_ENDED, CYCLE, ANCHOR);
      expect(inEnded.periodStart).not.toBe(inCurrent.periodStart);
      expect(f.text()).toContain(`Counts in the pay period ${inEnded.periodStart}`);
      expect(f.text()).not.toContain(`Counts in the pay period ${inCurrent.periodStart}`);
    } finally { m.unmount(); }
  });

  it('SAVES AGAINST THE DATE\'S PERIOD, not the one being viewed', () => {
    // The bug, end to end: the summary is on the current period and the owner
    // types a date inside the one that already closed.
    const saved: Saved = {};
    const m = mount(view(saved));
    try {
      const f = openDialog(m.host);
      setValue(f.amount, '60');
      setValue(f.reason, 'busy Saturday');
      setValue(f.dateInput, IN_ENDED);

      const add = f.button(/add bonus/i);
      expect(add).toBeTruthy();
      act(() => { add.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      const expected = resolveBonusPeriod(staff, IN_ENDED, CYCLE, ANCHOR).periodStart;
      expect(saved.bonus).toBeTruthy();
      expect(saved.bonus!.date).toBe(IN_ENDED);
      expect(saved.bonus!.payPeriodStart).toBe(expected);
      expect(saved.bonus!.payPeriodStart).not.toBe(CURRENT);
      expect(saved.bonus!.amount).toBe(60);
    } finally { m.unmount(); }
  });

  it('says out loud when the date lands outside the period being viewed', () => {
    const saved: Saved = {};
    const m = mount(view(saved));
    try {
      const f = openDialog(m.host);
      setValue(f.dateInput, IN_ENDED);
      // The case that used to pass in silence.
      expect(f.text()).toMatch(/not the period you were viewing/);
      // And not shouted when the two agree.
      setValue(f.dateInput, IN_CURRENT);
      expect(f.text()).not.toMatch(/not the period you were viewing/);
    } finally { m.unmount(); }
  });

  it('UNTICKING ATTACH saves a standalone bonus and hides the period line', () => {
    const saved: Saved = {};
    const m = mount(view(saved));
    try {
      const f = openDialog(m.host);
      setValue(f.amount, '25');
      setValue(f.reason, 'paid on the side');
      setValue(f.dateInput, IN_ENDED);
      expect(f.text()).toMatch(/Counts in the pay period/);

      const tick = f.checkbox();
      expect(tick).toBeTruthy();
      act(() => { tick.click(); });
      // No period is claimed, so none is stated.
      expect(f.text()).not.toMatch(/Counts in the pay period/);

      act(() => { f.button(/add bonus/i).dispatchEvent(new MouseEvent('click', { bubbles: true })); });

      expect(saved.bonus).toBeTruthy();
      expect(saved.bonus!.payPeriodStart).toBeUndefined();
    } finally { m.unmount(); }
  });
});

describe('the review strip flags a mismatched bonus', () => {
  /** Dated in the ended period, filed against the current one — the saved bug. */
  const wrong: StaffBonus = {
    id: 'bad', userId: 'u1', userEmail: 'sam@shop.test', amount: 60,
    date: IN_ENDED, reason: 'busy Saturday', paidFrom: 'store_cash',
    payPeriodStart: CURRENT, createdBy: 'o1', createdAt: 1,
  };

  /**
   * One shift inside the current period, so there is something to approve.
   * With no hours the Approve control is not rendered at all and the test
   * below would pass without proving anything.
   */
  const shift: TimeEntry = {
    id: 'e1', userId: 'u1', breaks: [],
    clockIn: new Date(`${CURRENT}T09:00:00`).getTime(),
    clockOut: new Date(`${CURRENT}T17:00:00`).getTime(),
  };

  const withBonuses = (bonuses: StaffBonus[]) => (
    <TimeClockView
      me={owner} users={[owner, staff]} entries={[shift]}
      payPeriods={[]} payPeriodApprovals={[]}
      payCycle={CYCLE} payAnchorISO={ANCHOR}
      canManagePayroll canMarkPaid
      onClockIn={noop} onClockOut={noop} onStartBreak={noop} onEndBreak={noop}
      onApprovePeriod={noop} onApproveAllPeriod={noop} onMarkPaid={noop} onUnmarkPaid={noop}
      onCorrectClockOut={noop}
      staffBonuses={bonuses}
    />
  );

  it('names it, and says nothing has been changed', () => {
    const m = mount(withBonuses([wrong]));
    try {
      const text = m.text();
      expect(text).toMatch(/1 bonus counted in a period its date does not fall in/);
      expect(text).toMatch(new RegExp(`dated ${IN_ENDED}`));
      expect(text).toMatch(/Nothing has been changed/);
      // The remedy is stated, since a silent rewrite is not on offer.
      expect(text).toMatch(/delete it and add it again/);
    } finally { m.unmount(); }
  });

  it('DOES NOT BLOCK APPROVAL — the Approve control is still live', () => {
    const m = mount(withBonuses([wrong]));
    try {
      const approve = [...m.host.querySelectorAll('button')]
        .filter(b => /^approve/i.test((b.textContent || '').trim()));
      expect(approve.length).toBeGreaterThan(0);
      expect(approve.some(b => (b as HTMLButtonElement).disabled)).toBe(false);
    } finally { m.unmount(); }
  });

  it('says nothing when every bonus agrees with its date', () => {
    const right: StaffBonus = { ...wrong, id: 'ok', date: IN_CURRENT, payPeriodStart: CURRENT };
    const m = mount(withBonuses([right]));
    try {
      expect(m.text()).not.toMatch(/period its date does not fall in/);
    } finally { m.unmount(); }
  });
});

describe('the date the dialog opens on', () => {
  /**
   * The dropdown's period has exactly one job left: seeding this default.
   * Clicking "+ Bonus" on a past period's row means "a bonus for that period",
   * so it must not open on today — today now resolves to the CURRENT period,
   * which would make the obvious action do the surprising thing.
   */
  const selectPeriod = (host: HTMLElement, index: number) => {
    // The period picker is a <select>, not a row of buttons.
    const picker = host.querySelector('select') as HTMLSelectElement;
    expect(picker, 'no period picker').toBeTruthy();
    expect(picker.options.length).toBeGreaterThan(1);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(picker, picker.options[index].value);
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return picker;
  };

  it('opens on TODAY while the current period is selected', () => {
    const m = mount(view({}));
    try {
      const f = openDialog(m.host);
      expect(f.dateInput.value).toBe(toISODate(Date.now()));
      // Which is inside the selected period, so no "different period" note.
      expect(f.text()).not.toMatch(/not the period you were viewing/);
    } finally { m.unmount(); }
  });

  it('opens INSIDE a past period when that row is the one selected', () => {
    const m = mount(view({}));
    try {
      selectPeriod(m.host, 1);          // the period before the current one
      const f = openDialog(m.host);
      // Not today — a date inside the period whose row was clicked, so the
      // common case needs no typing.
      expect(f.dateInput.value).toBe(ENDED);
      expect(f.dateInput.value).not.toBe(toISODate(Date.now()));
      expect(f.text()).toContain(`Counts in the pay period ${ENDED}`);
      expect(f.text()).not.toMatch(/not the period you were viewing/);
    } finally { m.unmount(); }
  });

  it('and saving from there files it against THAT period', () => {
    const saved: Saved = {};
    const m = mount(view(saved));
    try {
      selectPeriod(m.host, 1);
      const f = openDialog(m.host);
      setValue(f.amount, '40');
      setValue(f.reason, 'covered a shift');
      act(() => { f.button(/add bonus/i).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(saved.bonus!.date).toBe(ENDED);
      expect(saved.bonus!.payPeriodStart).toBe(ENDED);
    } finally { m.unmount(); }
  });
});
