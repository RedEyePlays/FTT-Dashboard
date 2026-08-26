// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CollectBalanceModal } from './CollectBalanceModal';
import { SalesTransaction } from '../types';

// Item 1 of the layaway-completion batch requires the same double-submit
// protection as regular checkout. useSubmitGuard.test.tsx already proves the
// hook itself is safe in isolation; this proves it's actually wired into the
// real modal a cashier clicks, not just available for it to use.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const tx: SalesTransaction = {
  id: 'tx1', date: '2026-01-01', lines: [{ kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 500 }],
  subtotal: 500, tax: 0, totalPaid: 500, paymentMethod: 'cash', deposit: 100, balanceOwing: 400,
} as any;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('CollectBalanceModal double-submit protection', () => {
  it('two rapid clicks on Collect before the write resolves only fire onConfirm once', async () => {
    let resolvePayment!: (v: SalesTransaction) => void;
    const onConfirm = vi.fn(() => new Promise<SalesTransaction>(res => { resolvePayment = res; }));
    const { host, unmount } = mount(<CollectBalanceModal tx={tx} onClose={() => {}} onConfirm={onConfirm} />);

    const findCollectButton = () =>
      Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('Collect $')) as HTMLButtonElement;

    expect(findCollectButton()).toBeTruthy();

    // Both clicks land before React has a chance to re-render and disable the
    // button in between — the realistic "double-tap" failure mode.
    act(() => {
      findCollectButton().click();
      findCollectButton().click();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);

    const paid: SalesTransaction = {
      ...tx, balanceOwing: 0,
      balancePayments: [{ id: 'p1', amount: 400, paymentMethod: 'cash', date: '2026-01-01', at: Date.now() }],
    } as any;
    await act(async () => { resolvePayment(paid); });

    expect(host.textContent).toContain('collected');
    unmount();
  });

  it('a partial payment amount is clamped to the remaining balance and never exceeds it', () => {
    const onConfirm = vi.fn(() => new Promise<SalesTransaction>(() => {}));
    const { host, unmount } = mount(<CollectBalanceModal tx={tx} onClose={() => {}} onConfirm={onConfirm} />);
    const input = host.querySelector('input[type="number"]') as HTMLInputElement;
    const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setNative.call(input, '9999');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.startsWith('Collect $')) as HTMLButtonElement;
    expect(btn.textContent).toBe('Collect $400.00');
    act(() => { btn.click(); });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ amount: 400 }));
    unmount();
  });
});
