import { Customer, InventoryItem, DropOff } from '../types';
import { findCustomerByContact, CustomerDraft } from './customers';

/**
 * A SELLER TYPED AT THE COUNTER SHOULD BECOME A CUSTOMER.
 *
 * THE BUG: typing a name into "Bought From" only set `boughtFrom` as free text
 * on the device and CLEARED `boughtFromCustomerId`. A customer record was
 * created only if somebody clicked the small "Add as a new customer" link and
 * then "Create & link" — two extra clicks, at a counter, with a person waiting.
 * Nobody does. So sellers never reached the customer database and their purchase
 * history was simply lost: the shop could not answer "what else have we bought
 * from this person" about anybody it had ever bought from.
 *
 * The saving machinery was already right — App.tsx's handleCreateCustomerInline
 * → resolveCustomerForDraft (duplicate detection) → saveItem + audit. It just
 * was not being called. So this module adds NO second customer-creation
 * routine; it only decides, on save, which of the three things should happen,
 * and the caller then walks the existing path.
 *
 * WHEN IT IS AMBIGUOUS, IT ASKS. `findCustomerByContact` matches on phone and
 * email, which is the right rule and is left alone. But a bare name with no
 * phone matches nothing, so resolving it silently would create a second "Ali"
 * every time somebody called Ali sold the shop a phone. A name that already
 * exists, with nothing to tell the two apart, is a question for the person at
 * the counter — asked once, with "create new" a plain option.
 *
 * Pure: no DOM, no Firestore.
 */

const norm = (s: string | undefined): string => (s || '').trim().toLowerCase();

/** Everyone whose name (or company) is the one that was typed. */
export const customersNamed = (customers: Customer[], name: string): Customer[] => {
  const n = norm(name);
  if (!n) return [];
  return customers.filter(c => norm(c.name) === n || norm(c.company) === n);
};

export type SellerLinkDecision =
  /** A contact match: link to this record, enriching it. No question needed. */
  | { action: 'link'; customer: Customer; draft: CustomerDraft; matchedOn: 'phone' | 'email' }
  /** Nobody by that name or contact — create a new customer. */
  | { action: 'create'; draft: CustomerDraft }
  /** The name exists but nothing distinguishes them. Ask, once. */
  | { action: 'ask'; draft: CustomerDraft; candidates: Customer[] }
  /** Nothing typed, or already linked — do nothing at all. */
  | { action: 'none' };

/**
 * What should happen to this seller when the purchase is saved?
 *
 * PHONE FIRST, THEN NAME — the order the spec asks for and the order that is
 * actually safe. A phone (or email) identifies a person; a name does not.
 *
 * Already linked is `none`: the user picked somebody explicitly, and second-
 * guessing that is how a deliberate choice gets silently overridden.
 */
export const sellerLinkDecision = (
  customers: Customer[],
  seller: { name: string; phone?: string; customerId?: string; email?: string },
): SellerLinkDecision => {
  if (seller.customerId) return { action: 'none' };
  const name = (seller.name || '').trim();
  if (!name) return { action: 'none' };

  const draft: CustomerDraft = {
    name,
    phone: (seller.phone || '').trim(),
    email: (seller.email || '').trim(),
  };

  // The existing rule, reused: phone/email is what identifies a person.
  const byContact = findCustomerByContact(customers, { phone: draft.phone, email: draft.email });
  if (byContact) return { action: 'link', customer: byContact.customer, draft, matchedOn: byContact.matchedOn };

  const sameName = customersNamed(customers, name);
  if (sameName.length === 0) return { action: 'create', draft };
  return { action: 'ask', draft, candidates: sameName };
};

/** "Link to existing Ali (416 555-0100), or create new?" */
export const candidateLabel = (c: Customer): string => {
  const who = c.name || c.company || 'Customer';
  const contact = c.phone || c.email;
  return contact ? `${who} (${contact})` : who;
};

export const askPrompt = (name: string, candidates: Customer[]): string =>
  candidates.length === 1
    ? `There is already a customer called ${candidateLabel(candidates[0])}. Link this purchase to them, or create a new customer called ${name}?`
    : `There are already ${candidates.length} customers called ${name}. Pick one to link to, or create a new customer.`;

/* ---------------- Backfill ---------------- */

export interface SellerBackfillGroup {
  /** The name as it was typed, in its most common spelling. */
  name: string;
  /** A phone seen on any of these purchases, when one was recorded. */
  phone?: string;
  /** How many purchases carry this name with no customer link. */
  count: number;
  /** The inventory rows, so the owner can see what they are linking. */
  items: InventoryItem[];
  /** Customers who already have this name — linking beats creating. */
  existing: Customer[];
}

/**
 * Devices bought from a named seller that were never linked to a customer,
 * grouped by name — the backfill list.
 *
 * OWNER-ONLY, PREVIEW FIRST, NEVER AUTOMATIC. The list is shown and the owner
 * chooses; linking hundreds of historical purchases to guessed customers on the
 * strength of a name match is not a thing to do unasked, and a name is exactly
 * the weak signal this module refuses to resolve silently anywhere else.
 *
 * Grouped case-insensitively, but the NAME shown is the spelling that appears
 * most often, so the created customer reads the way the shop writes it.
 */
export const sellerBackfillGroups = (
  inventory: InventoryItem[],
  customers: Customer[],
): SellerBackfillGroup[] => {
  const groups = new Map<string, { spellings: Map<string, number>; phone?: string; items: InventoryItem[] }>();
  for (const i of inventory) {
    const name = (i.boughtFrom || '').trim();
    if (!name || i.boughtFromCustomerId) continue;
    const key = name.toLowerCase();
    const g = groups.get(key) || { spellings: new Map<string, number>(), items: [] };
    g.spellings.set(name, (g.spellings.get(name) || 0) + 1);
    g.phone = g.phone || (i.boughtFromPhone || '').trim() || undefined;
    g.items.push(i);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([, g]) => {
      const name = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return {
        name,
        phone: g.phone,
        count: g.items.length,
        items: g.items,
        existing: customersNamed(customers, name),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export const backfillLabel = (groups: SellerBackfillGroup[]): string | null => {
  if (groups.length === 0) return null;
  const purchases = groups.reduce((n, g) => n + g.count, 0);
  return `${purchases} purchase${purchases === 1 ? '' : 's'} from ${groups.length} seller${groups.length === 1 ? '' : 's'} not linked to a customer`;
};

export const BACKFILL_EXPLANATION =
  'These devices record a seller by name only, from before a typed name became a customer automatically. Linking creates or matches a customer using the same rules the counter uses — nothing is linked until you choose it.';

/* ---------------- Drop-off intake ---------------- */

/**
 * The same decision for a DROP-OFF, whose seller lives on `sellerName` /
 * `sellerContact` rather than boughtFrom/boughtFromPhone.
 *
 * Different field names, identical question — so it routes through the same
 * decision rather than growing a parallel one.
 */
export const dropOffSellerDecision = (
  customers: Customer[],
  d: Pick<DropOff, 'sellerName' | 'sellerContact'>,
): SellerLinkDecision =>
  sellerLinkDecision(customers, {
    name: d.sellerName || '',
    // `sellerContact` is one free-text box that people put either a phone or an
    // email in. It is treated as a phone when it has digits in it and as an
    // email when it has an @ — guessing wrong here only means no contact match,
    // which falls through to the ask, so the failure mode is a question rather
    // than a wrong link.
    phone: (d.sellerContact || '').includes('@') ? '' : (d.sellerContact || ''),
    email: (d.sellerContact || '').includes('@') ? (d.sellerContact || '') : '',
  });
