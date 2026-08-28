// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SettlementReviewModal } from './SettlementReviewModal';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'd', buyerId: 'r1', item: 'iPhone 13', imei: '356789012345678', sellerName: '', sellerContact: '',
  purchasePrice: 0, paidBy: 'runner' as PaidBy, dropOffFee: 0, dateDropped: '2026-08-01',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});
const buyer: DeviceBuyer = { id: 'r1', name: 'Marcus', phone: '', notes: '' };
const dropOffs: DropOff[] = [
  d({ id: '1', item: 'iPhone 13', purchasePrice: 300, dropOffFee: 20, paidBy: 'runner' }),
  d({ id: '2', item: 'iPhone 14', purchasePrice: 500, dropOffFee: 30, paidBy: 'store' }),
];

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const baseProps = {
  buyer, dropOffs, settlementId: 'S-1', date: '2026-08-15',
  paymentMethod: 'cash' as const, notes: '', storeName: 'FlipThatTech',
  onClose: () => {},
};

describe('SettlementReviewModal', () => {
  it('shows the unedited totals and net direction on open', () => {
    const { host, unmount } = mount(<SettlementReviewModal {...baseProps} isSubmitting={false} onConfirm={() => {}} />);
    expect(host.textContent).toContain('Store pays device buyer $350.00'); // 300 fronted + 50 fees
    unmount();
  });

  it('editing a per-device fee updates the totals live', () => {
    const { host, unmount } = mount(<SettlementReviewModal {...baseProps} isSubmitting={false} onConfirm={() => {}} />);
    const feeInputs = Array.from(host.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    // First numeric input belongs to the first device line's fee (20).
    const firstFeeInput = feeInputs[0];
    expect(firstFeeInput.value).toBe('20');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(firstFeeInput, '25');
      firstFeeInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('Store pays device buyer $355.00'); // 300 + (25+30)
    unmount();
  });

  it('excluding a line updates totals and confirms with that line marked not-included', () => {
    let confirmed: any = null;
    const { host, unmount } = mount(
      <SettlementReviewModal {...baseProps} isSubmitting={false} onConfirm={(lines, adj, note) => { confirmed = { lines, adj, note }; }} />
    );
    const checkboxes = Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    // Exclude the second device (iPhone 14, store-paid, fee 30).
    act(() => { checkboxes[1].click(); });
    expect(host.textContent).toContain('Excluded — stays unsettled');
    expect(host.textContent).toContain('Store pays device buyer $320.00'); // 300 + 20, device 2 excluded

    const confirmBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Settlement')) as HTMLButtonElement;
    act(() => { confirmBtn.click(); });
    expect(confirmed.lines.find((l: any) => l.dropOffId === '2').included).toBe(false);
    expect(confirmed.lines.find((l: any) => l.dropOffId === '1').included).toBe(true);
    unmount();
  });

  it('the double-submit guard (isSubmitting) disables Confirm Settlement so a second click cannot fire', () => {
    const onConfirm = vi.fn();
    const { host, unmount } = mount(<SettlementReviewModal {...baseProps} isSubmitting={true} onConfirm={onConfirm} />);
    const confirmBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Settling…')) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    // A disabled button's click handler never fires in a real browser — this
    // is the same disabled={isSubmitting} guard pattern used everywhere else
    // in this codebase (e.g. Quick Sale's Complete Sale button).
    act(() => { confirmBtn.click(); });
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it('print preview never calls onConfirm — printing is a read-only action, not a path around the guard', () => {
    const onConfirm = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null); // no popup available in the test env — printSettlementInvoice returns false, that's fine
    const { host, unmount } = mount(<SettlementReviewModal {...baseProps} isSubmitting={false} onConfirm={onConfirm} />);
    const printBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Print Preview')) as HTMLButtonElement;
    act(() => { printBtn.click(); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
    unmount();
  });
});
