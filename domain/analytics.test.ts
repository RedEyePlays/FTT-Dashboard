import { describe, it, expect } from 'vitest';
import { presetRange, computeAnalytics, eodCsv, AnalyticsInput } from './analytics';
import { SalesTransaction, Repair, InventoryItem } from '../types';

const NOW = new Date('2026-07-20T12:00:00').getTime();
const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 't', date: '2026-07-20', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
  purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
});
const rep = (p: Partial<Repair>): Repair => ({
  id: 'r', repairNumber: 'RPR-1', type: 'retail', createdAt: NOW, date: '2026-07-20',
  issue: 'Screen', repairPrice: 0, status: 'received', ...p,
});
const acc = (p: Partial<InventoryItem>): InventoryItem => ({ id: 'a', kind: 'accessory', date: '2026-01-01', item: 'Case', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', quantity: 0, ...p } as InventoryItem);

const base: AnalyticsInput = { salesTransactions: [], repairs: [], inventory: [], customers: [], auditLogs: [], activity: [] };

describe('presetRange', () => {
  it('today / yesterday / this year windows', () => {
    const today = presetRange('today', NOW);
    expect(new Date(today.start).getDate()).toBe(20);
    expect(today.end - today.start).toBe(86400000);
    const y = presetRange('yesterday', NOW);
    expect(new Date(y.start).getDate()).toBe(19);
    const yr = presetRange('year', NOW);
    expect(new Date(yr.start).getMonth()).toBe(0);
  });
  it('custom range is inclusive of the end day', () => {
    const r = presetRange('custom', NOW, { start: '2026-07-01', end: '2026-07-10' });
    expect(new Date(r.start).getDate()).toBe(1);
    expect(r.end).toBe(new Date('2026-07-11T00:00:00').getTime());
  });
});

describe('reversed sales (voided / returned) are not recognized as revenue', () => {
  it('excludes voided and returned transactions from revenue, profit and counts', () => {
    const input: AnalyticsInput = {
      ...base,
      salesTransactions: [
        tx({ id: 'ok', date: '2026-07-20', subtotal: 400, totalPaid: 400, netProfit: 150, lines: [{ kind: 'device', name: 'Nexus', quantity: 1, unitPrice: 400 } as any] }),
        tx({ id: 'void', date: '2026-07-20', subtotal: 900, totalPaid: 900, netProfit: 300, status: 'voided', lines: [{ kind: 'device', name: 'iPhone', quantity: 1, unitPrice: 900 } as any] }),
        tx({ id: 'ret', date: '2026-07-20', subtotal: 700, totalPaid: 700, netProfit: 250, status: 'returned', lines: [{ kind: 'device', name: 'Pixel', quantity: 1, unitPrice: 700 } as any] }),
      ],
    };
    const a = computeAnalytics(presetRange('today', NOW), input, NOW);
    expect(a.revenue).toBe(400);
    expect(a.grossProfit).toBe(150);
    expect(a.salesCount).toBe(1);
    expect(a.devicesSold).toBe(1);
  });
});

describe('layaway (unpaid balance) is not recognized as revenue', () => {
  it('excludes a transaction with a balance still owing until it is paid off', () => {
    const withLayaway: AnalyticsInput = {
      ...base,
      salesTransactions: [
        tx({ id: 'paid', date: '2026-07-20', subtotal: 500, totalPaid: 500, netProfit: 200, lines: [{ kind: 'device', name: 'Pixel', quantity: 1, unitPrice: 500 } as any] }),
        tx({ id: 'layaway', date: '2026-07-20', subtotal: 800, totalPaid: 800, netProfit: 300, deposit: 200, balanceOwing: 600, lines: [{ kind: 'device', name: 'iPhone', quantity: 1, unitPrice: 800 } as any] }),
      ],
    };
    const a = computeAnalytics(presetRange('today', NOW), withLayaway, NOW);
    expect(a.revenue).toBe(500);      // only the fully-paid sale
    expect(a.grossProfit).toBe(200);
    expect(a.salesCount).toBe(1);
    expect(a.devicesSold).toBe(1);
  });
});

describe('computeAnalytics overview + payments', () => {
  const input: AnalyticsInput = {
    ...base,
    salesTransactions: [
      tx({ id: 't1', date: '2026-07-20', subtotal: 900, totalPaid: 900, netProfit: 300, cashAmount: 900, lines: [{ kind: 'device', name: 'iPhone 14', quantity: 1, unitPrice: 900 } as any] }),
      tx({ id: 't2', date: '2026-07-20', subtotal: 40, totalPaid: 40, netProfit: 20, cardAmount: 40, lines: [{ kind: 'accessory', name: 'Case', quantity: 2, unitPrice: 20 } as any] }),
      tx({ id: 'tOld', date: '2026-06-01', subtotal: 999, totalPaid: 999, netProfit: 999 }), // out of range
    ],
    repairs: [
      rep({ id: 'r1', repairPrice: 150, partsCost: 40, createdAt: NOW }),
      rep({ id: 'r2', repairPrice: 200, partsCost: 0, createdAt: NOW, completedAt: NOW, status: 'picked_up' }),
    ],
  };
  const a = computeAnalytics(presetRange('today', NOW), input, NOW);

  it('sums revenue, profit, margin, counts for the range only', () => {
    expect(a.revenue).toBe(940);
    expect(a.grossProfit).toBe(320);
    expect(a.grossMargin).toBeCloseTo(34.04, 1);
    expect(a.salesCount).toBe(2);
    expect(a.devicesSold).toBe(1);
    expect(a.repairsCount).toBe(2);
  });
  it('splits payments by method', () => {
    expect(a.payments.cash).toBe(900);
    expect(a.payments.card).toBe(40);
  });
  it('separates repair labour / parts / profit', () => {
    expect(a.repairRevenue).toBe(350);
    expect(a.repairPartsCost).toBe(40);
    expect(a.repairProfit).toBe(310);
    expect(a.repairLabourRevenue).toBe(310);
  });
  it('categorizes device vs accessory revenue', () => {
    const acc = a.categories.find(c => c.name === 'Accessories');
    expect(acc?.revenue).toBe(40);
    expect(a.categories.find(c => c.name === 'Repairs')?.revenue).toBe(350);
  });
  it('EOD completed + waiting-pickup counts', () => {
    expect(a.eod.repairsCompleted).toBe(1);
    expect(a.eod.devicesSold).toBe(1);
    expect(eodCsv(a.eod)).toContain('Revenue,940.00');
  });
});

describe('a standalone e-transfer sale (no explicit cash/card/etransfer amounts) buckets under payments.etransfer', () => {
  const input: AnalyticsInput = {
    ...base,
    salesTransactions: [
      tx({ id: 't1', date: '2026-07-20', subtotal: 500, totalPaid: 500, netProfit: 200, paymentMethod: 'etransfer', lines: [{ kind: 'device', name: 'Pixel 8', quantity: 1, unitPrice: 500 } as any] }),
    ],
  };
  const a = computeAnalytics(presetRange('today', NOW), input, NOW);

  it('lands in payments.etransfer, not payments.other', () => {
    expect(a.payments.etransfer).toBe(500);
    expect(a.payments.other).toBe(0);
  });
});

describe('device category from the sales line (custom device sales)', () => {
  it('buckets a device line by its own deviceType when it has no inventory match', () => {
    // A custom device sale: no inventoryId, no resolvable sku — analytics must use
    // the deviceType recorded on the line (not fall through to "Other Devices").
    const a = computeAnalytics(presetRange('today', NOW), {
      ...base,
      salesTransactions: [
        tx({ id: 'c1', date: '2026-07-20', subtotal: 800, totalPaid: 800, netProfit: 200,
          lines: [{ kind: 'device', name: 'Custom Laptop', quantity: 1, unitPrice: 800, inventoryId: '', deviceType: 'Laptop' } as any] }),
        tx({ id: 'c2', date: '2026-07-20', subtotal: 500, totalPaid: 500, netProfit: 100,
          lines: [{ kind: 'device', name: 'Custom Phone', quantity: 1, unitPrice: 500, inventoryId: '', deviceType: 'Phone' } as any] }),
      ],
    }, NOW);
    expect(a.categories.find(c => c.name === 'Laptops')?.revenue).toBe(800);
    expect(a.categories.find(c => c.name === 'Phones')?.revenue).toBe(500);
    // nothing leaked into the catch-all bucket
    expect(a.categories.find(c => c.name === 'Other Devices')).toBeUndefined();
  });

  it('still falls back to "Other Devices" when no type is known', () => {
    const a = computeAnalytics(presetRange('today', NOW), {
      ...base,
      salesTransactions: [
        tx({ id: 'c3', date: '2026-07-20', subtotal: 300, totalPaid: 300, netProfit: 50,
          lines: [{ kind: 'device', name: 'Mystery', quantity: 1, unitPrice: 300, inventoryId: '' } as any] }),
      ],
    }, NOW);
    expect(a.categories.find(c => c.name === 'Other Devices')?.revenue).toBe(300);
  });
});

describe('repair checked out through Quick Sale', () => {
  // A repair completed via Quick Sale becomes a SalesTransaction carrying its
  // repairId, and the repair record is stamped with the matching
  // salesTransactionId. The money must be counted ONCE (via the sale) — in the
  // headline totals AND the Repairs category — never doubled.
  const input: AnalyticsInput = {
    ...base,
    salesTransactions: [
      tx({ id: 'sale-r', date: '2026-07-20', subtotal: 180, totalPaid: 180, netProfit: 140,
        purchaseCost: 40, totalCost: 40, cashAmount: 180, paymentMethod: 'cash', repairId: 'r1',
        lines: [{ kind: 'accessory', name: 'Repair · iPhone — Screen', quantity: 1, unitPrice: 180, inventoryId: '' } as any] }),
    ],
    repairs: [
      // Same repair, now linked to the sale above (parts $40, price $180).
      rep({ id: 'r1', repairPrice: 180, partsCost: 40, createdAt: NOW, completedAt: NOW, status: 'picked_up', salesTransactionId: 'sale-r' }),
    ],
  };
  const a = computeAnalytics(presetRange('today', NOW), input, NOW);

  it('recognizes the repair once in the headline revenue/profit', () => {
    expect(a.revenue).toBe(180);
    expect(a.grossProfit).toBe(140);
    expect(a.salesCount).toBe(1);
    expect(a.devicesSold).toBe(0); // a repair line is not a device sale
  });

  it('attributes it to Repairs — not Accessories — with no double count', () => {
    expect(a.categories.find(c => c.name === 'Repairs')?.revenue).toBe(180);
    expect(a.categories.find(c => c.name === 'Accessories')).toBeUndefined();
    // repairRevenue/profit reflect the single recognition (via the sale)
    expect(a.repairRevenue).toBe(180);
    expect(a.repairPartsCost).toBe(40);
    expect(a.repairProfit).toBe(140);
    expect(a.topRepairTypes.find(t => t.name === 'Screen')?.revenue).toBe(180);
  });

  it('still counts the repair operationally (created + completed)', () => {
    expect(a.repairsCount).toBe(1);
    expect(a.eod.repairsCompleted).toBe(1);
  });

  it('does not double-count when both a linked repair and a separate open repair exist', () => {
    const a2 = computeAnalytics(presetRange('today', NOW), {
      ...input,
      repairs: [
        ...input.repairs,
        rep({ id: 'r2', repairPrice: 100, partsCost: 20, createdAt: NOW }), // open, unlinked
      ],
    }, NOW);
    // headline = the one sale (180); Repairs category = sale (180) + open record (100)
    expect(a2.revenue).toBe(180);
    expect(a2.repairRevenue).toBe(280);
    expect(a2.categories.find(c => c.name === 'Repairs')?.revenue).toBe(280);
  });
});

describe('inventory snapshot', () => {
  it('values cost/retail, low + out of stock', () => {
    const input: AnalyticsInput = {
      ...base,
      inventory: [
        acc({ id: 'a1', quantity: 1, costPerUnit: 5, sellingPrice: 15, lowStockThreshold: 3 }), // low
        acc({ id: 'a2', quantity: 0, costPerUnit: 5, sellingPrice: 15 }),                        // out
        { id: 'd1', kind: 'device', date: '2026-01-01', item: 'iPhone', imei: '', boughtFrom: '', purchaseCost: 400, repairCost: 50, soldDate: '', soldTo: '', salePrice: 0, targetSalePrice: 700, deviceStatus: 'ready', notes: '' } as InventoryItem,
      ],
    };
    const a = computeAnalytics(presetRange('today', NOW), input, NOW);
    expect(a.invCost).toBe(455); // 400+50 + 1*5
    expect(a.invRetail).toBe(715); // 700 + 1*15
    expect(a.potentialProfit).toBe(260);
    expect(a.lowStock).toBe(1);
    expect(a.outOfStock).toBe(1);
  });

  it('an accessory with no threshold explicitly set is never counted as low stock (matches the ?? 0 fallback used everywhere else — InventoryView, Dashboard, domain/alerts.ts)', () => {
    const input: AnalyticsInput = {
      ...base,
      inventory: [acc({ id: 'a1', quantity: 2 })], // no lowStockThreshold field at all
    };
    const a = computeAnalytics(presetRange('today', NOW), input, NOW);
    expect(a.lowStock).toBe(0);
  });
});
