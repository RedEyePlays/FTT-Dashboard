// Pure, dependency-free logic for techUpdateRepair (see repairs.ts) — kept
// separate from the onCall wrapper so it's unit-testable without the Cloud
// Functions runtime or Admin SDK, same pattern as permissions.ts/
// permissions.test.ts. Mirrors domain/repairs.ts's TECH_EDITABLE_FIELDS /
// TECH_STATUSES / computeWarrantyUntil — an independent copy since functions/
// can't import the client's src tree. If those change client-side, update
// the copies here too.

export const TECH_EDITABLE_FIELDS = [
  "status", "techNotes", "diagnostics", "workPerformed",
  "partsUsed", "testingResults", "testChecks",
] as const;

export const TECH_STATUSES: readonly string[] = [
  "received", "diagnosing", "waiting_approval", "waiting_parts",
  "in_repair", "testing", "ready_pickup", "picked_up", "cancelled",
];

const TERMINAL_TECH_STATUSES = new Set(["completed", "picked_up"]);

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function computeWarrantyUntil(completedDate: string, warrantyDays?: number): string {
  return warrantyDays && warrantyDays > 0 && completedDate ? addDays(completedDate, warrantyDays) : "";
}

export interface StoredRepair {
  status?: unknown;
  completedAt?: unknown;
  warrantyDays?: unknown;
  [key: string]: unknown;
}

/**
 * Build the Firestore update a technician's edit is allowed to write.
 *
 * Two independent guards, both enforced HERE regardless of what the caller
 * (a compromised/hand-crafted client) puts in `draft`:
 *   1. Only TECH_EDITABLE_FIELDS ever gets copied from `draft` — a draft that
 *      also smuggles in `completedAt`, `warrantyUntil`, `completedBy`, price,
 *      customer, or device fields has all of those silently dropped.
 *   2. completedAt/warrantyUntil/completedBy are NEVER taken from `draft` —
 *      they're computed here from `now` (the caller's own clock) and the
 *      ticket's real `warrantyDays`, and only once (never overwritten once
 *      `stored.completedAt` is already set).
 */
export function buildTechRepairUpdate(
  stored: StoredRepair,
  draft: Record<string, unknown>,
  uid: string,
  now: number,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const key of TECH_EDITABLE_FIELDS) {
    if (key === "status") {
      if (typeof draft.status === "string" && TECH_STATUSES.includes(draft.status)) {
        update.status = draft.status;
      }
      continue;
    }
    if (key in draft) update[key] = draft[key];
  }

  const nextStatus = (update.status as string | undefined) ?? (stored.status as string | undefined);
  if (nextStatus && TERMINAL_TECH_STATUSES.has(nextStatus) && !stored.completedAt) {
    const completedDate = new Date(now).toISOString().split("T")[0];
    update.completedAt = now;
    update.completedBy = uid;
    update.warrantyUntil = computeWarrantyUntil(completedDate, stored.warrantyDays as number | undefined);
  }

  return update;
}
