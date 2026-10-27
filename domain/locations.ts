import { COMPANY_LOCATION_ID, Location } from '../types';

/**
 * WHERE A RECORD BELONGS. STAGE 1 OF MULTI-STORE.
 *
 * FlipThatTech is opening a second store in Mississauga: same company (Roxen
 * International Canada Inc.), one set of books, filterable by store — not
 * separate entities.
 *
 * THIS STAGE CHANGES NOTHING ANYONE CAN SEE. Its only job is that every record
 * knows where it belongs, with existing data correctly assigned to Brampton.
 * Per-store drawers, kiosk stamping, transfers and a filterable P&L are later
 * stages; nothing here branches on a location, and a record with no
 * `locationId` behaves exactly as it does today. That is what makes stage 1
 * invisible and reversible.
 *
 * LOCATIONS ARE DATA, NOT A SETTINGS STRING. `settings.general.storeName` is
 * one string on receipts; records need something to POINT AT so a renamed
 * store does not orphan its history, and so stage 4's transfers have a
 * reference. The settings string is deliberately untouched and still drives
 * receipts.
 *
 * Pure: no Firestore, no DOM.
 */

export { COMPANY_LOCATION_ID };

/* ---------------- Seeding the first store ---------------- */

/**
 * Brampton, from what the shop has already typed.
 *
 * Built from `settings.general` so the name and address are not retyped and
 * receipts keep printing exactly what they print today. It is the DEFAULT
 * location, and the one the backfill assigns existing data to.
 */
export const seedLocationFrom = (
  general: { storeName?: string; address?: string },
  now: number,
  id: string,
  createdBy?: string,
): Location => ({
  id,
  // Falls back to the app default rather than an empty name: a location with
  // no name is unpickable, and an empty store name in settings is possible.
  name: (general.storeName || '').trim() || 'Main store',
  ...((general.address || '').trim() ? { address: general.address!.trim() } : {}),
  active: true,
  isDefault: true,
  createdAt: now,
  ...(createdBy ? { createdBy } : {}),
});

/** Has this workspace been set up for multiple stores yet? */
export const hasLocations = (locations: Location[]): boolean => (locations || []).length > 0;

/* ---------------- Reading the list ---------------- */

/** Pickable stores, named A→Z with the default first. */
export const activeLocations = (locations: Location[]): Location[] =>
  (locations || [])
    .filter(l => l.active)
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name));

export const defaultLocation = (locations: Location[]): Location | undefined =>
  (locations || []).find(l => l.isDefault && l.active)
  || (locations || []).find(l => l.isDefault)
  || activeLocations(locations)[0];

/**
 * What to show for a stored id.
 *
 * Resolves a DEACTIVATED location too — history pointing at a closed store
 * must still read, which is the whole reason deactivating is not deleting.
 * An unknown id reads as unknown rather than blank, because a blank cell looks
 * like missing data when it is actually a dangling reference.
 */
export const locationName = (locations: Location[], id?: string): string => {
  if (!id) return '';
  if (id === COMPANY_LOCATION_ID) return 'Company (no store)';
  const found = (locations || []).find(l => l.id === id);
  if (!found) return 'Unknown location';
  return found.active ? found.name : `${found.name} (closed)`;
};

/* ---------------- Changing the list ---------------- */

export type LocationProblem = 'no-name' | 'duplicate-name' | 'reserved-id';

export const LOCATION_PROBLEM_MESSAGE: Record<LocationProblem, string> = {
  'no-name': 'Give the store a name.',
  'duplicate-name': 'There is already a store with that name.',
  // COMPANY_LOCATION_ID is a sentinel used on expenses, not a place.
  'reserved-id': 'That name is reserved.',
};

/**
 * May this be saved? Names must be distinct, since a picker showing two
 * "Mississauga" entries is unusable and the id is not what anybody reads.
 */
export const checkLocation = (
  draft: Pick<Location, 'id' | 'name'>,
  existing: Location[],
): LocationProblem | null => {
  const name = (draft.name || '').trim();
  if (!name) return 'no-name';
  if (draft.id === COMPANY_LOCATION_ID || name.toLowerCase() === 'company') return 'reserved-id';
  const clash = (existing || []).some(
    l => l.id !== draft.id && l.name.trim().toLowerCase() === name.toLowerCase(),
  );
  return clash ? 'duplicate-name' : null;
};

export const renameLocation = (l: Location, name: string, now: number): Location =>
  ({ ...l, name: name.trim(), updatedAt: now });

/**
 * DEACTIVATE, NEVER DELETE.
 *
 * A deleted location orphans every device, sale, repair and shift pointing at
 * it, with no way left to say where any of it happened. Deactivating hides it
 * from pickers and leaves all of that intact and readable.
 *
 * THE DEFAULT CANNOT BE CLOSED while it is the default: the backfill and every
 * later stage resolve "where does this belong by default" through it, and a
 * workspace with no default has nowhere to put a new record. Make another
 * store the default first.
 */
export const canDeactivate = (l: Location, locations: Location[]): boolean => {
  if (!l.active) return false;
  if (!l.isDefault) return true;
  // Another active store must be available to take over as default.
  return activeLocations(locations).some(x => x.id !== l.id);
};

export const deactivateLocation = (l: Location, now: number): Location =>
  ({ ...l, active: false, isDefault: false, updatedAt: now });

export const reactivateLocation = (l: Location, now: number): Location =>
  ({ ...l, active: true, updatedAt: now });

/**
 * Move the default flag, which exactly one location carries.
 *
 * Returns every location that CHANGED, so the caller writes two documents
 * rather than rewriting the whole list — and so a half-applied move leaves at
 * most one default rather than none.
 */
export const setDefaultLocation = (
  locations: Location[],
  id: string,
  now: number,
): Location[] => {
  const target = (locations || []).find(l => l.id === id);
  if (!target || !target.active) return [];
  const changed: Location[] = [];
  for (const l of locations) {
    const shouldBeDefault = l.id === id;
    if (!!l.isDefault === shouldBeDefault) continue;
    changed.push({ ...l, isDefault: shouldBeDefault, updatedAt: now });
  }
  return changed;
};

/**
 * Locations are never hard-deleted — asserted as a function so the rule is
 * testable and so there is one place that says so, rather than the absence of
 * a delete button being the only thing enforcing it.
 */
export const canDeleteLocation = (): false => false;

/* ---------------- Which collections carry a location ---------------- */

/**
 * The records where a location is MEANINGFUL, and the deliberate omissions.
 *
 * Named here rather than inferred, because the omissions are decisions:
 *
 *   customers     — a customer belongs to the BUSINESS, not to a store. The
 *                   same person buys in Brampton and gets a repair in
 *                   Mississauga; stamping them with one store would be wrong
 *                   the first time they walked into the other.
 *   pcBuilds      — NOT TAGGED, deliberately. A build does happen somewhere,
 *                   but the owner has not raised it and guessing wrong costs a
 *                   migration. It also mostly answers itself: finishing a
 *                   build creates an inventory DEVICE, which does carry a
 *                   location, so the question "where is this machine" is
 *                   already answerable at the point it starts to matter.
 *                   Revisit when the owner says builds happen at both.
 *   payPeriods,
 *   staffBonuses  — pay is per PERSON across both stores. A shift carries the
 *                   location (from its kiosk); the pay period that aggregates
 *                   shifts spans them by design.
 *   users         — staff work both stores; that is the premise.
 *   activityLog,
 *   auditLogs     — a feed and a trail of what PEOPLE did, workspace-wide.
 *   settings      — one set of books, one configuration.
 */
export const LOCATION_TAGGED_COLLECTIONS = [
  'inventory', 'accessories', 'salesTransactions', 'repairs',
  'dropOffs', 'settlements', 'timeEntries', 'expenses', 'cashReconciliations',
] as const;

export type LocationTaggedCollection = typeof LOCATION_TAGGED_COLLECTIONS[number];

/**
 * The collections the backfill assigns Brampton to BY DEFAULT.
 *
 * `expenses` is deliberately NOT here. Every other record predating the second
 * store genuinely happened at Brampton, but an expense did not necessarily
 * BELONG to it: the owner's decision is that parts orders, the app's own costs
 * and the owner's pay are COMPANY costs, and nothing in a stored expense says
 * which is which. Defaulting them all to Brampton would make Brampton bear
 * company costs in stage 5's per-store P&L — a wrong number presented as a
 * fact, which is worse than an untagged row that shows in the combined P&L
 * only, exactly as it does today.
 *
 * It stays available to run explicitly, so the owner can tag historical
 * expenses once stage 5 lets them see what it changes.
 */
export const DEFAULT_BACKFILL_COLLECTIONS: LocationTaggedCollection[] =
  LOCATION_TAGGED_COLLECTIONS.filter(c => c !== 'expenses');

/** Does this collection carry a location at all? */
export const isLocationTagged = (name: string): name is LocationTaggedCollection =>
  (LOCATION_TAGGED_COLLECTIONS as readonly string[]).includes(name);
