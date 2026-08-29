// Pure classification of Cloud Functions callable failures, so the UI can say
// WHICH thing went wrong rather than passing through a bare `internal`.
//
// Background: a Firebase callable returns the code `internal` for any
// unhandled server exception, so `internal` alone tells the person hitting it
// nothing — the real cause lives only in the Functions logs, which they can't
// read. The server side now classifies everything it can name
// (functions/src/staffUserPolicy.ts's classifyCreateUserError), leaving
// `internal` to mean a genuine crash; this is the matching client half, which
// also has to cover the failures that never reach the server at all (offline,
// unreachable) and are otherwise indistinguishable from a server rejection.

export interface CallableFailure {
  /** Shown to the user. Actionable — never a bare code. */
  message: string;
  /** True only for a genuine unexpected crash, worth reporting to monitoring. */
  unexpected: boolean;
  /** Stable tag for logs, so a spike in one cause is greppable. */
  kind: 'offline' | 'unreachable' | 'rejected' | 'crashed' | 'unauthenticated' | 'permission-denied';
}

const codeOf = (err: unknown): string => {
  const raw = (err as { code?: unknown })?.code;
  if (typeof raw !== 'string') return '';
  // The SDK prefixes callable codes with "functions/".
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
};

const messageOf = (err: unknown): string => {
  const m = (err as { message?: unknown })?.message;
  if (typeof m !== 'string' || !m) return '';
  // The SDK stringifies as "FirebaseError: <message>" / "internal: <message>" —
  // strip the leading code so the server's own sentence reads cleanly.
  return m.replace(/^[\w-]+(\s+\w+)*:\s*/, '').trim() || m;
};

/**
 * Classify a callable rejection. `fallback` is the message used when the
 * server didn't supply a usable one.
 *
 * The important distinction, and the reason this exists: OFFLINE (never left
 * the device) and UNREACHABLE (network failed in flight) are not the function
 * failing — they're recoverable and the user can act on them. A REJECTED call
 * is the server deliberately refusing with a reason worth showing verbatim. A
 * CRASHED call (`internal`) is the only one that means "a bug ran" and the
 * only one worth reporting to error monitoring.
 */
export function describeCallableError(
  err: unknown,
  opts: { online?: boolean; fallback?: string } = {},
): CallableFailure {
  const fallback = opts.fallback || 'Something went wrong. Please try again.';

  if (opts.online === false || (err as { name?: string })?.name === 'OfflineError') {
    return {
      kind: 'offline',
      unexpected: false,
      message: "You're offline — this needs an internet connection. Try again once you're back on.",
    };
  }

  const code = codeOf(err);
  const serverMessage = messageOf(err);

  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
      return {
        kind: 'unreachable',
        unexpected: false,
        message: serverMessage || "Couldn't reach the server. Check your connection and try again.",
      };
    case 'unauthenticated':
      return {
        kind: 'unauthenticated',
        unexpected: false,
        message: serverMessage || 'Your session has expired. Sign in again and retry.',
      };
    case 'permission-denied':
      return {
        kind: 'permission-denied',
        unexpected: false,
        message: serverMessage || "You don't have permission to do that.",
      };
    case 'internal':
      // The one genuine-crash case. The server's generic sentence is shown,
      // but this is flagged unexpected so it also reaches monitoring.
      return { kind: 'crashed', unexpected: true, message: serverMessage || fallback };
    case '':
      // No code at all — not a callable rejection. Almost always a transport
      // failure (DNS, blocked request) rather than the function running.
      return {
        kind: 'unreachable',
        unexpected: false,
        message: "Couldn't reach the server. Check your connection and try again.",
      };
    default:
      // Every classified server refusal: already-exists, invalid-argument,
      // resource-exhausted, failed-precondition… The server wrote a specific,
      // actionable sentence for each — show it as-is.
      return { kind: 'rejected', unexpected: false, message: serverMessage || fallback };
  }
}
