// Every decision switchUser makes, kept pure so each branch can be exercised
// without a live Firebase project — the same split staffPasswordPolicy.ts uses.
//
// WHY THIS FUNCTION EXISTS AT ALL: firestore.rules lets a user read
// users/{uid} only for themselves, or for an owner/manager in the same
// workspace. So a register signed in as a TECHNICIAN cannot read the pinHash
// of the person trying to take over, and client-side PIN verification is
// impossible for the general case. Rather than special-casing the one role
// pair that could do it in the browser, the check lives here and every switch
// takes the same path.

export type Role = "owner" | "manager" | "employee" | "technician" | "kiosk";

export interface UserRecord {
  role?: Role;
  workspaceId?: string;
  email?: string;
  disabled?: boolean;
  pinHash?: string;
  pinSalt?: string;
  pinIterations?: number;
}

export type DenyCode =
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "resource-exhausted"
  | "invalid-argument";

export interface Authorized { ok: true }
export interface Denied { ok: false; code: DenyCode; message: string }
export type Authorization = Authorized | Denied;

/**
 * One message for every "you may not switch to that account" case.
 *
 * Deliberately identical whether the target does not exist, sits in another
 * workspace, is disabled, or is the kiosk device: anything more specific turns
 * this callable into a way to enumerate a workspace's accounts from a
 * technician's session. It also never says whether a PIN is set — see
 * NO_PIN_MESSAGE, which is only ever returned AFTER authorization has passed.
 */
export const GENERIC_DENY = "That account can't be used on this register.";

/** Shown only to a caller who has already proved they may switch to the target. */
export const NO_PIN_MESSAGE =
  "No PIN is set for that account. Sign in with an email and password instead.";

export const WRONG_PIN_MESSAGE = "That PIN didn't match.";

export interface AuthorizeInput {
  callerUid: string;
  targetUid: string;
  caller?: UserRecord;
  target?: UserRecord;
}

/**
 * May this caller take over the register as this target?
 *
 * The rule is deliberately flat: any active member of the workspace may switch
 * to any other active member of the same workspace, given the PIN. It is NOT a
 * privilege escalation — the PIN is the target's own credential, and knowing
 * it is what proves the target is standing there. A rank check would only stop
 * a manager handing the counter back to an employee.
 *
 * What it does stop: cross-workspace switching, disabled accounts, the kiosk
 * DEVICE account (which is not a person and has no session to take over), and
 * switching to yourself (a no-op that would still write an audit entry
 * claiming a handover happened).
 */
export const authorizeSwitch = (i: AuthorizeInput): Authorization => {
  if (!i.callerUid) return { ok: false, code: "unauthenticated", message: "You must be signed in." };
  if (!i.targetUid) return { ok: false, code: "invalid-argument", message: "No account was chosen." };
  if (!i.caller || i.caller.disabled === true || !i.caller.workspaceId) {
    return { ok: false, code: "permission-denied", message: GENERIC_DENY };
  }
  // A kiosk device may not initiate a switch either: it holds no permissions
  // and has no counter session to hand over.
  if (i.caller.role === "kiosk") {
    return { ok: false, code: "permission-denied", message: GENERIC_DENY };
  }
  if (i.callerUid === i.targetUid) {
    return { ok: false, code: "failed-precondition", message: "You are already signed in on this register." };
  }
  if (!i.target || i.target.disabled === true) {
    return { ok: false, code: "permission-denied", message: GENERIC_DENY };
  }
  if (i.target.role === "kiosk") {
    return { ok: false, code: "permission-denied", message: GENERIC_DENY };
  }
  if (i.target.workspaceId !== i.caller.workspaceId) {
    return { ok: false, code: "permission-denied", message: GENERIC_DENY };
  }
  return { ok: true };
};

/** Does the target actually have a PIN to check? */
export const hasPin = (u?: UserRecord): boolean => !!(u?.pinHash && u?.pinSalt);

/* ---------------- Rate limiting ---------------- */
//
// Keyed by TARGET uid, not by caller: the thing being guessed is one person's
// PIN, and a 4-digit code is small enough that an attacker cycling caller
// sessions must not get a fresh budget each time. Counted in Firestore rather
// than in function memory so it survives a cold start, spans instances, and —
// the point of the requirement — cannot be reset by reloading the page.

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_COOLDOWN_MS = 5 * 60_000;
/** Failures older than this stop counting toward the cap. */
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

export interface AttemptState {
  /** Epoch ms of each recent FAILED attempt. */
  failures: number[];
  cooldownUntil?: number;
}

export const EMPTY_ATTEMPTS: AttemptState = { failures: [] };

export const isCoolingDown = (s: AttemptState, now: number): boolean =>
  !!s.cooldownUntil && now < s.cooldownUntil;

export const cooldownMessage = (s: AttemptState, now: number): string => {
  const secs = Math.max(1, Math.ceil(((s.cooldownUntil || now) - now) / 1000));
  const mins = Math.ceil(secs / 60);
  return `Too many incorrect PIN attempts for that account. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or sign in with a password.`;
};

/** Record a failure and decide whether the target is now locked out. */
export const recordFailure = (s: AttemptState, now: number): AttemptState => {
  const failures = [...(s.failures || []), now].filter(t => now - t < ATTEMPT_WINDOW_MS);
  return failures.length >= MAX_PIN_ATTEMPTS
    ? { failures: [], cooldownUntil: now + PIN_COOLDOWN_MS }
    : { failures };
};

/**
 * A SUCCESSFUL switch clears the counter.
 *
 * It does not clear an active cooldown, though: somebody who has just burned
 * five guesses on a colleague's PIN should not get the budget back by
 * switching to their own account in between.
 */
export const recordSuccess = (s: AttemptState): AttemptState =>
  isCoolingDown(s, Date.now()) ? s : EMPTY_ATTEMPTS;

/* ---------------- Audit ---------------- */

export interface SwitchAuditInput {
  id: string;
  now: number;
  fromUid: string;
  fromEmail: string;
  toUid: string;
  toEmail: string;
  /** A device-local id for the register, so a pattern can be traced to a machine. */
  deviceId?: string;
  outcome: "switched" | "wrong_pin" | "denied" | "rate_limited";
  reason?: string;
}

/**
 * Every switch is audited, and so is every FAILED attempt — repeated failures
 * against one person's PIN is exactly the pattern worth being able to see.
 *
 * Never carries the PIN, the hash or the salt.
 */
export const buildSwitchAuditEntry = (i: SwitchAuditInput) => ({
  id: i.id,
  at: i.now,
  userId: i.fromUid,
  userEmail: i.fromEmail,
  action: i.outcome === "switched" ? "auth.switch_user" : "auth.switch_user_failed",
  entityType: "user",
  entityId: i.toUid,
  after: {
    fromUid: i.fromUid,
    fromEmail: i.fromEmail,
    toUid: i.toUid,
    toEmail: i.toEmail,
    outcome: i.outcome,
    ...(i.deviceId ? { deviceId: i.deviceId } : {}),
    ...(i.reason ? { reason: i.reason } : {}),
  },
});
