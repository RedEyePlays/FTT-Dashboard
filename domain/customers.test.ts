import { describe, it, expect } from 'vitest';
import { customerStats, customerTimeline, matchCustomer } from './customers';
import { Customer, SalesTransaction, Repair, RepairBatch } from '../types';

const cust = (p: Partial<Customer>): Customer => ({ id: 'c1', name: 'John Doe', phone: '555-1234', ...p });
const tx = (p: Partial<SalesTransaction>): SalesTransaction =>
  ({ id: 't', date: '2026-07-01', customerName: '', subtotal: 0, tax: 0, platformFee: 0, purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p });
const rep = (p: Partial<Repair>): Repair =>
  ({ id: 'r', repairNumber: 'RPR-1', type: 'retail', createdAt: 0, date: '2026-07-01', issue: '', repairPrice: 0, status: 'received', ...p });
const batch = (p: Partial<RepairBatch>): RepairBatch =>
  ({ id: 'b', batchNumber: 'WB-1', createdAt: 0, dateReceived: '2026-07-01', companyName: 'Acme', status: 'active', amountPaid: 0, ...p });

describe('customerStats', () => {
  it('links purchases by customerId and by phone fallback; computes lifetime + averages', () => {
    const c = cust({ id: 'c1', phone: '555-1234' });
    const data = {
      salesTransactions: [
        tx({ id: 't1', customerId: 'c1', date: '2026-07-01', totalPaid: 100, netProfit: 30 }),
        tx({ id: 't2', customerPhone: '555-1234', date: '2026-07-03', totalPaid: 300, netProfit: 90 }), // phone fallback
        tx({ id: 't3', customerId: 'other', customerPhone: '999', totalPaid: 999 }),                    // not this customer
      ],
      repairs: [], batches: [],
    };
    const s = customerStats(c, data);
    expect(s.purchaseCount).toBe(2);
    expect(s.lifetimeSpent).toBe(400);
    expect(s.lifetimeProfit).toBe(120);
    expect(s.avgPurchase).toBe(200);
    expect(s.purchases[0].id).toBe('t2'); // newest first
  });

  it('includes retail repairs (by id) and wholesale repairs (via batch businessId)', () => {
    const c = cust({ id: 'biz', kind: 'wholesale', phone: '' });
    const data = {
      salesTransactions: [],
      repairs: [
        rep({ id: 'r1', type: 'retail', customerId: 'biz', repairPrice: 50, createdAt: 2 }),
        rep({ id: 'r2', type: 'wholesale', batchId: 'b1', repairPrice: 80, createdAt: 3 }),
        rep({ id: 'r3', type: 'wholesale', batchId: 'bX', repairPrice: 999, createdAt: 1 }), // other business
      ],
      batches: [batch({ id: 'b1', businessId: 'biz' }), batch({ id: 'bX', businessId: 'nope' })],
    };
    const s = customerStats(c, data);
    expect(s.repairCount).toBe(2);
    expect(s.repairRevenue).toBe(130);
    expect(s.avgRepair).toBe(65);
    expect(s.repairs[0].id).toBe('r2'); // newest first
  });

  it('derives first-seen / last-activity across purchases and repairs', () => {
    const c = cust({ id: 'c1', phone: '555' });
    const s = customerStats(c, {
      salesTransactions: [tx({ customerId: 'c1', date: '2026-07-05', totalPaid: 10 })],
      repairs: [rep({ customerId: 'c1', createdAt: new Date('2026-06-01T00:00:00').getTime() })],
      batches: [],
    });
    expect(new Date(s.firstSeen).getMonth()).toBe(5); // June
    expect(new Date(s.lastActivity).getMonth()).toBe(6); // July
  });

  it('handles a customer with no history', () => {
    const s = customerStats(cust({ id: 'x', phone: 'z' }), { salesTransactions: [], repairs: [], batches: [] });
    expect(s.purchaseCount).toBe(0);
    expect(s.avgPurchase).toBe(0);
    expect(s.firstSeen).toBe(0);
  });
});

describe('customerTimeline', () => {
  it('merges purchases + repairs newest first', () => {
    const c = cust({ id: 'c1', phone: '555' });
    const s = customerStats(c, {
      salesTransactions: [tx({ customerId: 'c1', date: '2026-07-10', totalPaid: 10 })],
      repairs: [rep({ customerId: 'c1', createdAt: new Date('2026-07-20T00:00:00').getTime() })],
      batches: [],
    });
    const tl = customerTimeline(s);
    expect(tl[0].kind).toBe('repair');
    expect(tl[1].kind).toBe('purchase');
  });
});

describe('matchCustomer', () => {
  it('matches name, phone, email, company', () => {
    const c = cust({ name: 'Jane Roe', phone: '555-9', email: 'jane@x.com', company: 'FixIt' });
    expect(matchCustomer(c, 'jane')).toBe(true);
    expect(matchCustomer(c, '555')).toBe(true);
    expect(matchCustomer(c, 'x.com')).toBe(true);
    expect(matchCustomer(c, 'fixit')).toBe(true);
    expect(matchCustomer(c, 'nope')).toBe(false);
    expect(matchCustomer(c, '')).toBe(true);
  });
});

import { customerDevices, findDuplicateGroups, planMerge, passesFilter, sortCustomers, customerSearchMatch, normPhone } from './customers';
import { InventoryItem } from '../types';

const invDev = (p: Partial<InventoryItem>): InventoryItem => ({ id: 'i', kind: 'device', sku: 'SKU1', date: '2026-01-01', item: 'iPhone 15 Pro', imei: 'IMEI-1', purchaseCost: 0, repairCost: 0, ...p } as InventoryItem);

describe('CRM stats + devices', () => {
  it('derives active repairs, warranty claims, outstanding balance', () => {
    const c = cust({ id: 'c1', phone: '555-1', tags: ['VIP'] });
    const future = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const s = customerStats(c, {
      salesTransactions: [tx({ customerId: 'c1', totalPaid: 100 })],
      repairs: [
        rep({ id: 'r1', customerId: 'c1', status: 'in_repair', repairPrice: 200, deposit: 50 }), // open, owes 150
        rep({ id: 'r2', customerId: 'c1', status: 'picked_up', repairPrice: 80, warrantyUntil: future }), // warranty active
      ],
      batches: [],
    });
    expect(s.activeRepairs).toBe(1);
    expect(s.warrantyClaims).toBe(1);
    expect(s.outstandingBalance).toBe(150);
    expect(s.isVIP).toBe(true);
    expect(s.hasOpenRepairs).toBe(true);
  });

  it('builds device history linking a purchase + repair by IMEI', () => {
    const c = cust({ id: 'c1', phone: '555' });
    const s = customerStats(c, {
      salesTransactions: [tx({ customerId: 'c1', date: '2026-01-05', lines: [{ kind: 'device', inventoryId: 'i9', name: 'iPhone 15 Pro', quantity: 1, unitPrice: 900 } as any] })],
      repairs: [rep({ customerId: 'c1', imei: 'IMEI-9', brand: 'Apple', model: 'iPhone 15 Pro', createdAt: new Date('2026-03-01').getTime() })],
      batches: [],
    });
    const devices = customerDevices(s, [invDev({ id: 'i9', imei: 'IMEI-9', item: 'iPhone 15 Pro' })]);
    const iphone = devices.find(d => d.imei === 'IMEI-9');
    expect(iphone).toBeTruthy();
    expect(iphone!.events.length).toBe(2); // purchase + repair on the same device
  });
});

describe('filters + sort + deep search', () => {
  const c = cust({ id: 'c1', phone: '555', tags: ['VIP'] });
  const s = customerStats(c, { salesTransactions: [], repairs: [rep({ customerId: 'c1', status: 'in_repair', repairPrice: 100 })], batches: [] });
  it('filters by open repairs / vip / balance', () => {
    expect(passesFilter('open_repairs', s)).toBe(true);
    expect(passesFilter('vip', s)).toBe(true);
    expect(passesFilter('balance', s)).toBe(true);
    expect(passesFilter('warranty', s)).toBe(false);
  });
  it('deep search matches a linked repair number and sku', () => {
    const st = customerStats(c, {
      salesTransactions: [tx({ customerId: 'c1', lines: [{ kind: 'device', sku: 'ABC-123', name: 'Pixel', quantity: 1, unitPrice: 1 } as any] })],
      repairs: [rep({ customerId: 'c1', repairNumber: 'RPR-000777' })],
      batches: [],
    });
    expect(customerSearchMatch(c, st, 'RPR-000777')).toBe(true);
    expect(customerSearchMatch(c, st, 'abc-123')).toBe(true);
    expect(customerSearchMatch(c, st, 'nomatch')).toBe(false);
  });
  it('sorts by repairs count desc', () => {
    const rows = [
      { c: cust({ id: 'a' }), s: customerStats(cust({ id: 'a' }), { salesTransactions: [], repairs: [], batches: [] }) },
      { c, s },
    ];
    expect(sortCustomers(rows, 'repairs')[0].c.id).toBe('c1');
  });
});

describe('duplicate detection + merge', () => {
  it('groups customers sharing a normalized phone', () => {
    const a = cust({ id: 'a', phone: '(555) 111-2222' });
    const b = cust({ id: 'b', phone: '5551112222', name: 'Dupe' });
    const groups = findDuplicateGroups([a, b, cust({ id: 'c', phone: '999' })]);
    expect(groups.length).toBe(1);
    expect(groups[0].customers.map(x => x.id).sort()).toEqual(['a', 'b']);
    expect(normPhone('(555) 111-2222')).toBe('5551112222');
  });

  it('planMerge relinks records and removes the duplicate', () => {
    const a = cust({ id: 'a', phone: '555', tags: ['VIP'], email: '' });
    const b = cust({ id: 'b', phone: '555', tags: ['Student'], email: 'b@x.com' });
    const data = {
      salesTransactions: [tx({ id: 't1', customerId: 'b', totalPaid: 10 })],
      repairs: [rep({ id: 'r1', customerId: 'b' })],
      batches: [],
    };
    const plan = planMerge(a, [b], data);
    expect(plan.removeIds).toEqual(['b']);
    expect(plan.reassignSales).toEqual(['t1']);
    expect(plan.reassignRepairs).toEqual(['r1']);
    expect(plan.customer.email).toBe('b@x.com');           // enriched from dup
    expect(plan.customer.tags!.sort()).toEqual(['Student', 'VIP']); // unioned
  });
});
