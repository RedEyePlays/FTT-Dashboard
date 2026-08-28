import { describe, it, expect } from 'vitest';
import { settlementInvoiceHtml } from './settlementInvoice';
import { buildSettlementFromReview, initSettlementReview } from '../domain/dropoffs';
import { DropOff, Runner, PaidBy, DropOffStatus } from '../types';

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'd', runnerId: 'r1', item: 'iPhone 13', imei: '356789012345678', sellerName: '', sellerContact: '',
  purchasePrice: 0, paidBy: 'runner' as PaidBy, dropOffFee: 0, dateDropped: '2026-08-01',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});
const runner: Runner = { id: 'r1', name: 'Marcus', phone: '', notes: '' };

const dropOffs: DropOff[] = [
  d({ id: '1', item: 'iPhone 13', purchasePrice: 300, dropOffFee: 20, paidBy: 'runner' }),
  d({ id: '2', item: 'iPhone 14', purchasePrice: 500, dropOffFee: 30, paidBy: 'store' }),
];

describe('settlementInvoiceHtml — the printed breakdown\'s totals match the committed settlement exactly', () => {
  it('the header includes store name, runner name, settlement date, and settlement id', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-100', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, { storeName: 'FlipThatTech Repairs' });
    expect(html).toContain('FlipThatTech Repairs');
    expect(html).toContain('Marcus');
    expect(html).toContain('2026-08-15');
    expect(html).toContain('S-100');
  });

  it('never hardcodes the store name — an unset opts.storeName falls back, a set one always wins', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const withStore = settlementInvoiceHtml(settlement, runner, dropOffs, { storeName: 'My Custom Shop Name' });
    expect(withStore).toContain('My Custom Shop Name');
    expect(withStore).not.toContain('FlipThatTech</h2>');
  });

  it('device lines show model, IMEI, drop-off date, purchase price, and fee', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('iPhone 13');
    expect(html).toContain('356789012345678');
    expect(html).toContain('2026-08-01');
    expect(html).toContain('$300.00');
    expect(html).toContain('$20.00');
  });

  it('an edited per-device fee prints the ADJUSTED fee, not the drop-off\'s raw stored dropOffFee, and totals match', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25; // edited from 20 -> 25
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('$25.00'); // adjusted fee for device 1, printed
    expect(settlement.totalFees).toBe(55); // 25 + 30
    expect(html).toContain(`$${settlement.totalFees.toFixed(2)}`); // printed total fees matches the committed settlement
  });

  it('an excluded line never appears on the printed breakdown', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].included = false; // exclude device 2 (iPhone 14)
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('iPhone 13');
    expect(html).not.toContain('iPhone 14');
    expect(html).toContain('Devices (1)');
  });

  it('a settlement-level adjustment and its note appear on the printout', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview(
      { id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' },
      dropOffs, lines, -15, 'Agreed $15 deduction — late drop-off',
    );
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('Agreed $15 deduction — late drop-off');
    expect(html).toContain('-$15.00');
  });

  it('states the net direction in plain words — store pays runner (positive net)', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    expect(settlement.amountPaid).toBeGreaterThan(0);
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('Store pays runner $350.00'); // 300 fronted + 50 fees
  });

  it('states the net direction in plain words — runner owes store (negative net)', () => {
    // A big enough deduction to flip the sign.
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, -400, 'Runner owes back a prior overpayment');
    expect(settlement.amountPaid).toBeLessThan(0);
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, {});
    expect(html).toContain('Runner owes store $50.00'); // |350 - 400|
  });

  it('includes a signature line for the runner and for the store', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', runnerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, runner, dropOffs, { storeName: 'FlipThatTech' });
    expect(html).toContain('Runner signature');
    expect(html).toContain('FlipThatTech signature');
  });
});
