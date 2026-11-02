import {
  AppUser, InventoryItem, InventoryTransfer, Location, TransferStatus,
} from '../types';
import { permittedLocations } from './locations';

/**
 * MOVING STOCK BETWEEN STORES. MULTI-STORE STAGE 4.
 *
 * The thing the owner asked for first — "I'd wanna like send some inventory to
 * the other store" — and the single reason this is one workspace with
 * locations rather than two separate workspaces.
 *
 * THE DEVICE KEEPS ITS IDENTITY. Same record, same id, same SKU, same purchase
 * cost, same repair history, same warranty start, same photos. Only
 * `locationId` changes, and only on receipt. A transfer is NEVER a
 * delete-and-recreate and never a second row at the destination: that would
 * destroy exactly what separate workspaces would have destroyed.
 *
 * A TRANSFER MOVES NO MONEY. It is not a sale and not a purchase: not revenue
 * at the destination, not an expense at the source, not cost of goods
 * anywhere. Nothing in this module produces a transaction, an expense or a
 * drawer entry, and nothing touches `salePrice`, `soldDate`, `purchaseCost` or
 * `repairCost`. The only P&L effect is indirect — the eventual sale lands at
 * whichever store the device was at, because cost travels with the device and
 * the SELLING store takes the profit.
 *
 * TWO SEPARATE ACTS, and the second one is the point. Sending takes a device
 * out of the sending store's sellable stock; receiving puts it into the
 * destination's. In between it is on neither shelf — and still the company's
 * asset, so it still counts in combined inventory value. Nothing
 * auto-receives, because the receive is the only step that catches a device
 * that never arrived.
 *
 * Pure: no Firestore, no DOM, no clock.
 */

/**
 * How long a transfer may sit unreceived before it reads as lost.
 *
 * THREE DAYS. The two stores are a drive across town and same-day is the norm,
 * so three days covers a Friday evening send unpacked on Monday and flags
 * anything slower. Deliberately the SHORTEST threshold in the app — aging
 * stock is 30 days and a forgotten repair flag is 14 (domain/alerts.ts) —
 * because in transit is the one state with nobody responsible for it: the
 * sender thinks it is gone and the receiver does not know it is coming. The
 * shop already has 44 devices rotting in repair; unreceived transfers would
 * rot the same way without a nudge.
 */
export const TRANSFER_STALE_DAYS = 3;

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ---------------- Reading a device's state ---------------- */

/** In a car right now: on neither store's shelf. */
export const isInTransit = (item: Pick<InventoryItem, 'inTransferId'>): boolean =>
  !!(item.inTransferId || '').trim();

const isSold = (item: Pick<InventoryItem, 'soldDate' | 'deviceStatus'>): boolean =>
  !!item.soldDate || item.deviceStatus === 'sold';

/**
 * WHY A DEVICE CANNOT BE SENT, or null when it can.
 *
 *   'accessory'  — accessories are not transferable here. See TRANSFER_SCOPE.
 *   'sold'       — it is not the shop's to move.
 *   'in_transit' — it is already in a car.
 *   'reserved'   — SOMEBODY HAS PAID A DEPOSIT ON IT. Transferable only by a
 *                  deliberate override, which is recorded on the transfer.
 */
export type TransferBlock = 'accessory' | 'sold' | 'in_transit' | 'reserved';

export const transferBlock = (
  item: Pick<InventoryItem, 'kind' | 'soldDate' | 'deviceStatus' | 'inTransferId'>,
): TransferBlock | null => {
  if ((item.kind ?? 'device') === 'accessory') return 'accessory';
  if (isSold(item)) return 'sold';
  if (isInTransit(item)) return 'in_transit';
  if (item.deviceStatus === 'reserved') return 'reserved';
  return null;
};

/** Only 'reserved' may be overridden, and only on purpose. */
export const canOverride = (block: TransferBlock | null): boolean => block === 'reserved';

export const TRANSFER_BLOCK_MESSAGE: Record<TransferBlock, string> = {
  accessory: 'Accessories are not transferred here — only devices.',
  sold: 'Already sold, so it is not the shop\'s to move.',
  in_transit: 'Already in transit on another transfer.',
  reserved: 'Reserved for a layaway — somebody has paid a deposit on it. Send it only if you mean to, and the override is recorded on the transfer.',
};

/**
 * ACCESSORIES ARE OUT OF SCOPE, and it is not laziness.
 *
 * A device is one serialized thing and a transfer moves it whole. An accessory
 * is a QUANTITY: sending "6 of 20 cables" is a split, and the record has one
 * `quantity` on one row with no per-store breakdown to split it into. Doing it
 * properly means either a quantity-per-location shape or a second row at the
 * destination — the second being exactly the duplicate-record design this
 * stage exists to avoid. Devices were the ask; this stays a device transfer
 * until the model can hold a split cleanly.
 */
export const TRANSFER_SCOPE = 'devices' as const;

/** The devices in a transfer that may actually be sent, and why not. */
export interface SendCheck {
  sendable: InventoryItem[];
  blocked: { item: InventoryItem; block: TransferBlock }[];
  /** Reserved devices the caller has explicitly chosen to send anyway. */
  overridden: InventoryItem[];
}

export const checkSend = (
  items: InventoryItem[],
  opts: { overrideReservedIds?: string[] } = {},
): SendCheck => {
  const overrides = new Set(opts.overrideReservedIds || []);
  const out: SendCheck = { sendable: [], blocked: [], overridden: [] };
  for (const item of items || []) {
    const block = transferBlock(item);
    if (!block) { out.sendable.push(item); continue; }
    if (canOverride(block) && overrides.has(item.id)) {
      out.sendable.push(item);
      out.overridden.push(item);
      continue;
    }
    out.blocked.push({ item, block });
  }
  return out;
};

/* ---------------- Who may send, receive and cancel ---------------- */

/**
 * The stores a person may act at — stage 2's rule, unchanged and not
 * reinvented: `users.locationIds` is the list, an EMPTY list means the DEFAULT
 * store rather than no access, and the owner holds every store.
 */
export const actableStores = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
): Location[] => permittedLocations(user, locations);

const actsAt = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
  locationId: string,
): boolean => !!locationId && actableStores(user, locations).some(l => l.id === locationId);

/** SENDING is staff at the sending store. */
export const canSendFrom = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
  fromLocationId: string,
): boolean => actsAt(user, locations, fromLocationId);

/**
 * RECEIVING is staff at the receiving store — AND NEVER THE SENDER.
 *
 * The two-step exists to catch a device that never arrived, so a sender who
 * could confirm their own delivery would turn the receive back into the
 * formality it must not be. Somebody who works both stores still performs
 * both steps, as two acts by two people where possible and as two deliberate
 * acts at minimum.
 */
export const canReceive = (
  user: Pick<AppUser, 'id' | 'role' | 'locationIds'> | undefined,
  locations: Location[],
  transfer: Pick<InventoryTransfer, 'status' | 'toLocationId' | 'sentBy'>,
): boolean =>
  transfer.status === 'in_transit'
  && !!user
  && user.id !== transfer.sentBy
  && actsAt(user, locations, transfer.toLocationId);

/**
 * CANCELLING is THE SENDER OR THE OWNER, and deliberately not the receiving
 * store.
 *
 * Cancel means "it never left" — which only the sending side can know. It
 * returns the devices to the store that already had them, grants access to
 * nothing and moves no money, so there is no reason to make the shop wait for
 * the owner to undo a mistyped transfer.
 *
 * THE RECEIVING STORE IS EXCLUDED ON PURPOSE. "It never arrived, so I'll
 * cancel it" is precisely the move that erases a discrepancy somebody needs
 * to chase, and it would make the unreceived-transfer flag cancellable by the
 * one person it is pointed at. A cancel long after the send is still visible
 * either way: the record keeps both timestamps, and the audit entry keeps who.
 */
export const canCancel = (
  user: Pick<AppUser, 'id' | 'role'> | undefined,
  transfer: Pick<InventoryTransfer, 'status' | 'sentBy'>,
): boolean =>
  transfer.status === 'in_transit'
  && !!user
  && (user.id === transfer.sentBy || user.role === 'owner');

/** Both stores and the owner see a transfer — in transit is where things get lost. */
export const canSeeTransfer = (
  user: Pick<AppUser, 'role' | 'locationIds'> | undefined,
  locations: Location[],
  transfer: Pick<InventoryTransfer, 'fromLocationId' | 'toLocationId'>,
): boolean =>
  user?.role === 'owner'
  || actsAt(user, locations, transfer.fromLocationId)
  || actsAt(user, locations, transfer.toLocationId);

/* ---------------- Building the three acts ---------------- */

export interface TransferActor { id: string; email?: string }

/**
 * The transfer record for a dispatch. Pure — the caller writes it alongside
 * the device patches below, in ONE batch, so a device can never be marked in
 * transit without the record that says where it is going.
 */
export const buildTransfer = (input: {
  id: string;
  items: InventoryItem[];
  fromLocationId: string;
  toLocationId: string;
  actor: TransferActor;
  now: number;
  note?: string;
  overriddenIds?: string[];
}): InventoryTransfer => ({
  id: input.id,
  itemIds: input.items.map(i => i.id),
  fromLocationId: input.fromLocationId,
  toLocationId: input.toLocationId,
  status: 'in_transit',
  sentAt: input.now,
  sentBy: input.actor.id,
  ...(input.actor.email ? { sentByEmail: input.actor.email } : {}),
  ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  ...(input.overriddenIds?.length ? { reservedOverrides: [...input.overriddenIds] } : {}),
  // Informational only — a transfer moves no money. It makes a dispute about
  // a device that vanished answerable at the value it had when it was sent.
  valueAtSend: round2(input.items.reduce((n, i) => n + (i.purchaseCost || 0) + (i.repairCost || 0), 0)),
});

/**
 * SENDING: the device leaves the sending store's sellable stock, and NOTHING
 * ELSE about it changes.
 *
 * `locationId` is deliberately untouched — it still says where the device came
 * from until somebody confirms it arrived. `deviceStatus` is untouched too, so
 * a device that was `pending_repair` still is.
 */
export const applySend = (item: InventoryItem, transferId: string): InventoryItem =>
  ({ ...item, inTransferId: transferId });

/**
 * RECEIVING: the location moves, and the device returns to normal stock.
 *
 * This is the ONLY place a transfer changes `locationId`, and it is the moment
 * the destination store starts owning the eventual profit — cost travelled
 * with the device, untouched.
 */
export const applyReceive = (item: InventoryItem, toLocationId: string): InventoryItem => {
  const { inTransferId: _gone, ...rest } = item;
  return { ...rest, locationId: toLocationId };
};

/**
 * CANCELLING: the device is exactly as it was.
 *
 * Nothing to restore, which is the point of not having moved `locationId` on
 * dispatch: it never left the sending store's books, so a cancel is a single
 * field being cleared.
 */
export const applyCancel = (item: InventoryItem): InventoryItem => {
  const { inTransferId: _gone, ...rest } = item;
  return rest;
};

export const markReceived = (
  transfer: InventoryTransfer, actor: TransferActor, now: number,
): InventoryTransfer => ({
  ...transfer,
  status: 'received' as TransferStatus,
  receivedAt: now,
  receivedBy: actor.id,
  ...(actor.email ? { receivedByEmail: actor.email } : {}),
});

export const markCancelled = (
  transfer: InventoryTransfer, actor: TransferActor, now: number,
): InventoryTransfer => ({
  ...transfer,
  status: 'cancelled' as TransferStatus,
  cancelledAt: now,
  cancelledBy: actor.id,
  ...(actor.email ? { cancelledByEmail: actor.email } : {}),
});

/* ---------------- Looking at what is in transit ---------------- */

export const inTransitTransfers = (transfers: InventoryTransfer[]): InventoryTransfer[] =>
  (transfers || []).filter(t => t.status === 'in_transit').sort((a, b) => a.sentAt - b.sentAt);

/** The transfer a device is currently on, if any. */
export const transferFor = (
  item: Pick<InventoryItem, 'inTransferId'>,
  transfers: InventoryTransfer[],
): InventoryTransfer | undefined =>
  (item.inTransferId ? (transfers || []).find(t => t.id === item.inTransferId) : undefined);

export const daysInTransit = (t: Pick<InventoryTransfer, 'sentAt'>, now: number): number =>
  Math.max(0, Math.floor((now - (t.sentAt || 0)) / DAY_MS));

/** Unreceived for longer than the threshold — a device nobody is chasing. */
export const isStaleTransfer = (
  t: Pick<InventoryTransfer, 'status' | 'sentAt'>,
  now: number,
  days: number = TRANSFER_STALE_DAYS,
): boolean => t.status === 'in_transit' && daysInTransit(t, now) >= days;

export const staleTransfers = (
  transfers: InventoryTransfer[],
  now: number,
  days: number = TRANSFER_STALE_DAYS,
): InventoryTransfer[] => inTransitTransfers(transfers).filter(t => isStaleTransfer(t, now, days));

/**
 * "In transit to Mississauga · sent 2 days ago" — what a device's own screen
 * says about where it is, so the answer is on the record rather than only on
 * the transfers screen.
 */
export const transitLabel = (
  t: Pick<InventoryTransfer, 'toLocationId' | 'sentAt'> | undefined,
  storeName: (id: string) => string,
  now: number,
): string => {
  if (!t) return 'In transit';
  const days = daysInTransit(t, now);
  const when = days === 0 ? 'sent today' : days === 1 ? 'sent yesterday' : `sent ${days} days ago`;
  return `In transit to ${storeName(t.toLocationId)} · ${when}`;
};
