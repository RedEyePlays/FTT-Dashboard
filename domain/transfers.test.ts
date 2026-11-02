import { describe, it, expect } from 'vitest';
import { AppUser, InventoryItem, InventoryTransfer, Location, SalesTransaction } from '../types';
import {
  TRANSFER_STALE_DAYS, isInTransit, transferBlock, canOverride, checkSend,
  canSendFrom, canReceive, canCancel, canSeeTransfer,
  buildTransfer, applySend, applyReceive, applyCancel, markReceived, markCancelled,
  inTransitTransfers, transferFor, daysInTransit, isStaleTransfer, staleTransfers, transitLabel,
} from './transfers';
import { inventoryTabOf, inTab } from './deviceSpecs';
import { profitAndLoss, ProfitLossInput } from './reports';
import { readFileSync } from 'fs';
import { join } from 'path';
import { auditActionLabel, isCriticalAuditAction } from './audit';

/**
 * MOVING STOCK BETWEEN STORES. MULTI-STORE STAGE 4.
 *
 * The four promises this stage lives or dies by:
 *
 *  1. THE DEVICE KEEPS ITS IDENTITY. Same record, same SKU, same cost, same
 *     repair history, same warranty start, same photos. Only locationId
 *     changes — never a delete-and-recreate, never a second row at the
 *     destination, because that is precisely what separate workspaces would
 *     have destroyed.
 *  2. A TRANSFER MOVES NO MONEY. Not revenue, not cost of goods, not an
 *     expense, nowhere, in any form. Asserted directly against the P&L.
 *  3. IN TRANSIT IS ON NEITHER SHELF — and still the company's asset, so it
 *     still counts in combined inventory value.
 *  4. THE RECEIVE IS NOT A FORMALITY. Nothing auto-receives and the sender
 *     cannot receive their own transfer; it is the only step that catches a
 *     device that never arrived.
 */

const BRAM = 'brampton';
const MISS = 'mississauga';
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'INV-000001', date: '2026-10-01', item: 'iPhone 14',
  imei: '351234567890123', boughtFrom: 'Walk-in', purchaseCost: 200, repairCost: 25,
  soldDate: '', soldTo: '', salePrice: 0, notes: '',
  deviceType: 'Phone', deviceStatus: 'ready', locationId: BRAM,
  ...p,
});

const loc = (id: string, name: string): Location => ({ id, name, active: true, createdAt: 1 });
const STORES = [loc(BRAM, 'Brampton'), loc(MISS, 'Mississauga')];

const user = (p: Partial<AppUser> = {}): AppUser =>
  ({ id: 'u1', email: 'u1@shop.test', role: 'employee', workspaceId: 'ws', ...p } as AppUser);

const sent = (items: InventoryItem[], from = BRAM, to = MISS, now = NOW) =>
  buildTransfer({ id: 't1', items, fromLocationId: from, toLocationId: to, actor: { id: 'sender', email: 's@shop.test' }, now });

/* ---------------- 1. The device keeps its identity ---------------- */

describe('A TRANSFERRED DEVICE IS THE SAME DEVICE', () => {
  const original = device({
    repairCost: 25,
    photos: [{ id: 'ph1', url: 'https://x/1.jpg', kind: 'real', addedBy: 'u1', addedAt: 1 }],
    sourceTicketId: 'tk-9', dropOffId: 'do-3', date: '2026-10-01',
  });
  const transfer = sent([original]);
  const inFlight = applySend(original, transfer.id);
  const arrived = applyReceive(inFlight, MISS);

  it('keeps its id, SKU, purchase cost, repair history, warranty start and photos', () => {
    expect(arrived.id).toBe(original.id);
    expect(arrived.sku).toBe(original.sku);
    expect(arrived.purchaseCost).toBe(200);
    expect(arrived.repairCost).toBe(25);
    expect(arrived.sourceTicketId).toBe('tk-9');
    expect(arrived.dropOffId).toBe('do-3');
    // Warranty runs from the sale, and the intake date is what every aging
    // and warranty calculation reads — neither moves with the device.
    expect(arrived.date).toBe('2026-10-01');
    expect(arrived.photos).toEqual(original.photos);
    expect(arrived.imei).toBe(original.imei);
  });

  it('ONLY locationId changed — nothing else, at all', () => {
    // The whole promise, stated as a diff. If anything else ever starts
    // moving with a device, this is what says so.
    const changed = Object.keys({ ...original, ...arrived })
      .filter(k => JSON.stringify((original as any)[k]) !== JSON.stringify((arrived as any)[k]));
    expect(changed).toEqual(['locationId']);
    expect(arrived.locationId).toBe(MISS);
  });

  it('and is not a new record — no second row at the destination', () => {
    expect(arrived.id).toBe(original.id);
    expect(arrived.sku).toBe(original.sku);
  });

  it('its deviceStatus is untouched, so a device in transit can still be in repair', () => {
    // Transit is NOT a deviceStatus value, deliberately: one field cannot
    // hold both "being moved" and "on the bench" without losing one.
    const onBench = device({ deviceStatus: 'pending_repair' });
    const moving = applySend(onBench, 't1');
    expect(moving.deviceStatus).toBe('pending_repair');
    expect(isInTransit(moving)).toBe(true);
    expect(applyReceive(moving, MISS).deviceStatus).toBe('pending_repair');
  });
});

/* ---------------- 2. A transfer moves no money ---------------- */

describe('A TRANSFER PRODUCES NO P&L ENTRY OF ANY KIND', () => {
  // Same company, one set of books. A transfer is not a sale and not a
  // purchase: not revenue at the destination, not an expense at the source,
  // not cost of goods anywhere.
  const stock = device({ id: 'd1', purchaseCost: 200, repairCost: 25 });
  const base: ProfitLossInput = {
    transactions: [], inventory: [stock], payPeriods: [], cashReconciliations: [],
    settlements: [], expenses: [], expenseCategories: [],
  };
  const pl = (inventory: InventoryItem[]) =>
    profitAndLoss({ ...base, inventory }, '2026-10-01', '2026-12-31');

  it('sending changes NOTHING in the P&L', () => {
    expect(pl([applySend(stock, 't1')])).toEqual(pl([stock]));
  });

  it('receiving changes NOTHING in the P&L', () => {
    expect(pl([applyReceive(applySend(stock, 't1'), MISS)])).toEqual(pl([stock]));
  });

  it('cancelling changes NOTHING in the P&L', () => {
    expect(pl([applyCancel(applySend(stock, 't1'))])).toEqual(pl([stock]));
  });

  it('and all of it is still zero revenue and zero cost of goods — nothing was sold', () => {
    const after = pl([applyReceive(applySend(stock, 't1'), MISS)]);
    expect(after.revenue).toBe(0);
    expect(after.costOfGoods).toBe(0);
    expect(after.grossProfit).toBe(0);
    expect(after.netProfit).toBe(0);
  });

  it('the transfer record itself carries no price the books could read', () => {
    const t = sent([stock]);
    // valueAtSend exists for a dispute about a device that vanished, and the
    // P&L never reads the transfers collection at all — ProfitLossInput has
    // no field for it.
    expect(Object.keys(base)).not.toContain('transfers');
    expect(t).not.toHaveProperty('salePrice');
    expect(t).not.toHaveProperty('revenue');
    expect(t.valueAtSend).toBe(225);
  });

  it('nothing in a transfer touches the fields the P&L reads', () => {
    const moving = applySend(stock, 't1');
    const arrived = applyReceive(moving, MISS);
    for (const row of [moving, arrived, applyCancel(moving)]) {
      expect(row.salePrice).toBe(0);
      expect(row.soldDate).toBe('');
      expect(row.purchaseCost).toBe(200);
      expect(row.repairCost).toBe(25);
    }
  });
});

describe('THE SELLING STORE TAKES THE PROFIT, at the original cost', () => {
  it('a device bought in Brampton for $200 and sold in Mississauga for $400 earns Mississauga $200', () => {
    const bought = device({ purchaseCost: 200, repairCost: 0, locationId: BRAM });
    const atMiss = applyReceive(applySend(bought, 't1'), MISS);
    // The sale happens where the device now is, with the cost that travelled
    // with it. No internal transfer price, no split.
    const soldThere: InventoryItem = { ...atMiss, soldDate: '2026-11-02', salePrice: 400 };
    expect(soldThere.locationId).toBe(MISS);
    expect(soldThere.purchaseCost).toBe(200);

    const pl = profitAndLoss({
      transactions: [], inventory: [soldThere], payPeriods: [], cashReconciliations: [],
      settlements: [], expenses: [], expenseCategories: [],
    }, '2026-11-01', '2026-11-30');
    expect(pl.revenue).toBe(400);
    expect(pl.costOfGoods).toBe(200);
    expect(pl.grossProfit).toBe(200);
  });
});

/* ---------------- 3. In transit is on neither shelf ---------------- */

describe('in transit belongs to neither store', () => {
  const stock = device();
  const moving = applySend(stock, 't1');

  it('sending takes it out of the SOURCE\'s sellable stock', () => {
    expect(inTab(stock, 'phones')).toBe(true);
    expect(inTab(moving, 'phones')).toBe(false);
  });

  it('and it is NOT YET in the destination\'s', () => {
    // locationId has not moved — it has not arrived.
    expect(moving.locationId).toBe(BRAM);
    expect(inventoryTabOf(moving)).toBe('intransit');
  });

  it('IT IS NOT SOLD, and does not hide in Sold', () => {
    expect(inTab(moving, 'sold')).toBe(false);
  });

  it('IT STILL COUNTS IN COMBINED INVENTORY VALUE — it is the company\'s asset throughout', () => {
    // The Dashboard's inventory tiles count every device that is not sold and
    // not returned (components/Dashboard.tsx's `held`). In transit is neither,
    // so it keeps counting — which is only true because transit is not a
    // deviceStatus.
    const held = (i: InventoryItem) => !i.soldDate && i.deviceStatus !== 'sold' && i.deviceStatus !== 'returned';
    expect(held(moving)).toBe(true);
    expect((moving.purchaseCost || 0) + (moving.repairCost || 0)).toBe(225);
  });

  it('receiving puts it in the destination\'s normal stock', () => {
    const arrived = applyReceive(moving, MISS);
    expect(isInTransit(arrived)).toBe(false);
    expect(arrived.locationId).toBe(MISS);
    expect(inTab(arrived, 'phones')).toBe(true);
    expect(inTab(arrived, 'intransit')).toBe(false);
  });

  it('CANCELLING RETURNS IT TO THE SOURCE, unchanged', () => {
    const back = applyCancel(moving);
    expect(back).toEqual(stock);
    expect(back.locationId).toBe(BRAM);
    expect(inTab(back, 'phones')).toBe(true);
  });

  it('a laptop in transit is in In Transit, not in Laptops', () => {
    const laptop = applySend(device({ deviceType: 'Laptop', item: 'Dell XPS 15' }), 't1');
    expect(inventoryTabOf(laptop)).toBe('intransit');
    expect(inTab(laptop, 'laptops')).toBe(false);
  });
});

/* ---------------- What cannot be sent ---------------- */

describe('what cannot be sent', () => {
  it('A RESERVED DEVICE NEEDS A DELIBERATE OVERRIDE — somebody paid a deposit', () => {
    const reserved = device({ deviceStatus: 'reserved' });
    expect(transferBlock(reserved)).toBe('reserved');
    expect(canOverride('reserved')).toBe(true);

    const refused = checkSend([reserved]);
    expect(refused.sendable).toEqual([]);
    expect(refused.blocked.map(b => b.block)).toEqual(['reserved']);

    const forced = checkSend([reserved], { overrideReservedIds: [reserved.id] });
    expect(forced.sendable).toEqual([reserved]);
    expect(forced.overridden).toEqual([reserved]);
  });

  it('and the override is RECORDED on the transfer, not left as an untraceable decision', () => {
    const reserved = device({ deviceStatus: 'reserved' });
    const t = buildTransfer({
      id: 't1', items: [reserved], fromLocationId: BRAM, toLocationId: MISS,
      actor: { id: 'sender' }, now: NOW, overriddenIds: [reserved.id],
    });
    expect(t.reservedOverrides).toEqual([reserved.id]);
  });

  it('a sold device cannot be sent, and no override exists for it', () => {
    expect(transferBlock(device({ soldDate: '2026-10-05' }))).toBe('sold');
    expect(canOverride('sold')).toBe(false);
    expect(checkSend([device({ soldDate: '2026-10-05' })], { overrideReservedIds: ['d1'] }).sendable).toEqual([]);
  });

  it('a device already in transit cannot be sent again', () => {
    expect(transferBlock(applySend(device(), 't1'))).toBe('in_transit');
    expect(canOverride('in_transit')).toBe(false);
  });

  it('ACCESSORIES ARE OUT OF SCOPE — a quantity cannot be split cleanly', () => {
    expect(transferBlock(device({ kind: 'accessory', quantity: 20 }))).toBe('accessory');
    expect(canOverride('accessory')).toBe(false);
  });

  it('an ordinary ready device is sendable', () => {
    expect(transferBlock(device())).toBeNull();
    expect(checkSend([device()]).sendable).toHaveLength(1);
  });

  it('sorts a mixed batch into what can go and what cannot', () => {
    const ok = device({ id: 'ok' });
    const sold = device({ id: 'sold', soldDate: '2026-10-05' });
    const res = device({ id: 'res', deviceStatus: 'reserved' });
    const out = checkSend([ok, sold, res]);
    expect(out.sendable.map(i => i.id)).toEqual(['ok']);
    expect(out.blocked.map(b => b.item.id)).toEqual(['sold', 'res']);
  });
});

/* ---------------- 4. Who may do what ---------------- */

describe('who may send, receive and cancel', () => {
  const bram = user({ id: 'b1', locationIds: [BRAM] });
  const miss = user({ id: 'm1', locationIds: [MISS] });
  const both = user({ id: 'x1', locationIds: [BRAM, MISS] });
  const owner = user({ id: 'o1', role: 'owner' });
  const nolist = user({ id: 'n1' });
  const transfer: InventoryTransfer = { ...sent([device()]), sentBy: bram.id };

  it('sending is staff at the SENDING store', () => {
    expect(canSendFrom(bram, STORES, BRAM)).toBe(true);
    expect(canSendFrom(bram, STORES, MISS)).toBe(false);
    expect(canSendFrom(owner, STORES, MISS)).toBe(true);
  });

  it('an EMPTY store list means the default store, not no access', () => {
    // Stage 2's rule, unchanged. Brampton is the default here.
    expect(canSendFrom(nolist, STORES, BRAM)).toBe(true);
  });

  it('receiving is staff at the RECEIVING store', () => {
    expect(canReceive(miss, STORES, transfer)).toBe(true);
    expect(canReceive(bram, STORES, transfer)).toBe(false);
  });

  it('THE SENDER CANNOT RECEIVE THEIR OWN TRANSFER, even working both stores', () => {
    // The two-step is the only thing that catches a device that never
    // arrived; a sender confirming their own delivery would make it a
    // formality again.
    const bothSent: InventoryTransfer = { ...transfer, sentBy: both.id };
    expect(canReceive(both, STORES, bothSent)).toBe(false);
    // Somebody ELSE who works both stores still can.
    expect(canReceive(both, STORES, transfer)).toBe(true);
  });

  it('nothing receives a transfer that is not in transit', () => {
    expect(canReceive(miss, STORES, { ...transfer, status: 'received' })).toBe(false);
    expect(canReceive(miss, STORES, { ...transfer, status: 'cancelled' })).toBe(false);
  });

  it('CANCELLING is the sender or the owner — and never the receiving store', () => {
    expect(canCancel(bram, transfer)).toBe(true);
    expect(canCancel(owner, transfer)).toBe(true);
    // "It never arrived, so I'll cancel it" is the move that erases a
    // discrepancy somebody needs to chase.
    expect(canCancel(miss, transfer)).toBe(false);
    expect(canCancel(user({ id: 'other' }), transfer)).toBe(false);
  });

  it('BOTH STORES AND THE OWNER SEE AN IN-TRANSIT TRANSFER', () => {
    // In transit is where things get lost, and a device nobody is looking at
    // is a device nobody chases.
    expect(canSeeTransfer(bram, STORES, transfer)).toBe(true);
    expect(canSeeTransfer(miss, STORES, transfer)).toBe(true);
    expect(canSeeTransfer(owner, STORES, transfer)).toBe(true);
  });
});

/* ---------------- Visibility ---------------- */

describe('what is in transit, and what has been too long', () => {
  const t = (id: string, days: number, status: InventoryTransfer['status'] = 'in_transit'): InventoryTransfer =>
    ({ ...sent([device()]), id, status, sentAt: NOW - days * DAY });

  it('lists what is in transit, oldest first', () => {
    const list = inTransitTransfers([t('new', 0), t('old', 5), t('done', 9, 'received')]);
    expect(list.map(x => x.id)).toEqual(['old', 'new']);
  });

  it('FLAGS A TRANSFER UNRECEIVED FOR THREE DAYS', () => {
    // The shortest threshold in the app, because in transit is the one state
    // with nobody responsible for it. The two stores are a drive across town.
    expect(TRANSFER_STALE_DAYS).toBe(3);
    expect(isStaleTransfer(t('a', 2), NOW)).toBe(false);
    expect(isStaleTransfer(t('b', 3), NOW)).toBe(true);
    expect(staleTransfers([t('a', 1), t('b', 4)], NOW).map(x => x.id)).toEqual(['b']);
  });

  it('never flags one that arrived or was cancelled', () => {
    expect(isStaleTransfer(t('a', 30, 'received'), NOW)).toBe(false);
    expect(isStaleTransfer(t('b', 30, 'cancelled'), NOW)).toBe(false);
  });

  it('counts days without drifting on the clock', () => {
    expect(daysInTransit({ sentAt: NOW - 2 * DAY - 3600_000 }, NOW)).toBe(2);
    expect(daysInTransit({ sentAt: NOW + 5000 }, NOW)).toBe(0);
  });

  it("says on the device's own screen where it is and where it is going", () => {
    const name = (id: string) => (id === MISS ? 'Mississauga' : 'Brampton');
    expect(transitLabel(t('a', 0), name, NOW)).toBe('In transit to Mississauga · sent today');
    expect(transitLabel(t('b', 1), name, NOW)).toBe('In transit to Mississauga · sent yesterday');
    expect(transitLabel(t('c', 4), name, NOW)).toBe('In transit to Mississauga · sent 4 days ago');
    // A device whose transfer cannot be found still says it is in transit
    // rather than claiming to be on a shelf.
    expect(transitLabel(undefined, name, NOW)).toBe('In transit');
  });

  it('finds the transfer a device is on', () => {
    const moving = applySend(device(), 't1');
    const list = [sent([device()])];
    expect(transferFor(moving, list)?.id).toBe('t1');
    expect(transferFor(device(), list)).toBeUndefined();
  });
});

/* ---------------- The record itself ---------------- */

describe('the transfer record', () => {
  // Costs spelled out, because valueAtSend is purchase + repair for each.
  const items = [
    device({ id: 'a', purchaseCost: 100, repairCost: 10 }),
    device({ id: 'b', purchaseCost: 50, repairCost: 0 }),
  ];

  it('records which devices, from where, to where, who sent it and when', () => {
    const t = buildTransfer({
      id: 't1', items, fromLocationId: BRAM, toLocationId: MISS,
      actor: { id: 'sender', email: 's@shop.test' }, now: NOW, note: ' two phones ',
    });
    expect(t).toMatchObject({
      id: 't1', itemIds: ['a', 'b'], fromLocationId: BRAM, toLocationId: MISS,
      status: 'in_transit', sentAt: NOW, sentBy: 'sender', sentByEmail: 's@shop.test',
      note: 'two phones', valueAtSend: 160,
    });
    // Nothing is received or cancelled on the way out.
    expect(t.receivedAt).toBeUndefined();
    expect(t.cancelledAt).toBeUndefined();
  });

  it('records who received it and when, keeping everything from the dispatch', () => {
    const t = markReceived(sent(items), { id: 'receiver', email: 'r@shop.test' }, NOW + DAY);
    expect(t).toMatchObject({
      status: 'received', receivedAt: NOW + DAY, receivedBy: 'receiver', receivedByEmail: 'r@shop.test',
      sentBy: 'sender', sentAt: NOW, itemIds: ['a', 'b'],
    });
  });

  it('records a cancel with both timestamps, so a late cancel is visible', () => {
    const t = markCancelled(sent(items), { id: 'sender' }, NOW + 5 * DAY);
    expect(t.status).toBe('cancelled');
    expect(t.cancelledAt).toBe(NOW + 5 * DAY);
    expect(t.sentAt).toBe(NOW);
    expect(t.cancelledBy).toBe('sender');
  });
});

/* ---------------- The trail ---------------- */

describe('SEND, RECEIVE AND CANCEL ARE ALL AUDITED, with who did each', () => {
  const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('each of the three acts writes its own audit entry', () => {
    // In transit is where things get lost; "who sent it and who said it
    // arrived" is the question afterwards, and the audit log is where it is
    // answered. Checked against the real call sites with comments stripped,
    // because the prose in that file names these actions too.
    for (const action of ['transfer.send', 'transfer.receive', 'transfer.cancel']) {
      expect({ action, called: app.includes(`audit('${action}'`) }).toEqual({ action, called: true });
    }
  });

  it('and each reads as English in the log rather than as a raw token', () => {
    expect(auditActionLabel('transfer.send')).toBe('Stock sent to another store');
    expect(auditActionLabel('transfer.receive')).toBe('Stock received from another store');
    expect(auditActionLabel('transfer.cancel')).toBe('Stock transfer cancelled');
  });

  it('A CANCEL IS ON THE CRITICAL LIST — it is the one that could hide a loss', () => {
    // "It never arrived, so I'll cancel it" would put the device back on a
    // shelf it is not on. The sender and the owner are the only ones who can
    // (domain/transfers.ts's canCancel), and it is one click to filter for.
    expect(isCriticalAuditAction('transfer.cancel')).toBe(true);
  });

  it('nothing in the transfer paths writes a sale, an expense or a drawer entry', () => {
    // The P&L assertion above proves the figures; this proves the mechanism —
    // a transfer is not a sale and not a purchase, so none of these three
    // handlers may reach for the paths that move money.
    const handlers = /const handleSendTransfer[\s\S]*?const handleBulkImport/.exec(app)?.[0] || '';
    expect(handlers).toBeTruthy();
    for (const forbidden of ['commitSale', 'commitDrawerRecord', 'saveExpense', 'salePrice', 'soldDate']) {
      expect({ forbidden, used: handlers.includes(forbidden) }).toEqual({ forbidden, used: false });
    }
  });
});
