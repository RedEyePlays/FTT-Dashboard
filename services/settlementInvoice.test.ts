import { describe, it, expect } from 'vitest';
import { settlementInvoiceHtml } from './settlementInvoice';
import { buildSettlementFromReview, initSettlementReview } from '../domain/dropoffs';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus, Settlement } from '../types';

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

describe('settlementInvoiceHtml — the printed breakdown\'s totals match the committed settlement exactly', () => {
  it('the header includes store name, buyer name, settlement date, and settlement id', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-100', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, dropOffs, { storeName: 'FlipThatTech Repairs' });
    expect(html).toContain('FlipThatTech Repairs');
    expect(html).toContain('Marcus');
    expect(html).toContain('2026-08-15');
    expect(html).toContain('S-100');
  });

  it('never hardcodes the store name — an unset opts.storeName falls back, a set one always wins', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const withStore = settlementInvoiceHtml(settlement, buyer, dropOffs, { storeName: 'My Custom Shop Name' });
    expect(withStore).toContain('My Custom Shop Name');
    expect(withStore).not.toContain('FlipThatTech</h2>');
  });

  it('device lines show model, IMEI, drop-off date, purchase price, and fee', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, dropOffs, {});
    expect(html).toContain('iPhone 13');
    expect(html).toContain('356789012345678');
    expect(html).toContain('2026-08-01');
    expect(html).toContain('$300.00');
    expect(html).toContain('$20.00');
  });

  it('an edited per-device fee prints the ADJUSTED fee, not the drop-off\'s raw stored dropOffFee, and totals match', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25; // edited from 20 -> 25
    const settlement = buildSettlementFromReview({ id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, dropOffs, {});
    expect(html).toContain('$25.00'); // adjusted fee for device 1, printed
    expect(settlement.totalFees).toBe(55); // 25 + 30
    expect(html).toContain(`$${settlement.totalFees.toFixed(2)}`); // printed total fees matches the committed settlement
  });

  it('an excluded line never appears on the printed breakdown', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].included = false; // exclude device 2 (iPhone 14)
    const settlement = buildSettlementFromReview({ id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, dropOffs, {});
    expect(html).toContain('iPhone 13');
    expect(html).not.toContain('iPhone 14');
    expect(html).toContain('Devices (1)');
  });

  it('a settlement-level adjustment and its note appear on the printout', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview(
      { id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' },
      dropOffs, lines, -15, 'Agreed $15 deduction — late drop-off',
    );
    const html = settlementInvoiceHtml(settlement, buyer, dropOffs, {});
    expect(html).toContain('Agreed $15 deduction — late drop-off');
    expect(html).toContain('-$15.00');
  });

  it('states the direction unambiguously: the buyer owes the store, principal and fee as SEPARATE lines', () => {
    // Store-funded $100 device + $20 service fee = the canonical $120 case.
    const financed = [d({ id: 'xr', item: 'iPhone XR', purchasePrice: 100, dropOffFee: 20, paidBy: 'store' })];
    const settlement = buildSettlementFromReview(
      { id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' },
      financed, initSettlementReview(financed), 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, financed, {});
    expect(html).toContain('Principal owed (device purchase price advanced by store)');
    expect(html).toContain('$100.00');
    expect(html).toContain('Service fee');
    expect(html).toContain('$20.00');
    expect(html).toContain('Total owed to store');
    expect(html).toContain('Device buyer owes store $120.00');
    // Nothing on the page may say the store pays the buyer.
    expect(html.toLowerCase()).not.toContain('store pays');
    expect(html.toLowerCase()).not.toContain('fronted by device buyer');
    expect(html.toLowerCase()).not.toContain('reimburse');
  });

  it('a buyer-funded device prints zero principal — he owes the service fee only', () => {
    const own = [d({ id: 'own', item: 'Pixel 8', purchasePrice: 100, dropOffFee: 20, paidBy: 'runner' })];
    const settlement = buildSettlementFromReview(
      { id: 'S-2', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' },
      own, initSettlementReview(own), 0, '');
    const html = settlementInvoiceHtml(settlement, buyer, own, {});
    expect(html).toContain('Buyer-funded (own money)');
    expect(html).toContain('Device buyer owes store $20.00');
  });

  it('a settlement recorded under the PRIOR model reprints exactly as stored, under a clear legacy banner', () => {
    const legacy: Settlement = {
      id: 'S-OLD', buyerId: 'r1', date: '2026-06-01', dropOffIds: ['1'],
      totalPurchaseFronted: 300, totalFees: 20, amountPaid: 320, notes: '',
    };
    const html = settlementInvoiceHtml(legacy, buyer, dropOffs, {});
    expect(html).toContain('Store paid device buyer $320.00');
    expect(html).toContain('Recorded under the prior model');
    expect(html).not.toContain('Total owed to store');
  });

  // Signature lines were removed at the owner's request — this document isn't
  // signed. These lock in that they're gone AND that nothing was left behind:
  // no empty markup and no dead CSS still shipping in every printout.
  describe('no signature block', () => {
    const printed = () => {
      const lines = initSettlementReview(dropOffs);
      const settlement = buildSettlementFromReview({ id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
      return settlementInvoiceHtml(settlement, buyer, dropOffs, { storeName: 'FlipThatTech' });
    };

    it('renders no signature lines at all', () => {
      const html = printed();
      expect(html).not.toContain('Device buyer signature');
      expect(html).not.toContain('FlipThatTech signature');
      expect(html).not.toMatch(/signature/i);
    });

    it('leaves no empty block where the signatures used to be, and no dead CSS for it', () => {
      const html = printed();
      // The markup: no leftover container/rule divs that would print as blank
      // space at the bottom of the page.
      expect(html).not.toContain('class="sig"');
      expect(html).not.toContain('class="rule"');
      expect(html).not.toContain('<div class="line">');
      // The stylesheet: the rules that only ever styled that block are gone
      // too, rather than shipping unused in every print job.
      expect(html).not.toContain('.sig');
      expect(html).not.toMatch(/\.rule\s*\{/);
    });

    it('still closes the document deliberately — the footer keeps its own spacing and rule', () => {
      const html = printed();
      // The 36px of separation the signature block used to provide is now the
      // footer's own margin + closing rule, so the invoice doesn't end
      // abruptly right under the totals.
      expect(html).toMatch(/\.foot\{[^}]*margin-top:20px/);
      expect(html).toMatch(/\.foot\{[^}]*border-top:1px solid #ddd/);
      expect(html).toContain('Settlement S-1');
    });
  });
});
