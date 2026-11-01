// @vitest-environment happy-dom
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CashDrawerPanel } from './CashDrawerPanel';
import { StorePicker } from './StorePicker';
import { CashDrawerSummary } from '../domain/reports';
import { Location } from '../types';

/**
 * EVERY CASH SCREEN NAMES ITS STORE.
 *
 * Multi-store stage 2. Each cash screen now shows ONE store's drawer, and the
 * screens are otherwise identical to the single-shop ones they replace. A
 * figure with no store against it is the figure that gets counted into the
 * wrong day — somebody standing in Mississauga closing Brampton's drawer
 * because nothing on screen said which it was. So the naming is a
 * requirement, pinned here two ways:
 *
 *  • rendered: the register panel actually puts the name on screen;
 *  • structural: every cash surface renders the shared badge or banner, so a
 *    new one cannot be added without it, and an existing one cannot quietly
 *    drop it.
 *
 * And nothing is named in a SINGLE-STORE workspace: a shop with one shop is
 * not made clearer by being told it is in its only shop.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || '',
    html: () => host.innerHTML,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const summary = (p: Partial<CashDrawerSummary> = {}): CashDrawerSummary => ({
  opened: true, openingFloat: 200, cashSales: 1800, cashIn: 0, cashOut: 0,
  withdrawals: 0, expected: 2000, closed: false, countedCash: null,
  leftInDrawer: null, removedAtClose: 0, variance: 0, ...p,
});

const noop = () => {};

describe('the register panel', () => {
  it('names the store beside the drawer total', () => {
    const v = mount(<CashDrawerPanel summary={summary()} storeLabel="Mississauga" onOpenDrawer={noop} onLog={noop} />);
    expect(v.text()).toContain('Mississauga');
    expect(v.text()).toContain('$2000.00');
    v.unmount();
  });

  it('says nothing about stores when there is only one shop', () => {
    const v = mount(<CashDrawerPanel summary={summary()} onOpenDrawer={noop} onLog={noop} />);
    expect(v.text()).toContain('$2000.00');
    expect(v.text()).not.toMatch(/store/i);
    v.unmount();
  });
});

describe('the store picker in the header', () => {
  const loc = (id: string, name: string): Location => ({ id, name, active: true, createdAt: 1 });
  const brampton = loc('brampton', 'Brampton');
  const miss = loc('mississauga', 'Mississauga');

  it('is a read-only badge for somebody who works one store', () => {
    const v = mount(<StorePicker active={brampton} permitted={[brampton]} onPick={noop} />);
    expect(v.text()).toContain('Brampton');
    expect(v.html()).not.toContain('<select');
    v.unmount();
  });

  it('is a picker for somebody who works both — the owner can switch', () => {
    const v = mount(<StorePicker active={brampton} permitted={[brampton, miss]} onPick={noop} />);
    expect(v.html()).toContain('<select');
    expect(v.text()).toContain('Brampton');
    expect(v.text()).toContain('Mississauga');
    v.unmount();
  });

  it('OFFERS ONLY PERMITTED STORES — switching is not a way to reach another till', () => {
    const v = mount(<StorePicker active={miss} permitted={[miss]} onPick={noop} />);
    expect(v.text()).not.toContain('Brampton');
    v.unmount();
  });

  it('renders nothing at all in a workspace with no store list', () => {
    const v = mount(<StorePicker active={undefined} permitted={[]} onPick={noop} />);
    expect(v.html()).toBe('');
    v.unmount();
  });
});

describe('STRUCTURAL: no cash surface is left unnamed', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  // Every screen or dialog that shows, counts or moves till cash.
  const CASH_SURFACES = [
    'components/CashDrawerPanel.tsx',   // the register
    'components/OpenDrawerModal.tsx',   // setting the float
    'components/LogCashMovementModal.tsx',
    'components/CloseDrawerModal.tsx',  // counting it
    'components/CorrectFloatModal.tsx', // owner-only float correction
    'components/CloseOutView.tsx',      // the end-of-night card
    'components/ReportsView.tsx',       // the cash tab + Day History
  ];

  it('each one renders the shared store badge or banner', () => {
    const missing = CASH_SURFACES.filter(f => !/<Store(Tag|Banner)\s/.test(src(f)));
    expect(missing).toEqual([]);
  });

  it('each one takes the label as a prop rather than deciding for itself', () => {
    // A screen that resolved the store itself could resolve a different one
    // from the drawer it is showing — which is the whole failure.
    const missing = CASH_SURFACES.filter(f => !/storeLabel\??:\s*string/.test(src(f)));
    expect(missing).toEqual([]);
  });

  it('App.tsx passes ONE resolved label to every one of them', () => {
    const app = src('App.tsx');
    // One source of truth for "whose till" — the active-store block.
    expect(app).toMatch(/const storeLabel = activeLocationId \? locationName\(locations, activeLocationId\) : '';/);
    // And it reaches each surface. CloseOutView/QuickSaleView/DropOffView/
    // ReportsView plus the four dialogs: nine sites at the time of writing,
    // so the count is a floor rather than an exact number.
    expect((app.match(/storeLabel=\{storeLabel\}/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it('the badge renders nothing without a label, so a single-store shop sees none of this', () => {
    expect(src('components/StoreTag.tsx')).toMatch(/if \(!storeLabel\) return null;/);
  });
});
