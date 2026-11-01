// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TimeClockView } from './TimeClockView';
import { AppUser, Location, TimeEntry } from '../types';

/**
 * THE APP PUNCH ASKS WHERE YOU ARE — multi-store stage 3.
 *
 * The kiosk is not the only way in: an employee can clock in from a laptop or
 * a phone, where no device can vouch for where they are standing. So they are
 * asked, from their own stores, with nothing pre-selected — and the answer is
 * recorded as their own claim rather than a device's evidence.
 *
 * This is deliberately the WEAKER path, which is the point of flagging it: a
 * kiosk punch is evidence, an app punch is a claim.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || '',
    click: (label: string) => {
      const b = [...host.querySelectorAll('button')].find(x => (x.textContent || '').trim() === label)
        || [...host.querySelectorAll('button')].find(x => (x.textContent || '').includes(label));
      if (!b) throw new Error(`no button matching "${label}"`);
      act(() => { (b as HTMLButtonElement).click(); });
    },
    has: (label: string) => [...host.querySelectorAll('button')].some(x => (x.textContent || '').includes(label)),
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const loc = (id: string, name: string, extra: Partial<Location> = {}): Location =>
  ({ id, name, active: true, createdAt: 1, ...extra });
const BRAMPTON = loc('brampton', 'Brampton', { isDefault: true });
const MISS = loc('mississauga', 'Mississauga');

const me = (p: Partial<AppUser> = {}): AppUser =>
  ({ id: 'u1', email: 'alice@shop.test', role: 'employee', workspaceId: 'ws', hourlyRate: 20, ...p } as AppUser);

const screen = (opts: {
  user?: AppUser; locations?: Location[]; entries?: TimeEntry[]; onClockIn?: (id?: string) => void;
  users?: AppUser[]; canManagePayroll?: boolean;
} = {}) => {
  const onClockIn = opts.onClockIn || vi.fn();
  return {
    onClockIn,
    el: (
      <TimeClockView
        me={opts.user || me()} users={opts.users || [opts.user || me()]} entries={opts.entries || []}
        payPeriods={[]} payPeriodApprovals={[]} payCycle="biweekly" payAnchorISO="2026-01-05"
        canManagePayroll={!!opts.canManagePayroll} canMarkPaid={false}
        locations={opts.locations ?? [BRAMPTON, MISS]}
        onClockIn={onClockIn} onClockOut={vi.fn()} onStartBreak={vi.fn()} onEndBreak={vi.fn()}
        onApprovePeriod={vi.fn()} onApproveAllPeriod={vi.fn()} onMarkPaid={vi.fn()} onUnmarkPaid={vi.fn()}
        onCorrectClockOut={vi.fn()}
      />
    ),
  };
};

describe('clocking in from the app', () => {
  it('ASKS WHICH STORE, instead of punching straight away', () => {
    const { el, onClockIn } = screen({ user: me({ locationIds: ['brampton', 'mississauga'] }) });
    const v = mount(el);
    v.click('Clock In');
    expect(onClockIn).not.toHaveBeenCalled();
    expect(v.text()).toContain('Which store are you at?');
    v.unmount();
  });

  it('OFFERS ONLY THE STORES THAT PERSON WORKS AT', () => {
    const v = mount(screen({ user: me({ locationIds: ['mississauga'] }) }).el);
    v.click('Clock In');
    expect(v.has('Mississauga')).toBe(true);
    expect(v.has('Brampton')).toBe(false);
    v.unmount();
  });

  it('NOTHING IS PRE-SELECTED — the punch only happens when a store is tapped', () => {
    const { el, onClockIn } = screen({ user: me({ locationIds: ['brampton', 'mississauga'] }) });
    const v = mount(el);
    v.click('Clock In');
    expect(onClockIn).not.toHaveBeenCalled();
    v.click('Mississauga');
    expect(onClockIn).toHaveBeenCalledWith('mississauga');
    v.unmount();
  });

  it('A PERSON WITH ONE STORE IS STILL ASKED', () => {
    // Consistency over the saved tap — it is what keeps the self-selected
    // flag meaning "they chose it".
    const { el, onClockIn } = screen({ user: me({ locationIds: ['brampton'] }) });
    const v = mount(el);
    v.click('Clock In');
    expect(v.text()).toContain('Which store are you at?');
    expect(onClockIn).not.toHaveBeenCalled();
    v.unmount();
  });

  it('says the answer is recorded against them and cannot be changed after', () => {
    const v = mount(screen().el);
    v.click('Clock In');
    expect(v.text()).toMatch(/can.t be changed afterwards/i);
    v.unmount();
  });

  it('cancelling punches nothing', () => {
    const { el, onClockIn } = screen();
    const v = mount(el);
    v.click('Clock In');
    v.click('Cancel');
    expect(onClockIn).not.toHaveBeenCalled();
    expect(v.text()).not.toContain('Which store are you at?');
    v.unmount();
  });

  it('a workspace with no stores punches immediately, exactly as before', () => {
    const { el, onClockIn } = screen({ locations: [] });
    const v = mount(el);
    v.click('Clock In');
    expect(onClockIn).toHaveBeenCalledWith();
    v.unmount();
  });
});

describe('an open shift says where it is being recorded', () => {
  const open = (p: Partial<TimeEntry> = {}): TimeEntry => ({
    id: 'e1', userId: 'u1', clockIn: Date.now() - 3_600_000, breaks: [], ...p,
  });

  it('names the store, and whether the person chose it', () => {
    const v = mount(screen({
      entries: [open({ locationId: 'mississauga', locationSource: 'self_selected' })],
    }).el);
    expect(v.text()).toContain('Recording at Mississauga');
    expect(v.text()).toContain('you chose this');
    v.unmount();
  });

  it('a kiosk punch is not labelled as chosen — a device vouched for it', () => {
    const v = mount(screen({
      entries: [open({ locationId: 'brampton', locationSource: 'kiosk', source: 'kiosk' })],
    }).el);
    expect(v.text()).toContain('Recording at Brampton');
    expect(v.text()).not.toContain('you chose this');
    v.unmount();
  });

  it('CLOCKING OUT DOES NOT RE-ASK — a shift belongs to where it started', () => {
    const { el, onClockIn } = screen({ entries: [open({ locationId: 'brampton', locationSource: 'kiosk' })] });
    const v = mount(el);
    expect(v.has('Clock Out')).toBe(true);
    expect(v.has('Clock In')).toBe(false);
    v.click('Clock Out');
    expect(v.text()).not.toContain('Which store are you at?');
    expect(onClockIn).not.toHaveBeenCalled();
    v.unmount();
  });

  it('a historical shift with no store says nothing about stores', () => {
    const v = mount(screen({ entries: [open()] }).el);
    expect(v.text()).not.toContain('Recording at');
    v.unmount();
  });
});

/* ---------------- At payroll ---------------- */

describe('what the owner sees at payroll', () => {
  const owner = me({ id: 'u1', email: 'owner@shop.test', role: 'owner' });
  const HOUR = 3_600_000;
  // Shifts inside the current period, in both shops.
  const shift = (p: Partial<TimeEntry>): TimeEntry => ({
    id: `e${Math.random()}`, userId: 'u1',
    clockIn: Date.now() - 6 * HOUR, clockOut: Date.now() - 2 * HOUR, breaks: [], ...p,
  });

  it('FLAGS PUNCHES THE PERSON PICKED THE STORE OF — beside missed clock-outs, not in a tooltip', () => {
    const v = mount(screen({
      user: owner, canManagePayroll: true,
      entries: [shift({ locationId: 'mississauga', locationSource: 'self_selected' })],
    }).el);
    expect(v.text()).toMatch(/picked their own store/i);
    expect(v.text()).toMatch(/punched in the app, not at a shop iPad/i);
    v.unmount();
  });

  it('does NOT flag a kiosk punch — a device vouched for that one', () => {
    const v = mount(screen({
      user: owner, canManagePayroll: true,
      entries: [shift({ locationId: 'brampton', locationSource: 'kiosk', source: 'kiosk' })],
    }).el);
    expect(v.text()).not.toMatch(/picked their own store/i);
    v.unmount();
  });

  it('and does not flag HISTORY, which nobody chose', () => {
    // A backfilled location is not a self-selected one. If this ever flips,
    // every shift the shop ever worked reads as staff-chosen.
    const v = mount(screen({
      user: owner, canManagePayroll: true,
      entries: [shift({ locationId: 'brampton' })],
    }).el);
    expect(v.text()).not.toMatch(/picked their own store/i);
    v.unmount();
  });

  it('BREAKS THE PERIOD DOWN BY STORE, and says pay is still per person', () => {
    const v = mount(screen({
      user: owner, canManagePayroll: true,
      entries: [
        shift({ locationId: 'brampton', locationSource: 'kiosk' }),
        shift({ locationId: 'mississauga', locationSource: 'kiosk' }),
      ],
    }).el);
    expect(v.text()).toContain('Wage cost by store');
    expect(v.text()).toMatch(/appears in both and is still paid once/i);
    v.unmount();
  });

  it('offers one store or both', () => {
    const v = mount(screen({ user: owner, canManagePayroll: true }).el);
    expect(v.text()).toContain('Hours at');
    expect(v.has('All stores')).toBe(true);
    expect(v.has('Brampton')).toBe(true);
    v.unmount();
  });

  it('a single-store workspace gets none of it', () => {
    const v = mount(screen({ user: owner, canManagePayroll: true, locations: [] }).el);
    expect(v.text()).not.toContain('Hours at');
    expect(v.text()).not.toContain('Wage cost by store');
    v.unmount();
  });
});
