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

// --- Failure classification --------------------------------------------------
// `internal` is what a callable returns for ANY unhandled exception, so a bare
// `internal` told the person hitting it nothing and left the real cause only in
// the Functions logs, which they can't read. Every failure mode we can name is
// classified here into a specific code + message, so `internal` is left to mean
// only what it should: a genuine unexpected crash.

export type CreateUserErrorCode =
  | "already-exists"
  | "invalid-argument"
  | "permission-denied"
  | "unavailable"
  | "resource-exhausted"
  | "failed-precondition"
  | "internal";

export interface ClassifiedError {
  code: CreateUserErrorCode;
  message: string;
  /** True only for a genuine crash — the one case worth paging on. */
  unexpected: boolean;
}

// Firebase Admin Auth error codes, mapped to what the operator can actually do
// about each. Anything not listed falls through to `internal`.
const AUTH_ERROR_MAP: Record<string, { code: CreateUserErrorCode; message: string }> = {
  "auth/email-already-exists": {
    code: "already-exists",
    message: "An account with that email already exists. Use a different email, or reset that account's password instead.",
  },
  "auth/invalid-email": {
    code: "invalid-argument",
    message: "That doesn't look like a valid email address.",
  },
  "auth/invalid-password": {
    code: "invalid-argument",
    message: `The password doesn't meet Firebase's requirements (at least ${MIN_PASSWORD_LENGTH} characters).`,
  },
  "auth/weak-password": {
    code: "invalid-argument",
    message: `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  },
  "auth/uid-already-exists": {
    code: "already-exists",
    message: "An account with that id already exists.",
  },
  "auth/insufficient-permission": {
    code: "failed-precondition",
    message: "The server isn't permitted to create accounts. An administrator needs to check the service account's permissions.",
  },
  "auth/internal-error": {
    code: "unavailable",
    message: "The account service is temporarily unavailable. Please try again in a moment.",
  },
  "auth/too-many-requests": {
    code: "resource-exhausted",
    message: "Too many attempts against the account service. Please wait a minute and try again.",
  },
  "auth/operation-not-allowed": {
    code: "failed-precondition",
    message: "Email/password sign-in is disabled for this project. Enable it in the Firebase console, then try again.",
  },
};

/**
 * Classify a thrown Admin-SDK error into a specific callable error. Pure and
 * dependency-free so every branch is unit-testable without the Functions
 * runtime — the same split the rest of this file uses.
 */
export function classifyCreateUserError(err: unknown): ClassifiedError {
  const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
  const mapped = AUTH_ERROR_MAP[code];
  if (mapped) return { ...mapped, unexpected: false };

  // Network/transport failures reaching Google's APIs — retryable, and very
  // much not a bug in this function.
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      code: "unavailable",
      message: "Couldn't reach the account service. Check the connection and try again.",
      unexpected: false,
    };
  }
  return {
    code: "internal",
    message: "Something went wrong creating the account. The error has been logged — please report it if it keeps happening.",
    unexpected: true,
  };
}

/**
 * The safe-to-log shape of a failed create. Deliberately takes NO password and
 * has no field that could hold one — the structural reason a credential cannot
 * end up in a log line, rather than a rule someone has to remember. The email
 * is included because it's the only way to correlate a report ("I couldn't add
 * Sam") with a log entry, and it's already stored in plain text on the user doc
 * and in the audit log.
 */
export interface CreateUserFailureLog {
  event: "createStaffUser.failure";
  stage: "auth" | "firestore" | "audit";
  callerUid: string;
  targetEmail: string;
  targetRole: string;
  authCode: string;
  resultCode: CreateUserErrorCode;
  unexpected: boolean;
}

export function buildFailureLog(params: {
  stage: "auth" | "firestore" | "audit";
  callerUid: string;
  targetEmail: string;
  targetRole: unknown;
  err: unknown;
  classified: ClassifiedError;
}): CreateUserFailureLog {
  const authCode = typeof (params.err as { code?: unknown })?.code === "string"
    ? (params.err as { code: string }).code
    : "";
  return {
    event: "createStaffUser.failure",
    stage: params.stage,
    callerUid: params.callerUid,
    targetEmail: params.targetEmail,
    targetRole: typeof params.targetRole === "string" ? params.targetRole : "",
    authCode,
    resultCode: params.classified.code,
    unexpected: params.classified.unexpected,
  };
}

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
