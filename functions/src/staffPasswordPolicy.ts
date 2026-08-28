// Pure, dependency-free policy for the setStaffPassword callable (see
// staffPassword.ts) — kept separate from the onCall wrapper so every
// authorization branch is unit-testable without the Cloud Functions runtime,
// the Admin SDK, or a live Firebase project. Same pattern as permissions.ts /
// repairUpdate.ts.
//
// NOTHING in this file ever receives, stores, logs or returns password
// material. `validatePassword` is handed the candidate only to measure it and
// returns a reason string, never the value.

export type Role = "owner" | "manager" | "employee" | "technician";

/** The user-registry shape this policy reads (users/{uid} in Firestore). */
export interface UserRecord {
  role?: unknown;
  workspaceId?: unknown;
  disabled?: unknown;
  email?: unknown;
}

/**
 * Minimum-strength floor, mirrored by the client (domain/password.ts) so the
 * UI can disable the button before a round trip — but this copy is the one
 * that actually decides, because the client's is only UX.
 *
 * 10 chars is above Firebase Auth's own 6-char floor: this password is set BY
 * someone else and handed over out-of-band, so it can't rely on the target
 * having picked something memorable-but-strong.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Returns a human-readable reason the candidate is unacceptable, or null when
 * it passes. Never echoes the candidate itself.
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string") return "A new password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 4096) return "Password is too long.";
  if (password.trim().length !== password.length) {
    return "Password cannot start or end with a space.";
  }
  // Two of three character classes — enough to stop "aaaaaaaaaa" without
  // demanding a symbol nobody can read out over the phone.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    return "Password must mix at least two of: lowercase, uppercase, numbers, symbols.";
  }
  return null;
}

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
  targetUid: string;
  /** users/{callerUid} as read server-side by the Admin SDK — never client-supplied. */
  caller: UserRecord | undefined;
  /** users/{targetUid} as read server-side by the Admin SDK — never client-supplied. */
  target: UserRecord | undefined;
}

/**
 * The whole authorization decision for "may this caller set this target's
 * password", in one pure function.
 *
 * Every input comes from a SERVER-SIDE Firestore read of the users registry.
 * The client sends only two opaque ids (its own auth uid, implicitly, and the
 * target uid); it never sends a role, a workspace, or a claim of any kind, and
 * nothing here reads one.
 *
 * Rules, in order:
 *   1. Caller must be an active (non-disabled) member with a workspace.
 *   2. Caller must be an `owner`. Manager/employee/technician → denied.
 *   3. Target must exist.
 *   4. Target must be in the caller's workspace → cross-workspace denied.
 *   5. Target must NOT be an owner — an owner may not reset another owner's
 *      password, and (because self is an owner too) may not reset their own
 *      through this path. An owner changes their own password through the
 *      normal Firebase self-service reauthenticate flow.
 *
 * The denial messages are deliberately uniform-ish and never confirm whether a
 * given uid exists in some OTHER workspace.
 */
export function authorizeStaffPasswordReset(input: AuthzInput): AuthzResult {
  const { callerUid, targetUid, caller, target } = input;

  if (!callerUid || !targetUid) {
    return { ok: false, code: "invalid-argument", message: "Missing target user." };
  }

  if (!caller || caller.disabled === true || typeof caller.workspaceId !== "string" || !caller.workspaceId) {
    return { ok: false, code: "permission-denied", message: "Only the shop owner may reset a staff password." };
  }
  if (caller.role !== "owner") {
    return { ok: false, code: "permission-denied", message: "Only the shop owner may reset a staff password." };
  }

  if (!target) {
    return { ok: false, code: "not-found", message: "That user is not part of this shop." };
  }
  if (target.workspaceId !== caller.workspaceId) {
    // Cross-workspace: same message as "no such user" so an owner can't probe
    // another shop's uids.
    return { ok: false, code: "not-found", message: "That user is not part of this shop." };
  }
  if (target.role === "owner") {
    return {
      ok: false,
      code: "permission-denied",
      message: "An owner's password can't be reset here — the owner resets their own from account settings.",
    };
  }

  return { ok: true };
}

// --- Rate limiting -----------------------------------------------------------
//
// Same best-effort, in-memory, per-instance sliding window repairStatusLookup
// already uses (functions/src/repairLookup.ts) — this codebase's existing
// convention for throttling a callable, kept identical rather than
// introducing a second mechanism. Factored out here so the window arithmetic
// itself is testable with an injected clock.
//
// A password reset is a rare, deliberate owner action; 5 per 10 minutes per
// owner is far above real use and far below anything useful for scripted
// abuse.

export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
export const RATE_LIMIT_MAX_PER_WINDOW = 5;

/**
 * Records an attempt at `now` against `history` and reports whether the caller
 * has exceeded the window. Returns the pruned history to store back, so the
 * caller keeps only timestamps still inside the window.
 */
export function recordAttempt(
  history: readonly number[],
  now: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  max: number = RATE_LIMIT_MAX_PER_WINDOW,
): { history: number[]; exceeded: boolean } {
  const recent = history.filter((t) => now - t < windowMs);
  recent.push(now);
  return { history: recent, exceeded: recent.length > max };
}

/**
 * The audit payload written for a successful reset. A standalone function so a
 * test can assert, on the exact object that gets persisted, that no password
 * material is present — the single most important property of this feature's
 * logging. It takes no password argument at all, which is the structural
 * reason it cannot leak one.
 */
export interface ResetAuditEntry {
  id: string;
  ts: number;
  userId: string;
  userEmail: string;
  action: "user.password_reset";
  entityType: "user";
  entityId: string;
  after: { targetEmail: string; sessionsRevoked: boolean };
}

export function buildResetAuditEntry(params: {
  id: string;
  now: number;
  callerUid: string;
  callerEmail: string;
  targetUid: string;
  targetEmail: string;
  sessionsRevoked: boolean;
}): ResetAuditEntry {
  return {
    id: params.id,
    ts: params.now,
    userId: params.callerUid,
    userEmail: params.callerEmail,
    action: "user.password_reset",
    entityType: "user",
    entityId: params.targetUid,
    after: { targetEmail: params.targetEmail, sessionsRevoked: params.sessionsRevoked },
  };
}
