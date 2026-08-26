import { InventoryItem, Repair, ViewState } from '../types';
import { kindOf, getDeviceDisplayName } from './inventory';
import { toISODate } from './dates';

// --- Actionable alerts ------------------------------------------------------
//
// Standing conditions worth surfacing in the notifications menu — distinct from
// the chronological activity feed. Everything here is derived from data the app
// already tracks (accessory stock levels, repair status + estimated completion),
// so no new tracking is introduced. Pure and testable, like domain/analytics.ts.

export const DAY_MS = 86_400_000;

// How long a repair may sit in "Ready for Pickup" before it's flagged as a likely
// forgotten pickup.
export const READY_PICKUP_STALE_DAYS = 3;

// How long an unsold device may sit in inventory (measured from its intake date)
// before it's flagged as aging stock. Overridable per call, same as
// READY_PICKUP_STALE_DAYS — the alert-threshold pattern in this module.
export const AGING_INVENTORY_DAYS = 30;

export type AlertKind = 'low_stock' | 'repair_overdue' | 'repair_awaiting_pickup' | 'aging_inventory';

export interface Alert {
  id: string;           // stable, dedupable (e.g. "low_stock:<itemId>")
  kind: AlertKind;
  text: string;
  severity: 'warning' | 'info';
  view: ViewState;      // where to go to act on it
}

const todayISO = (now: number): string => toISODate(now);

// --- Predicates (reused from the Inventory / Repairs views) -----------------

/** An accessory at or below its low-stock threshold (mirrors InventoryView.isLow). */
export const isLowStockAccessory = (i: InventoryItem): boolean =>
  kindOf(i) === 'accessory' && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0);

/**
 * A repair past its estimated completion date and not yet done. Mirrors
 * RepairsView.isOverdue, and additionally excludes the terminal states
 * (`ready_pickup`, `picked_up`) that aren't actionable as "late work": a
 * ready-for-pickup device is handled by the awaiting-pickup alert instead, so a
 * single repair never raises two overlapping alerts.
 */
export const isOverdueRepair = (r: Repair, now: number): boolean =>
  r.status !== 'completed' && r.status !== 'cancelled' &&
  r.status !== 'ready_pickup' && r.status !== 'picked_up' &&
  !!r.estimatedCompletion && r.estimatedCompletion < todayISO(now);

// The best available "ready since" reference without new tracking: the promised
// completion date if set, otherwise the ticket's creation time.
const readyReferenceMs = (r: Repair): number =>
  r.estimatedCompletion ? new Date(`${r.estimatedCompletion}T00:00:00`).getTime() : r.createdAt;

/** A repair sitting in "Ready for Pickup" longer than `staleDays`. */
export const isAwaitingPickup = (r: Repair, now: number, staleDays: number = READY_PICKUP_STALE_DAYS): boolean =>
  r.status === 'ready_pickup' && now - readyReferenceMs(r) > staleDays * DAY_MS;

// Intake date (Date In / purchase date) as epoch ms; 0 if missing/invalid.
const intakeMs = (i: InventoryItem): number => {
  if (!i.date) return 0;
  const t = new Date(`${i.date}T00:00:00`).getTime();
  return isNaN(t) ? 0 : t;
};

/** Whole days a device has sat in stock since intake (0 if the date is unknown). */
export const deviceAgeDays = (i: InventoryItem, now: number): number => {
  const ms = intakeMs(i);
  return ms ? Math.floor((now - ms) / DAY_MS) : 0;
};

/**
 * An unsold device that has been held in inventory longer than `agingDays`.
 * "Unsold" excludes anything already sold, spoken for on a layaway (`reserved`)
 * or returned — only stock you still own and mean to sell counts as aging.
 */
export const isAgingDevice = (i: InventoryItem, now: number, agingDays: number = AGING_INVENTORY_DAYS): boolean =>
  kindOf(i) === 'device' && !i.soldDate &&
  i.deviceStatus !== 'sold' && i.deviceStatus !== 'reserved' && i.deviceStatus !== 'returned' &&
  intakeMs(i) > 0 && now - intakeMs(i) > agingDays * DAY_MS;

// --- Builder ----------------------------------------------------------------

export interface AlertsInput {
  inventory: InventoryItem[];
  repairs: Repair[];
  now: number;
  readyStaleDays?: number;
  agingDays?: number;
}

/**
 * Build the current actionable alert set: low-stock accessories, overdue repairs,
 * repairs awaiting pickup too long, and unsold devices aging in inventory.
 * Warnings first, then info.
 */
export const buildAlerts = ({ inventory, repairs, now, readyStaleDays = READY_PICKUP_STALE_DAYS, agingDays = AGING_INVENTORY_DAYS }: AlertsInput): Alert[] => {
  const alerts: Alert[] = [];

  for (const i of inventory) {
    if (isLowStockAccessory(i)) {
      alerts.push({
        id: `low_stock:${i.id}`,
        kind: 'low_stock',
        severity: 'warning',
        view: 'grid',
        text: `${i.item || 'Accessory'} is low on stock (${i.quantity ?? 0} left)`,
      });
    }
  }

  for (const r of repairs) {
    if (isOverdueRepair(r, now)) {
      alerts.push({
        id: `repair_overdue:${r.id}`,
        kind: 'repair_overdue',
        severity: 'warning',
        view: 'repairs',
        text: `${r.repairNumber} is overdue${r.customerName ? ` · ${r.customerName}` : ''}`,
      });
    }
  }

  for (const r of repairs) {
    if (isAwaitingPickup(r, now, readyStaleDays)) {
      alerts.push({
        id: `repair_awaiting_pickup:${r.id}`,
        kind: 'repair_awaiting_pickup',
        severity: 'info',
        view: 'repairs',
        text: `${r.repairNumber} ready for pickup — awaiting collection${r.customerName ? ` · ${r.customerName}` : ''}`,
      });
    }
  }

  for (const i of inventory) {
    if (isAgingDevice(i, now, agingDays)) {
      const name = getDeviceDisplayName(i);
      alerts.push({
        id: `aging_inventory:${i.id}`,
        kind: 'aging_inventory',
        severity: 'info',
        view: 'grid',
        text: `${name === '—' ? (i.sku || 'Device') : name} has sat unsold ${deviceAgeDays(i, now)} days`,
      });
    }
  }

  return alerts;
};
