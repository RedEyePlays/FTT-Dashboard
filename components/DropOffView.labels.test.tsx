// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DropOffView } from './DropOffView';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The drop-off label prints the purchase price and the service fee — profit-
// sensitive figures — so the print actions must not exist at all for a user
// without 'dropoffs.manage' (App.tsx passes canPrintDropOffLabel(role)).
const d = (p: Partial<DropOff>): DropOff => ({
  id: 'do-1', buyerId: 'b1', item: 'iPhone 13', imei: '356789012345678', sellerName: '', sellerContact: '',
  purchasePrice: 100, paidBy: 'store' as PaidBy, dropOffFee: 20, dateDropped: '2026-08-20',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});
const buyers: DeviceBuyer[] = [{ id: 'b1', name: 'Marcus Webb', phone: '', notes: '' }];
const dropOffs = [d({}), d({ id: 'do-2', item: 'Pixel 8', status: 'pending' })];

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const props = {
  deviceBuyers: buyers, dropOffs, settlements: [],
  onDeviceBuyersChange: () => {}, onDropOffsChange: () => {}, onSettle: () => {},
};
const buttonLabels = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).map(b => b.textContent || '');

describe('drop-off label printing is gated in the UI', () => {
  it('offers a per-device Print Label action when the user may manage drop-offs', () => {
    const { host, unmount } = mount(<DropOffView {...props} canPrintLabels />);
    expect(buttonLabels(host).filter(t => t.includes('Print Label')).length).toBe(dropOffs.length);
    unmount();
  });

  it('shows no print action at all without the permission', () => {
    const { host, unmount } = mount(<DropOffView {...props} canPrintLabels={false} />);
    expect(buttonLabels(host).some(t => t.includes('Print Label'))).toBe(false);
    unmount();
  });

  it('defaults to hidden when the prop is omitted — a caller that forgets cannot leak cost figures onto paper', () => {
    const { host, unmount } = mount(<DropOffView {...props} />);
    expect(buttonLabels(host).some(t => t.includes('Print Label'))).toBe(false);
    unmount();
  });
});
