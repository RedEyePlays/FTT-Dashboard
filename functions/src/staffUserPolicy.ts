// Pure, dependency-free policy for the createStaffUser callable (see
// staffUser.ts) — same split as staffPasswordPolicy.ts / permissions.ts /
// repairUpdate.ts, so every authorization branch is unit-testable without the
// Cloud Functions runtime, the Admin SDK, or a live Firebase project.

import { validatePassword, MIN_PASSWORD_LENGTH, UserRecord } from "./staffPasswordPolicy";

export { validatePassword, MIN_PASSWORD_LENGTH, UserRecord };

export type Role = "owner" | "manager" | "employee" | "technician";

export type AuthzFailureCode = "permission-denied" | "not-found" | "invalid-argument";

export interface AuthzFailure {
  ok: false;
  code: AuthzFailureCode;
  message: string;
}
export interface AuthzSuccess {
  ok: true;
}
export type AuthzResult = AuthzSuccess | AuthzFailure;

export interface AuthzInput {
  callerUid: string;
  /** users/{callerUid} as read server-side by the Admin SDK — never client-supplied. */
  caller: UserRecord | undefined;
  targetRole: unknown;
}

/**
 * The whole authorization decision for "may this caller create a new staff
 * account with this role", in one pure function. Mirrors the invite-role
 * restriction the UI already enforces (UsersView.tsx's `inviteRoles`), now
 * also enforced server-side since this path bypasses Firestore rules
 * entirely (the Admin SDK writes the new users/{uid} doc directly):
 *
 *   • owner   → may create manager, employee, or technician (never another owner)
 *   • manager → may create technician ONLY
 *   • employee/technician/no record → denied
 */
export function authorizeStaffUserCreate(input: AuthzInput): AuthzResult {
  const { callerUid, caller, targetRole } = input;

  if (!callerUid) {
    return { ok: false, code: "invalid-argument", message: "Missing caller." };
  }
  if (!caller || caller.disabled === true || typeof caller.workspaceId !== "string" || !caller.workspaceId) {
    return { ok: false, code: "permission-denied", message: "You don't have permission to create a user." };
  }
  if (targetRole !== "owner" && targetRole !== "manager" && targetRole !== "employee" && targetRole !== "technician") {
    return { ok: false, code: "invalid-argument", message: "Invalid role." };
  }
  if (caller.role === "owner") {
    if (targetRole === "owner") {
      return { ok: false, code: "permission-denied", message: "A second owner can't be created here." };
    }
    return { ok: true };
  }
  if (caller.role === "manager") {
    if (targetRole === "technician") return { ok: true };
    return { ok: false, code: "permission-denied", message: "Managers may only create technician accounts." };
  }
  return { ok: false, code: "permission-denied", message: "You don't have permission to create a user." };
}

/** Basic shape check — Firebase Auth itself is the real validator on create. */
export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string") return "An email is required.";
  const trimmed = email.trim();
  if (!trimmed) return "An email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "That doesn't look like a valid email address.";
  if (trimmed.length > 320) return "Email is too long.";
  return null;
}

/**
 * An optional PIN is set as a client-hashed {hash, salt, iterations} triple
 * (see domain/pin.ts's hashPin — the plaintext PIN never leaves the device,
 * same as an existing user's PIN is set today via handleSetPin). This only
 * sanity-checks the triple is internally consistent — all present or all
 * absent, iterations a sane positive number — never re-derives or validates
 * the plaintext PIN itself, which this function never sees.
 */
export function validatePinTriple(input: { pinHash?: unknown; pinSalt?: unknown; pinIterations?: unknown }): string | null {
  const { pinHash, pinSalt, pinIterations } = input;
  const anyPresent = pinHash != null || pinSalt != null || pinIterations != null;
  if (!anyPresent) return null;
  if (typeof pinHash !== "string" || !pinHash) return "PIN data is incomplete.";
  if (typeof pinSalt !== "string" || !pinSalt) return "PIN data is incomplete.";
  if (typeof pinIterations !== "number" || !Number.isFinite(pinIterations) || pinIterations <= 0) {
    return "PIN data is incomplete.";
  }
  return null;
}

// --- Rate limiting -----------------------------------------------------------
// Same sliding-window shape as staffPasswordPolicy.ts's recordAttempt,
// re-exported so staffUser.ts doesn't need a second import for the same
// mechanism, just its own ATTEMPTS map keyed by caller uid.
export { recordAttempt, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_PER_WINDOW } from "./staffPasswordPolicy";

/**
 * The audit payload written for a successful create. Takes no password or PIN
 * material at all — the structural reason it cannot leak either.
 */
export interface CreateAuditEntry {
  id: string;
  ts: number;
  userId: string;
  userEmail: string;
  action: "user.create";
  entityType: "user";
  entityId: string;
  after: { email: string; role: Role };
}

export function buildCreateAuditEntry(params: {
  id: string;
  now: number;
  callerUid: string;
  callerEmail: string;
  targetUid: string;
  targetEmail: string;
  targetRole: Role;
}): CreateAuditEntry {
  return {
    id: params.id,
    ts: params.now,
    userId: params.callerUid,
    userEmail: params.callerEmail,
    action: "user.create",
    entityType: "user",
    entityId: params.targetUid,
    after: { email: params.targetEmail, role: params.targetRole },
  };
}
