// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { LayawaysView } from './LayawaysView';
import { SalesTransaction, Customer } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mountedHtml(ui: React.ReactElement): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  const html = host.innerHTML;
  act(() => { root.unmount(); });
  host.remove();
  return html;
}

const customers: Customer[] = [{ id: 'c1', name: 'Jamie Rivera', phone: '555-0100', kind: 'retail' }];

const openLayaway: SalesTransaction = {
  id: 'tx-open', date: '2026-06-01', customerId: 'c1', customerName: 'Jamie Rivera',
  lines: [{ kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 500 }],
  subtotal: 500, tax: 0, totalPaid: 500, paymentMethod: 'cash', deposit: 100, balanceOwing: 400,
} as any;

const paidOffSale: SalesTransaction = {
  id: 'tx-paid', date: '2026-05-01', customerId: 'c1', customerName: 'Jamie Rivera',
  lines: [{ kind: 'device', name: 'iPhone 12', quantity: 1, unitPrice: 300 }],
  subtotal: 300, tax: 0, totalPaid: 300, paymentMethod: 'cash',
} as any;

const voidedLayaway: SalesTransaction = {
  id: 'tx-voided', date: '2026-04-01', customerId: 'c1', customerName: 'Jamie Rivera',
  lines: [{ kind: 'device', name: 'Pixel 7', quantity: 1, unitPrice: 400 }],
  subtotal: 400, tax: 0, totalPaid: 400, paymentMethod: 'cash', deposit: 50, balanceOwing: 350,
  status: 'voided',
} as any;

describe('LayawaysView reflects reserved (open-balance) sales, not settled or cancelled ones', () => {
  it('lists an open layaway with its customer, balance and deposit', () => {
    const html = mountedHtml(
      <LayawaysView salesTransactions={[openLayaway]} customers={customers} staleThresholdDays={60} onBack={() => {}} />
    );
    expect(html).toContain('Jamie Rivera');
    expect(html).toContain('iPhone 13');
    expect(html).toContain('$400.00');
    expect(html).toContain('$100.00');
  });

  it('omits a sale that has been fully paid off (no balanceOwing)', () => {
    const html = mountedHtml(
      <LayawaysView salesTransactions={[paidOffSale]} customers={customers} staleThresholdDays={60} onBack={() => {}} />
    );
    expect(html).toContain('No active layaways');
    expect(html).not.toContain('iPhone 12');
  });

  it('omits a voided/cancelled layaway even though balanceOwing is still set on the record', () => {
    const html = mountedHtml(
      <LayawaysView salesTransactions={[voidedLayaway]} customers={customers} staleThresholdDays={60} onBack={() => {}} />
    );
    expect(html).toContain('No active layaways');
    expect(html).not.toContain('Pixel 7');
  });

  it('flags a layaway older than the stale threshold', () => {
    const old: SalesTransaction = { ...openLayaway, id: 'tx-old', date: '2026-01-01' };
    const html = mountedHtml(
      <LayawaysView salesTransactions={[old]} customers={customers} staleThresholdDays={30} onBack={() => {}} />
    );
    expect(html).toContain('stale');
  });
});
