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
