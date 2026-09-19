// Pure, dependency-free policy for the kioskStaff mirror (see kioskStaff.ts)
// — same split as staffUserPolicy.ts / staffPasswordPolicy.ts / permissions.ts,
// so every branch is unit-testable without the Cloud Functions runtime, the
// Admin SDK, or a live Firebase project.

import { Role } from "./permissions";

/**
 * The shape the punch screen reads. Deliberately the BARE MINIMUM: a name to
 * draw on a tile and a PIN hash to check against.
 *
 * NO wage, NO role, NO email, no personal data of any kind. The iPad by the
 * front door is an unattended, shared, stealable device — anything it can read
 * is effectively public, so the answer is to make sure there is nothing worth
 * reading. This is why the kiosk does not simply read `users/{uid}`, which
 * carries hourlyRate, role, email and the app-unlock PIN hash.
 */
export interface KioskStaffDoc {
  id: string;
  uid: string;
  displayName: string;
  workspaceId: string;
  active: boolean;
  pinHash: string;
  pinSalt: string;
  pinIterations: number;
  updatedAt: number;
}

/** The subset of users/{uid} this mirror is derived from. */
export interface SourceUser {
  id?: unknown;
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
  workspaceId?: unknown;
  disabled?: unknown;
  kioskPinHash?: unknown;
  kioskPinSalt?: unknown;
  kioskPinIterations?: unknown;
}

/**
 * Who may appear on the punch screen: anyone who actually works shifts.
 *
 * The KIOSK device account itself is excluded explicitly — it is a device, not
 * a person, and a tile for "the iPad" would be nonsense. Stated here rather
 * than left to fall through the role list, so the exclusion is visible at the
 * one place that decides it.
 */
export function isPunchableRole(role: unknown): role is Role {
  return role === "owner" || role === "manager" || role === "employee" || role === "technician";
}

/**
 * The name shown on the tile.
 *
 * Prefers an explicitly-set `displayName`, so the owner controls exactly what
 * the door iPad shows. Falls back to the email's LOCAL PART only — never the
 * address itself, which would put a contactable identifier on an unattended
 * screen and in a collection a stolen device can read.
 */
export function kioskDisplayName(user: SourceUser): string {
  const explicit = typeof user.displayName === "string" ? user.displayName.trim() : "";
  if (explicit) return explicit;
  const email = typeof user.email === "string" ? user.email : "";
  const local = email.split("@")[0] || "";
  return local || "Staff";
}

/** All three PIN fields present and sane, or the mirror has nothing to check. */
function hasKioskPin(user: SourceUser): boolean {
  return typeof user.kioskPinHash === "string" && !!user.kioskPinHash
    && typeof user.kioskPinSalt === "string" && !!user.kioskPinSalt
    && typeof user.kioskPinIterations === "number" && user.kioskPinIterations > 0;
}

export type MirrorAction =
  | { kind: "delete" }
  | { kind: "write"; doc: KioskStaffDoc };

/**
 * What the mirror for one user should become — the WHOLE sync rule, pure.
 *
 * Deleted rather than written when the person cannot punch at all: no kiosk
 * PIN set, not a punchable role, or no workspace. Deleting (rather than
 * writing `active: false`) is deliberate for the no-PIN case: a device by the
 * door should not hold a hash it has no use for.
 *
 * A DISABLED account keeps its record with `active: false` instead, so the
 * tile disappears the moment they are deactivated while the record stays
 * available to re-enable — and, critically, so re-enabling does not silently
 * require the owner to re-type a PIN they already set.
 */
export function mirrorFor(uid: string, user: SourceUser | undefined, now: number): MirrorAction {
  if (!user) return { kind: "delete" };
  const workspaceId = typeof user.workspaceId === "string" ? user.workspaceId : "";
  if (!workspaceId) return { kind: "delete" };
  if (!isPunchableRole(user.role)) return { kind: "delete" };
  if (!hasKioskPin(user)) return { kind: "delete" };
  return {
    kind: "write",
    doc: {
      id: uid,
      uid,
      displayName: kioskDisplayName(user),
      workspaceId,
      active: user.disabled !== true,
      pinHash: user.kioskPinHash as string,
      pinSalt: user.kioskPinSalt as string,
      pinIterations: user.kioskPinIterations as number,
      updatedAt: now,
    },
  };
}

/**
 * Did anything the mirror depends on actually change? Used to skip the write
 * on the overwhelming majority of users/{uid} updates (a lastLogin stamp
 * fires this trigger on every single sign-in).
 */
export function mirrorInputsChanged(before: SourceUser | undefined, after: SourceUser | undefined): boolean {
  const keys: (keyof SourceUser)[] = [
    "email", "displayName", "role", "workspaceId", "disabled",
    "kioskPinHash", "kioskPinSalt", "kioskPinIterations",
  ];
  if (!before || !after) return true;
  return keys.some(k => before[k] !== after[k]);
}
