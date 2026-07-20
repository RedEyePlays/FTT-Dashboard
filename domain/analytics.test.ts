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
});
