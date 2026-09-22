// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DropOffView } from './DropOffView';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus, Settlement } from '../types';

// The Drop-Offs list showed every drop-off ever taken, with a status filter
// defaulting to "All". Settled and rejected devices — closed, nothing owed —
// sat among the ones the store is still on the hook for, and the list only ever
// grew. Entries now shows the ACTIVE ones; the closed ones move to History,
// where the settled ones are grouped under the settlement that closed them.
//
// A VIEW CHANGE ONLY: nothing is deleted and nothing is migrated.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'do-1', buyerId: 'b1', item: 'iPhone 13', imei: '356789012345678', sellerName: '', sellerContact: '',
  purchasePrice: 100, paidBy: 'store' as PaidBy, dropOffFee: 20, dateDropped: '2026-08-20',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});

const settlement = (p: Partial<Settlement>): Settlement => ({
  id: 's1', buyerId: 'b1', date: '2026-08-22', periodEnd: '2026-08-22', dropOffIds: [],
  model: 'financing', totalFees: 20, amountOwed: 120, principalOwed: 100,
  paymentMethod: 'cash', ...p,
} as Settlement);

const buyers: DeviceBuyer[] = [{ id: 'b1', name: 'Marcus Webb', phone: '', notes: '' }];

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const button = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').trim() === label);
const buttonContaining = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label));

const view = (dropOffs: DropOff[], settlements: Settlement[] = []) => (
  <DropOffView deviceBuyers={buyers} dropOffs={dropOffs} settlements={settlements}
    onDeviceBuyersChange={() => {}} onDropOffsChange={() => {}} onSettle={() => {}} />
);

describe('Drop-Offs: settled and rejected move to History', () => {
  const active = d({ id: 'act', item: 'Pixel 8', status: 'accepted' });
  const settled = d({ id: 'set', item: 'Galaxy S24', status: 'settled', settlementId: 's1' });
  const rejected = d({ id: 'rej', item: 'Cracked iPad', status: 'rejected' });
  const all = [active, settled, rejected];

  it('Entries shows the ACTIVE drop-offs and none of the closed ones', () => {
    const { host, unmount } = mount(view(all, [settlement({})]));
    expect(host.textContent).toContain('Pixel 8');
    expect(host.textContent).not.toContain('Galaxy S24');
    expect(host.textContent).not.toContain('Cracked iPad');
    unmount();
  });

  it('the Entries status filter offers only the active statuses', () => {
    const { host, unmount } = mount(view(all, [settlement({})]));
    const labels = Array.from(host.querySelectorAll('button')).map(b => (b.textContent || '').trim());
    expect(labels).toContain('All active');
    expect(labels).toContain('Pending review');
    expect(labels).toContain('Accepted');
    expect(labels).toContain('Paid out');
    // Settled/Rejected are not reachable from the working list at all.
    expect(labels).not.toContain('Settled');
    expect(labels).not.toContain('Rejected');
    unmount();
  });

  it('a settled drop-off appears in History under its settlement, with the settlement details', () => {
    const { host, unmount } = mount(view(all, [settlement({ id: 's1' })]));
    click(button(host, 'History')!);

    // The settlement's own date, week ending, buyer, total and payment method.
    expect(host.textContent).toContain('2026-08-22');
    expect(host.textContent).toContain('week ending 2026-08-22');
    expect(host.textContent).toContain('Marcus Webb');
    expect(host.textContent).toContain('$120.00');
    expect(host.textContent).toContain('Cash');

    // Opening the settlement lists its devices.
    expect(host.textContent).not.toContain('Galaxy S24');
    click(buttonContaining(host, 'week ending 2026-08-22')!);
    expect(host.textContent).toContain('Galaxy S24');
    unmount();
  });

  it('re-prints the settlement slip from History, reusing the existing invoice printer', () => {
    const { host, unmount } = mount(view(all, [settlement({ id: 's1' })]));
    click(button(host, 'History')!);
    click(buttonContaining(host, 'week ending 2026-08-22')!);
    expect(buttonContaining(host, 'Print Invoice')).toBeTruthy();
    unmount();
  });

  it('a rejected drop-off appears in History, in its own section and under no settlement', () => {
    const { host, unmount } = mount(view(all, [settlement({ id: 's1' })]));
    click(button(host, 'History')!);
    expect(host.textContent).toContain('Rejected / returned (1)');
    expect(host.textContent).toContain('Cracked iPad');
    unmount();
  });

  it('an accepted drop-off stays in Entries and never appears in History', () => {
    const { host, unmount } = mount(view(all, [settlement({ id: 's1' })]));
    click(button(host, 'History')!);
    expect(host.textContent).not.toContain('Pixel 8');
    click(button(host, 'Drop-Offs')!);
    expect(host.textContent).toContain('Pixel 8');
    unmount();
  });

  it('searches History by a scanned IMEI even though the stored one has spaces', () => {
    const spaced = d({ id: 'set2', item: 'OnePlus 12', status: 'settled', settlementId: 's1', imei: '35 123456 789012 3' });
    const { host, unmount } = mount(view([settled, spaced], [settlement({ id: 's1' })]));
    click(button(host, 'History')!);
    click(buttonContaining(host, 'week ending 2026-08-22')!);
    expect(host.textContent).toContain('OnePlus 12');
    expect(host.textContent).toContain('Galaxy S24');

    const search = host.querySelector('input[placeholder^="Search IMEI"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, '351234567890123');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The group stays open across the search, so the surviving device is visible.
    expect(host.textContent).toContain('OnePlus 12');
    expect(host.textContent).not.toContain('Galaxy S24');
    unmount();
  });

  it('keeps settled drop-offs whose settlement record is missing, rather than dropping them', () => {
    const orphan = d({ id: 'orph', item: 'Legacy Phone', status: 'settled', settlementId: undefined });
    const { host, unmount } = mount(view([orphan], []));
    click(button(host, 'History')!);
    expect(host.textContent).toContain('settled before settlements were linked to devices');
    click(buttonContaining(host, '2026-08-20')!);
    expect(host.textContent).toContain('Legacy Phone');
    unmount();
  });

  it('says nothing is closed yet when there is no history at all', () => {
    const { host, unmount } = mount(view([active], []));
    click(button(host, 'History')!);
    expect(host.textContent).toContain('Nothing closed yet');
    unmount();
  });
});
