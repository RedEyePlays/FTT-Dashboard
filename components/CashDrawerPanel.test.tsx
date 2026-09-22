// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CashDrawerPanel } from './CashDrawerPanel';
import { CashDrawerSummary } from '../domain/reports';

/**
 * "Whenever I close the drawer, the amount in the drawer doesn't update."
 *
 * The panel rendered `summary.expected` unconditionally, so after the day was
 * counted and closed it kept showing the live running figure. Closing looked
 * like it had done nothing at all.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || '',
    render: (next: React.ReactElement) => { act(() => root.render(next)); },
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const summary = (p: Partial<CashDrawerSummary> = {}): CashDrawerSummary => ({
  opened: true, openingFloat: 200, cashSales: 1800, cashIn: 0, cashOut: 0,
  withdrawals: 0, expected: 2000, closed: false, countedCash: null,
  leftInDrawer: null, removedAtClose: 0, variance: 0, ...p,
});

const noop = () => {};
const panel = (s: CashDrawerSummary, extra: Record<string, unknown> = {}) =>
  <CashDrawerPanel summary={s} onOpenDrawer={noop} onLog={noop} {...extra} />;

describe('CashDrawerPanel', () => {
  it('shows the live expected figure while the day is open', () => {
    const m = mount(panel(summary()));
    expect(m.text()).toContain('Expected in drawer');
    expect(m.text()).toContain('$2000.00');
    m.unmount();
  });

  it('SHOWS THE CLOSED STATE once the day is closed, not the live figure', () => {
    const m = mount(panel(summary({
      closed: true, countedCash: 2000, leftInDrawer: 200, removedAtClose: 1800,
    })));
    const t = m.text();
    expect(t).toContain('Counted at close');
    expect(t).not.toContain('Expected in drawer');
    expect(t).toContain('counted $2000.00');
    expect(t).toContain('left $200.00 for tomorrow');
    expect(t).toContain('taken out $1800.00');
    m.unmount();
  });

  it('names a variance as short or over, and says nothing when it balanced', () => {
    const m = mount(panel(summary({ closed: true, countedCash: 1990, leftInDrawer: 200, variance: -10 })));
    expect(m.text()).toContain('short $10.00');

    m.render(panel(summary({ closed: true, countedCash: 2015, leftInDrawer: 200, variance: 15 })));
    expect(m.text()).toContain('over $15.00');

    m.render(panel(summary({ closed: true, countedCash: 2000, leftInDrawer: 200, variance: 0 })));
    expect(m.text()).not.toMatch(/short|over/);
    m.unmount();
  });

  it('offers "Correct today\'s float" only with the owner action, and only while open', () => {
    const m = mount(panel(summary(), { onCorrectFloat: noop }));
    expect(m.text()).toContain("Correct today's float");

    // Not offered to anyone without the action (App gates it to the owner).
    m.render(panel(summary()));
    expect(m.text()).not.toContain("Correct today's float");

    // And not on a day already closed — there is no live float to fix.
    m.render(panel(summary({ closed: true, countedCash: 2000, leftInDrawer: 200 }), { onCorrectFloat: noop }));
    expect(m.text()).not.toContain("Correct today's float");
    m.unmount();
  });
});
