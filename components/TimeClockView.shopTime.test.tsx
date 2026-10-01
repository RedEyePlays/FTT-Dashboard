// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TimeClockView } from './TimeClockView';
import { fromZonedInput, timeInZone, isoDateInZone } from '../domain/shopTime';
import { AppUser, TimeEntry } from '../types';

/**
 * THE SCREEN AS THE OWNER ACTUALLY SAW IT.
 *
 * The domain tests in domain/shiftCorrection.test.ts prove the conversion. This
 * one proves the SCREEN uses it — that the rendered rows say shop time, that
 * the zone is named on the page, and that the wrench now renders on a shift
 * that already has a clock-out.
 *
 * THE DEVICE ZONE IS PINNED AWAY FROM THE SHOP'S. The test runner's own
 * timezone is whatever CI decides (UTC here), so the shop zone is chosen at
 * runtime to be one that definitely reads differently, and both readings are
 * computed rather than hardcoded. A test that asserted "13:22" while the
 * runner happened to sit in Toronto would prove nothing at all.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || '',
    host,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** A shop zone that definitely disagrees with whatever the runner is using. */
const SHOP_ZONE = DEVICE_ZONE === 'Asia/Dubai' ? 'America/Toronto' : 'Asia/Dubai';

const owner: AppUser = { id: 'o1', email: 'owner@shop.test', role: 'owner', workspaceId: 'ws' };
const staff: AppUser = { id: 'u3', email: 'sanchit@shop.test', role: 'employee', workspaceId: 'ws', hourlyRate: 17 };

/** Sanchit's shift: CLOSED, and wrong — 20.94 h against a real 6.5. */
const closedWrong = (): TimeEntry => ({
  id: 'sanchit', userId: 'u3', breaks: [],
  clockIn: fromZonedInput('2026-09-29T09:00', SHOP_ZONE),
  clockOut: fromZonedInput('2026-09-30T05:56', SHOP_ZONE),
});


/**
 * Point the Daily Hours range at one shop date.
 *
 * The pickers default to the shop's TODAY, so a fixture shift from any other
 * day renders no rows at all until the range is moved — which is a property of
 * the screen, not of the fixture.
 */
function selectDate(host: HTMLElement, isoDate: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  const inputs = [...host.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
  for (const input of inputs) {
    act(() => {
      setter.call(input, isoDate);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

const SHIFT_DATE = isoDateInZone(fromZonedInput('2026-09-29T09:00', SHOP_ZONE), SHOP_ZONE);

const noop = () => {};
const view = (entries: TimeEntry[], extra: Record<string, unknown> = {}) => (
  <TimeClockView
    me={owner} users={[owner, staff]} entries={entries}
    payPeriods={[]} payPeriodApprovals={[]}
    payCycle="biweekly" payAnchorISO="2024-01-01"
    canManagePayroll canMarkPaid
    onClockIn={noop} onClockOut={noop} onStartBreak={noop} onEndBreak={noop}
    onApprovePeriod={noop} onApproveAllPeriod={noop} onMarkPaid={noop} onUnmarkPaid={noop}
    onCorrectClockOut={noop}
    shopTimeZone={SHOP_ZONE}
    {...extra}
  />
);

describe('the Time Clock screen shows SHOP time', () => {
  it('renders the clock-in in shop time, not the device\'s', () => {
    const e = closedWrong();
    const shopReads = timeInZone(e.clockIn, SHOP_ZONE);       // e.g. "09:00"
    const deviceReads = timeInZone(e.clockIn, DEVICE_ZONE);   // something else
    expect(shopReads).not.toBe(deviceReads);                  // the premise of the test

    const m = mount(view([e]));
    try {
      selectDate(m.host, SHIFT_DATE);
      // The rendered row carries the shop reading. (Rendered 12-hour, so
      // compare on the parts rather than the exact string.)
      const [h, min] = shopReads.split(':').map(Number);
      const twelve = `${((h + 11) % 12) + 1}:${String(min).padStart(2, '0')}`;
      expect(m.text()).toContain(twelve);
    } finally { m.unmount(); }
  });

  it('names the zone on the page, so a reader abroad knows whose clock it is', () => {
    const m = mount(view([closedWrong()]));
    try {
      expect(m.text()).toContain('all times in shop time');
      expect(m.text()).toMatch(/Dubai|Toronto/);
    } finally { m.unmount(); }
  });

  it('DATES the shift by the shop\'s day even when the device is on another one', () => {
    // An evening shop shift that has already rolled over to tomorrow on the
    // device — the case that made the heading and the correction box look
    // like they contradicted each other.
    const evening: TimeEntry = {
      id: 'ev', userId: 'u3', breaks: [],
      clockIn: fromZonedInput('2026-09-29T20:00', SHOP_ZONE),
      clockOut: fromZonedInput('2026-09-29T22:00', SHOP_ZONE),
    };
    const shopDate = isoDateInZone(evening.clockIn, SHOP_ZONE);
    const deviceDate = isoDateInZone(evening.clockIn, DEVICE_ZONE);

    const m = mount(view([evening], { longShiftHours: 24 }));
    try {
      selectDate(m.host, shopDate);
      const from = m.host.querySelector('input[type="date"]') as HTMLInputElement;
      // Selecting its SHOP date brings the row into range — on the device's
      // date it would not be there at all.
      expect(from.value).toBe(shopDate);
      // And the row reads shop time: 8 PM in the shop, whatever the device says.
      const shopClockIn = timeInZone(evening.clockIn, SHOP_ZONE);
      const [h] = shopClockIn.split(':').map(Number);
      expect(m.text()).toContain(`${((h + 11) % 12) + 1}:00`);

      // Widen the range by a day so the Date column appears (it is hidden for
      // a single day), and assert that cell carries the SHOP date rather than
      // the device's — the two differ for this instant.
      const dayBefore = isoDateInZone(evening.clockIn - 24 * 3600_000, SHOP_ZONE);
      const inputs = [...m.host.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(inputs[0], dayBefore);
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(m.text()).toContain(shopDate);
      if (shopDate !== deviceDate) expect(m.text()).not.toContain(deviceDate);
    } finally { m.unmount(); }
  });
});

describe('a closed shift offers the correction control', () => {
  it('renders a wrench for a shift that ALREADY has a clock-out', () => {
    // This is Gap 1: the control used to render only for an open or missed
    // shift, so this row was frozen in the UI however wrong it was.
    const m = mount(view([closedWrong()]));
    try {
      selectDate(m.host, SHIFT_DATE);
      const wrenches = m.host.querySelectorAll('button[title="Correct this clock-out"]');
      expect(wrenches.length).toBe(1);
    } finally { m.unmount(); }
  });

  it('the fixer says the shift already has a clock-out, and in which zone', () => {
    const m = mount(view([closedWrong()]));
    try {
      selectDate(m.host, SHIFT_DATE);
      const wrench = m.host.querySelector('button[title="Correct this clock-out"]') as HTMLButtonElement;
      act(() => { wrench.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const text = m.text();
      expect(text).toContain('already has a clock-out');
      // The input's own label states the zone it expects — half-converting
      // this is worse than not converting it.
      expect(text).toMatch(/\(shop\) time/);
      const input = m.host.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      // Pre-filled with the existing clock-out AS SHOP WALL-CLOCK TIME.
      expect(input.value).toBe(`${isoDateInZone(closedWrong().clockOut!, SHOP_ZONE)}T${timeInZone(closedWrong().clockOut!, SHOP_ZONE)}`);
    } finally { m.unmount(); }
  });

  it('flags the 20.94 h shift as long, without blocking anything', () => {
    const m = mount(view([closedWrong()]));
    try {
      const text = m.text();
      expect(text).toMatch(/over 14 h/);
      // Informational: there is no disabled approve control as a result of it.
      expect(text).toContain('check before payout');
    } finally { m.unmount(); }
  });

  it('does NOT flag an ordinary shift', () => {
    const fine: TimeEntry = {
      id: 'ok', userId: 'u3', breaks: [],
      clockIn: fromZonedInput('2026-09-29T09:00', SHOP_ZONE),
      clockOut: fromZonedInput('2026-09-29T15:30', SHOP_ZONE),
    };
    const m = mount(view([fine]));
    try {
      expect(m.text()).not.toMatch(/over 14 h/);
    } finally { m.unmount(); }
  });
});
