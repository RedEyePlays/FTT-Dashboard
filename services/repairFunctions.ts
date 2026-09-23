import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { Repair } from '../types';
import { TechEditableField } from '../domain/repairs';
import { assertOnline } from './functionsGuard';

// A technician's repair-ticket edits go through this callable instead of a
// direct Firestore write. firestore.rules no longer lets a technician set
// completedAt/warrantyUntil directly (they used to be writable client-side,
// letting a technician backdate completion or set an arbitrary warranty end
// date via dev tools) — this callable (functions/src/repairs.ts) re-derives
// both server-side from the ticket's warrantyDays and its own clock, and
// re-applies the same TECH_EDITABLE_FIELDS whitelist as applyTechEdit
// (domain/repairs.ts) before writing.
const call = httpsCallable(functions, 'techUpdateRepair');

export const techUpdateRepair = async (
  repairId: string,
  draft: Partial<Pick<Repair, TechEditableField>>,
): Promise<void> => {
  // `async` here (not a plain arrow returning a Promise chain) matters: it's
  // what turns assertOnline()'s synchronous throw into a rejected Promise
  // instead of an uncaught exception at the call site — callers uniformly
  // `.catch()` this rather than needing a try/catch around the call itself.
  assertOnline();
  await call({ repairId, draft });
};

/**
 * Ask the server to find a stock photo for a device's brand/model.
 *
 * The browser never touches Wikimedia Commons: the licence check has to happen
 * somewhere a client cannot skip it (functions/src/commonsPolicy.ts). The
 * device document is updated server-side, so the photo arrives on the next
 * subscription tick rather than being returned here.
 *
 * Resolves false on anything that goes wrong. A missing stock photo is a
 * normal outcome, not an error worth interrupting somebody for.
 */
export async function findDevicePhoto(
  itemId: string, brand: string, model: string,
): Promise<boolean> {
  try {
    const call = httpsCallable<{ itemId: string; brand: string; model: string }, { found: boolean }>(
      functions, 'findDevicePhoto',
    );
    const res = await call({ itemId, brand, model });
    return !!res.data?.found;
  } catch {
    return false;
  }
}
