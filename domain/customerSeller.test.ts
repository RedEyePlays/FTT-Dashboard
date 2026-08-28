import { describe, it, expect } from 'vitest';
import {
  customerStats, customerTimeline, customerDevices, customerSearchMatch,
  passesFilter, sellerPurchasesFor, findCustomerByContact, resolveCustomerForDraft,
} from './customers';
import { Customer, SalesTransaction, Repair, InventoryItem } from '../types';

// "Bought From" linked to the customer database: buyers and sellers are the
// same people, so a device we bought FROM someone belongs on their record.

const cust = (p: Partial<Customer>): Customer => ({ id: 'c1', name: 'Jane Seller', phone: '555-0100', ...p });
const tx = (p: Partial<SalesTransaction>): SalesTransaction =>
  ({ id: 't', date: '2026-07-01', customerName: '', subtotal: 0, tax: 0, platformFee: 0, purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p });
const rep = (p: Partial<Repair>): Repair =>
  ({ id: 'r', repairNumber: 'RPR-1', type: 'retail', createdAt: 0, date: '2026-07-01', issue: '', repairPrice: 0, status: 'received', ...p });
const item = (p: Partial<InventoryItem>): InventoryItem =>
  ({ id: 'i', kind: 'device', date: '2026-07-01', item: 'iPhone 13', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p });

const emptyData = { salesTransactions: [], repairs: [], batches: [] };

describe('sellerPurchasesFor — devices bought FROM a customer', () => {
  it('matches only by boughtFromCustomerId, newest first', () => {
    const inv = [
      item({ id: 'a', date: '2026-07-01', boughtFromCustomerId: 'c1' }),
      item({ id: 'b', date: '2026-08-01', boughtFromCustomerId: 'c1' }),
      item({ id: 'c', boughtFromCustomerId: 'c2' }),
    ];
    expect(sellerPurchasesFor(cust({}), inv).map(i => i.id)).toEqual(['b', 'a']);
  });

  it('NEVER auto-matches legacy free-text boughtFrom to a customer', () => {
    // A wrong auto-link is worse than no link: historical rows carry text only.
    const legacy = [item({ id: 'legacy', boughtFrom: 'Jane Seller' })];
    expect(sellerPurchasesFor(cust({ name: 'Jane Seller' }), legacy)).toEqual([]);
    // …and the row itself is untouched, so it still displays exactly as before.
    expect(legacy[0].boughtFrom).toBe('Jane Seller');
    expect(legacy[0].boughtFromCustomerId).toBeUndefined();
  });
});

describe('customerStats — seller side', () => {
  it('counts devices sold to us and totals what we paid, without touching lifetime spend', () => {
    const s = customerStats(cust({}), {
      ...emptyData,
      salesTransactions: [tx({ customerId: 'c1', totalPaid: 500, netProfit: 100 })],
      inventory: [
        item({ id: 'a', boughtFromCustomerId: 'c1', purchaseCost: 250 }),
        item({ id: 'b', boughtFromCustomerId: 'c1', purchaseCost: 300 }),
        item({ id: 'x', boughtFromCustomerId: 'someone-else', purchaseCost: 999 }),
      ],
    });
    expect(s.sellerPurchaseCount).toBe(2);
    expect(s.sellerPurchaseTotal).toBe(550);
    expect(s.lifetimeSpent).toBe(500);   // money they spent, not money we paid out
    expect(s.hasSoldToUs).toBe(true);
    expect(s.hasBoughtFromUs).toBe(true);
  });

  it('is inert for customers with no linked purchases (existing behaviour unchanged)', () => {
    const s = customerStats(cust({}), { ...emptyData, inventory: [item({ boughtFrom: 'Kijiji' })] });
    expect(s.sellerPurchaseCount).toBe(0);
    expect(s.sellerPurchaseTotal).toBe(0);
    expect(s.hasSoldToUs).toBe(false);
  });
});

describe('timeline + device history show direction', () => {
  it('adds a distinct sold_to_us entry alongside purchases and repairs', () => {
    const s = customerStats(cust({}), {
      ...emptyData,
      salesTransactions: [tx({ id: 't1', customerId: 'c1', date: '2026-07-05', totalPaid: 100 })],
      inventory: [item({ id: 'i1', date: '2026-07-10', boughtFromCustomerId: 'c1', purchaseCost: 200 })],
    });
    const timeline = customerTimeline(s);
    expect(timeline.map(e => e.kind)).toEqual(['sold_to_us', 'purchase']); // newest first
    const sold = timeline[0];
    expect(sold.kind === 'sold_to_us' && sold.item.purchaseCost).toBe(200);
  });

  it('lists a sold-to-us device in the device history', () => {
    const s = customerStats(cust({}), {
      ...emptyData,
      inventory: [item({ id: 'i1', imei: '356789012340001', item: 'Pixel 8', boughtFromCustomerId: 'c1' })],
    });
    const devices = customerDevices(s, []);
    expect(devices).toHaveLength(1);
    expect(devices[0].events[0].kind).toBe('sold_to_us');
    expect(devices[0].imei).toBe('356789012340001');
  });

  it('finds a seller by the IMEI of the device they brought in', () => {
    const s = customerStats(cust({}), {
      ...emptyData,
      inventory: [item({ imei: '356789012340001', boughtFromCustomerId: 'c1' })],
    });
    expect(customerSearchMatch(cust({}), s, '356789012340001')).toBe(true);
    expect(customerSearchMatch(cust({}), s, '999999')).toBe(false);
  });
});

describe('relationship filter', () => {
  const statsFor = (opts: { buys?: boolean; sells?: boolean }) => customerStats(cust({}), {
    ...emptyData,
    salesTransactions: opts.buys ? [tx({ customerId: 'c1', totalPaid: 10 })] : [],
    inventory: opts.sells ? [item({ boughtFromCustomerId: 'c1', purchaseCost: 10 })] : [],
  });

  it('separates bought-from-us, sold-to-us and both', () => {
    const buyer = statsFor({ buys: true });
    const seller = statsFor({ sells: true });
    const both = statsFor({ buys: true, sells: true });
    const nobody = statsFor({});

    // Bought From Us is exclusive — "sales/repairs only".
    expect([buyer, seller, both, nobody].map(s => passesFilter('bought_from_us', s))).toEqual([true, false, false, false]);
    // Sold To Us is the device-source list: everyone we've bought from, repeat
    // sellers who also shop here included.
    expect([buyer, seller, both, nobody].map(s => passesFilter('sold_to_us', s))).toEqual([false, true, true, false]);
    // Both Ways is the overlap.
    expect([buyer, seller, both, nobody].map(s => passesFilter('both_ways', s))).toEqual([false, false, true, false]);
    // All keeps current behaviour.
    expect([buyer, seller, both, nobody].every(s => passesFilter('all', s))).toBe(true);
  });

  it('repairs alone count as bought-from-us', () => {
    const s = customerStats(cust({}), { ...emptyData, repairs: [rep({ customerId: 'c1' })] });
    expect(passesFilter('bought_from_us', s)).toBe(true);
    expect(passesFilter('sold_to_us', s)).toBe(false);
  });

  it('combines with search rather than replacing it', () => {
    const people = [cust({ id: 'c1', name: 'Jane Seller' }), cust({ id: 'c2', name: 'Bob Buyer', phone: '555-0200' })];
    const inv = [item({ boughtFromCustomerId: 'c1', purchaseCost: 100 })];
    const sales = [tx({ customerId: 'c2', totalPaid: 50 })];
    const rows = people
      .map(c => ({ c, s: customerStats(c, { ...emptyData, salesTransactions: sales, inventory: inv }) }))
      .filter(({ c, s }) => customerSearchMatch(c, s, 'jane') && passesFilter('sold_to_us', s));
    expect(rows.map(r => r.c.id)).toEqual(['c1']);
  });
});

describe('inline customer creation runs duplicate detection', () => {
  const existing = [
    cust({ id: 'c1', name: 'Jane Seller', phone: '(555) 010-0000', email: 'jane@example.com' }),
    cust({ id: 'c2', name: 'Bob', phone: '555-0200' }),
  ];

  it('matches on a normalized phone regardless of formatting', () => {
    const hit = findCustomerByContact(existing, { phone: '5550100000' });
    expect(hit?.customer.id).toBe('c1');
    expect(hit?.matchedOn).toBe('phone');
  });

  it('matches on email case-insensitively', () => {
    expect(findCustomerByContact(existing, { email: ' JANE@Example.com ' })?.matchedOn).toBe('email');
  });

  it('reuses the existing record instead of creating a second one', () => {
    const r = resolveCustomerForDraft(existing, { name: 'J. Seller', phone: '555-010-0000' }, 'new-id');
    expect(r.created).toBe(false);
    expect(r.matchedOn).toBe('phone');
    expect(r.customer.id).toBe('c1');
    expect(r.customer.name).toBe('Jane Seller'); // existing details win
  });

  it('enriches a matched record with detail it was missing, without overwriting', () => {
    const r = resolveCustomerForDraft([cust({ id: 'c3', name: 'Ann', phone: '555-0300' })],
      { name: 'Ann', phone: '555-0300', email: 'ann@example.com' }, 'new-id');
    expect(r.created).toBe(false);
    expect(r.customer.email).toBe('ann@example.com');
    expect(r.customer.phone).toBe('555-0300');
  });

  it('creates a new record only when nothing matches', () => {
    const r = resolveCustomerForDraft(existing, { name: 'New Guy', phone: '555-0999' }, 'new-id', 1234);
    expect(r.created).toBe(true);
    expect(r.customer).toMatchObject({ id: 'new-id', name: 'New Guy', phone: '555-0999', kind: 'retail', createdAt: 1234 });
  });

  it('creates a record for a contactless draft rather than matching everyone with no phone', () => {
    const r = resolveCustomerForDraft([cust({ id: 'c4', name: 'No Contact', phone: '' })], { name: 'Someone' }, 'new-id');
    expect(r.created).toBe(true);
  });
});
