import { describe, it, expect } from 'vitest';
import { openRepairsFor, openRepairFor, flagDeviceForRepair, restoredDeviceStatus } from './repairs';
import {
  isStalePendingRepair, isOrphanedPendingRepair, pendingRepairIssues,
  buildAlerts, PENDING_REPAIR_STALE_DAYS, DAY_MS,
} from './alerts';
import { DeviceStatus, InventoryItem, Repair } from '../types';

// The in-repair device flag: a ticket opened against a device already sitting in
// inventory must take that device out of the sellable pool, and closing the
// ticket must put it back exactly where it was — never blanket 'ready', and
// never while a second ticket on the same device is still open.

const NOW = new Date('2026-08-20T12:00:00').getTime();

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

const repair = (p: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-000042', type: 'internal', createdAt: NOW, date: '2026-08-20',
  issue: 'screen', repairPrice: 0, status: 'in_repair', inventoryId: 'dev-1', ...p,
});

describe('openRepairsFor / openRepairFor', () => {
  it('returns only still-open tickets linked to that device, newest first', () => {
    const reps = [
      repair({ id: 'old', createdAt: NOW - 5 * DAY_MS }),
      repair({ id: 'done', status: 'completed' }),
      repair({ id: 'cancelled', status: 'cancelled' }),
      repair({ id: 'other-device', inventoryId: 'dev-2' }),
      repair({ id: 'new', createdAt: NOW }),
    ];
    expect(openRepairsFor('dev-1', reps).map(r => r.id)).toEqual(['new', 'old']);
    expect(openRepairFor('dev-1', reps)?.id).toBe('new');
  });
  it('is undefined once every linked ticket is terminal', () => {
    expect(openRepairFor('dev-1', [repair({ status: 'picked_up' })])).toBeUndefined();
  });
});

describe('flagDeviceForRepair (ticket opened on an existing inventory device)', () => {
  it('flags the device pending_repair and captures what it was before', () => {
    expect(flagDeviceForRepair(device({ deviceStatus: 'ready' })))
      .toEqual({ deviceStatus: 'pending_repair', previousStatus: 'ready' });
    expect(flagDeviceForRepair(device({ deviceStatus: 'reserved' })))
      .toEqual({ deviceStatus: 'pending_repair', previousStatus: 'reserved' });
  });
  it('defaults a device with no stored status to ready', () => {
    expect(flagDeviceForRepair({ deviceStatus: undefined as unknown as DeviceStatus }))
      .toEqual({ deviceStatus: 'pending_repair', previousStatus: 'ready' });
  });
  it('does nothing when the device is already flagged — the first ticket owns the captured status', () => {
    expect(flagDeviceForRepair(device({ deviceStatus: 'pending_repair' }))).toBeNull();
  });
  it('never drags a sold device back (post-sale warranty ticket)', () => {
    expect(flagDeviceForRepair(device({ deviceStatus: 'sold' }))).toBeNull();
  });
});

describe('restoredDeviceStatus (ticket closed / deleted)', () => {
  const closing = repair({ id: 'r1', inventoryPreviousStatus: 'reserved' });

  it('restores the captured previous status, not a blanket ready', () => {
    expect(restoredDeviceStatus(device({ deviceStatus: 'pending_repair' }), closing, [closing]))
      .toBe('reserved');
  });
  it('falls back to ready only when nothing was captured', () => {
    const r = repair({ inventoryPreviousStatus: undefined });
    expect(restoredDeviceStatus(device({ deviceStatus: 'pending_repair' }), r, [r])).toBe('ready');
  });
  it('leaves the device flagged while another ticket on it is still open', () => {
    const other = repair({ id: 'r2', status: 'waiting_parts' });
    expect(restoredDeviceStatus(device({ deviceStatus: 'pending_repair' }), closing, [closing, other]))
      .toBeNull();
  });
  it('restores once the last remaining open ticket is the one closing', () => {
    const first = repair({ id: 'r1', status: 'completed', inventoryPreviousStatus: 'reserved' });
    const last = repair({ id: 'r2', status: 'picked_up', inventoryPreviousStatus: 'ready' });
    expect(restoredDeviceStatus(device({ deviceStatus: 'pending_repair' }), last, [first, last]))
      .toBe('ready');
  });
  it('never overrides a status set deliberately since (sold on the floor mid-ticket)', () => {
    expect(restoredDeviceStatus(device({ deviceStatus: 'sold' }), closing, [closing])).toBeNull();
  });
});

describe('stale / orphaned in-repair flags', () => {
  const staleOpen = repair({ createdAt: NOW - (PENDING_REPAIR_STALE_DAYS + 2) * DAY_MS });
  const freshOpen = repair({ createdAt: NOW - 2 * DAY_MS });
  const flagged = device({ deviceStatus: 'pending_repair' });

  it('flags a device whose ticket has been open past the threshold', () => {
    expect(isStalePendingRepair(flagged, [staleOpen], NOW)).toBe(true);
    expect(isStalePendingRepair(flagged, [freshOpen], NOW)).toBe(false);
  });
  it('does not flag a device that is not pending_repair', () => {
    expect(isStalePendingRepair(device({ deviceStatus: 'ready' }), [staleOpen], NOW)).toBe(false);
  });
  it('surfaces a pending_repair device with no open ticket at all instead of leaving it stuck', () => {
    expect(isOrphanedPendingRepair(flagged, [])).toBe(true);
    expect(isOrphanedPendingRepair(flagged, [repair({ status: 'cancelled' })])).toBe(true);
    expect(isOrphanedPendingRepair(flagged, [freshOpen])).toBe(false);
  });
  it('pendingRepairIssues reports both kinds and skips healthy devices', () => {
    const orphan = device({ id: 'dev-2', deviceStatus: 'pending_repair' });
    const healthy = device({ id: 'dev-3', deviceStatus: 'ready' });
    const issues = pendingRepairIssues([flagged, orphan, healthy], [staleOpen], NOW);
    expect(issues.map(i => [i.item.id, i.kind])).toEqual([['dev-1', 'stale'], ['dev-2', 'orphaned']]);
    expect(issues[0].repair?.repairNumber).toBe('RPR-000042');
    expect(issues[0].days).toBe(PENDING_REPAIR_STALE_DAYS + 2);
  });
  it('buildAlerts surfaces both as warnings', () => {
    const orphan = device({ id: 'dev-2', deviceStatus: 'pending_repair' });
    const kinds = buildAlerts({ inventory: [flagged, orphan], repairs: [staleOpen], now: NOW })
      .filter(a => a.kind.startsWith('repair_flag'));
    expect(kinds.map(a => a.kind)).toEqual(['repair_flag_stale', 'repair_flag_orphaned']);
    expect(kinds[0].text).toContain('RPR-000042');
    expect(kinds.every(a => a.severity === 'warning')).toBe(true);
  });
});
