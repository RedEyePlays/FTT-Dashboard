import { describe, it, expect } from 'vitest';
import {
  isLowStockAccessory, isOverdueRepair, isAwaitingPickup, buildAlerts,
  READY_PICKUP_STALE_DAYS, DAY_MS,
} from './alerts';
import { InventoryItem, Repair, RepairStatus } from '../types';

const NOW = new Date('2026-07-26T12:00:00').getTime();
const iso = (ms: number) => new Date(ms).toISOString().split('T')[0];

const acc = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'a', item: 'Cable', kind: 'accessory', imei: '', boughtFrom: '', purchaseCost: 0,
  repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '',
  quantity: 5, lowStockThreshold: 3, ...p,
});

const device = (p: Partial<InventoryItem>): InventoryItem =>
  ({ ...acc(p), kind: 'device', ...p });

const repair = (p: Partial<Repair>): Repair => ({
  id: 'r', repairNumber: 'RPR-001', type: 'retail', createdAt: NOW, date: '2026-07-01',
  issue: 'x', repairPrice: 0, status: 'in_repair' as RepairStatus, ...p,
});

describe('isLowStockAccessory', () => {
  it('is true when an accessory is at or below its threshold', () => {
    expect(isLowStockAccessory(acc({ quantity: 3, lowStockThreshold: 3 }))).toBe(true); // at
    expect(isLowStockAccessory(acc({ quantity: 1, lowStockThreshold: 3 }))).toBe(true); // below
    expect(isLowStockAccessory(acc({ quantity: 0, lowStockThreshold: 3 }))).toBe(true); // out
  });
  it('is false above threshold', () => {
    expect(isLowStockAccessory(acc({ quantity: 4, lowStockThreshold: 3 }))).toBe(false);
  });
  it('never flags devices (only stock-tracked accessories)', () => {
    expect(isLowStockAccessory(device({ quantity: 0, lowStockThreshold: 3 }))).toBe(false);
  });
});

describe('isOverdueRepair', () => {
  it('is true when past the estimated completion and still being worked', () => {
    expect(isOverdueRepair(repair({ status: 'in_repair', estimatedCompletion: iso(NOW - 2 * DAY_MS) }), NOW)).toBe(true);
  });
  it('is false when the estimate is today or in the future', () => {
    expect(isOverdueRepair(repair({ status: 'in_repair', estimatedCompletion: iso(NOW) }), NOW)).toBe(false);
    expect(isOverdueRepair(repair({ status: 'in_repair', estimatedCompletion: iso(NOW + 2 * DAY_MS) }), NOW)).toBe(false);
  });
  it('is false without an estimated completion date', () => {
    expect(isOverdueRepair(repair({ status: 'in_repair' }), NOW)).toBe(false);
  });
  it('excludes terminal / ready states so it never double-counts with awaiting-pickup', () => {
    const past = iso(NOW - 5 * DAY_MS);
    for (const status of ['completed', 'cancelled', 'ready_pickup', 'picked_up'] as RepairStatus[]) {
      expect(isOverdueRepair(repair({ status, estimatedCompletion: past }), NOW)).toBe(false);
    }
  });
});

describe('isAwaitingPickup', () => {
  it('flags a repair that has been ready longer than the stale window', () => {
    const r = repair({ status: 'ready_pickup', estimatedCompletion: iso(NOW - (READY_PICKUP_STALE_DAYS + 1) * DAY_MS) });
    expect(isAwaitingPickup(r, NOW)).toBe(true);
  });
  it('does not flag one that just became ready', () => {
    const r = repair({ status: 'ready_pickup', estimatedCompletion: iso(NOW) });
    expect(isAwaitingPickup(r, NOW)).toBe(false);
  });
  it('falls back to createdAt when there is no estimated completion', () => {
    const stale = repair({ status: 'ready_pickup', estimatedCompletion: undefined, createdAt: NOW - 10 * DAY_MS });
    const fresh = repair({ status: 'ready_pickup', estimatedCompletion: undefined, createdAt: NOW - 1 * DAY_MS });
    expect(isAwaitingPickup(stale, NOW)).toBe(true);
    expect(isAwaitingPickup(fresh, NOW)).toBe(false);
  });
  it('only applies to the ready_pickup status', () => {
    expect(isAwaitingPickup(repair({ status: 'in_repair', createdAt: NOW - 30 * DAY_MS }), NOW)).toBe(false);
  });
  it('respects a custom stale-days threshold', () => {
    const r = repair({ status: 'ready_pickup', estimatedCompletion: iso(NOW - 2 * DAY_MS) });
    expect(isAwaitingPickup(r, NOW, 1)).toBe(true);
    expect(isAwaitingPickup(r, NOW, 5)).toBe(false);
  });
});

describe('buildAlerts', () => {
  const inventory = [
    acc({ id: 'lo', item: 'USB-C Cable', quantity: 1, lowStockThreshold: 3 }),
    acc({ id: 'ok', item: 'Case', quantity: 20, lowStockThreshold: 3 }),
  ];
  const repairs = [
    repair({ id: 'od', repairNumber: 'RPR-OD', status: 'in_repair', estimatedCompletion: iso(NOW - 3 * DAY_MS), customerName: 'Sam' }),
    repair({ id: 'rp', repairNumber: 'RPR-RP', status: 'ready_pickup', estimatedCompletion: iso(NOW - 5 * DAY_MS), customerName: 'Kai' }),
    repair({ id: 'fine', repairNumber: 'RPR-OK', status: 'in_repair', estimatedCompletion: iso(NOW + 5 * DAY_MS) }),
  ];

  it('collects low-stock, overdue and awaiting-pickup alerts with stable ids', () => {
    const alerts = buildAlerts({ inventory, repairs, now: NOW });
    const ids = alerts.map(a => a.id);
    expect(ids).toContain('low_stock:lo');
    expect(ids).toContain('repair_overdue:od');
    expect(ids).toContain('repair_awaiting_pickup:rp');
    // The healthy accessory and on-time repair produce nothing.
    expect(ids).not.toContain('low_stock:ok');
    expect(alerts.filter(a => a.kind === 'repair_overdue')).toHaveLength(1);
    expect(alerts).toHaveLength(3);
  });

  it('a single ready-but-overdue repair raises exactly one (awaiting-pickup) alert', () => {
    const one = [repair({ id: 'x', status: 'ready_pickup', estimatedCompletion: iso(NOW - 10 * DAY_MS) })];
    const alerts = buildAlerts({ inventory: [], repairs: one, now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('repair_awaiting_pickup');
  });

  it('is empty when nothing needs attention', () => {
    expect(buildAlerts({ inventory: [inventory[1]], repairs: [repairs[2]], now: NOW })).toEqual([]);
  });

  it('includes a navigation target on every alert', () => {
    for (const a of buildAlerts({ inventory, repairs, now: NOW })) {
      expect(a.view).toBeTruthy();
    }
  });
});
