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
