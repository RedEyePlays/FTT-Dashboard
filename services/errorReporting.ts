// Lightweight, optional crash/error reporting. Two hard requirements drove
// this design:
//   1. No PII ever leaves the browser — no customer names/phones/emails, no
//      IMEIs/serials, no note contents, no auth tokens. Everything passed in
//      as context is scrubbed by key name before it's sent anywhere.
//   2. Zero cost when unconfigured or unused — the actual reporting SDK
//      (@sentry/browser) is only imported the first time an error is
//      captured AND a DSN is configured, so it never touches the main
//      bundle, and most sessions (no crash, ever) never load it at all.
//
// If VITE_SENTRY_DSN isn't set, this module still tracks uncaught errors
// (logged to the console) so local dev isn't silent, but never attempts a
// network call.

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Any context key matching this gets its value replaced outright — applied
// recursively to every object passed to captureError, and to Sentry's own
// event payload via beforeSend as a second layer in case an integration
// picks up something we didn't explicitly pass in (e.g. a DOM node's text).
const PII_KEY_PATTERN = /email|phone|imei|serial|name|note|token|password|pin|secret|address|customer|auth/i;

export const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEY_PATTERN.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
};

export type ErrorContext = Record<string, unknown>;

let sentryModulePromise: Promise<typeof import('@sentry/browser')> | null = null;
let sentryReady = false;
const tags: Record<string, string> = {};

// Called by App.tsx whenever the current route/role changes, so a later
// crash report carries where the user was and what they could do — useful
// for debugging, not identifying (role is a job title, not a person).
export const setErrorContext = (ctx: { route?: string; role?: string }) => {
  if (ctx.route !== undefined) tags.route = ctx.route;
  if (ctx.role !== undefined) tags.role = ctx.role;
  if (sentryReady) {
    void loadSentry().then(Sentry => {
      if (ctx.route !== undefined) Sentry.setTag('route', ctx.route);
      if (ctx.role !== undefined) Sentry.setTag('role', ctx.role);
    });
  }
};

const loadSentry = async () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return null;
  if (!sentryModulePromise) {
    sentryModulePromise = import('@sentry/browser').then(Sentry => {
      Sentry.init({
        dsn,
        release: appVersion,
        // No performance tracing, no session replay, no default PII capture
        // (breadcrumbs from clicks/console can otherwise carry page text) —
        // just exception capture. Keeps the lazily-loaded chunk small and
        // avoids the SDK's own integrations working around our scrubbing.
        integrations: [],
        sendDefaultPii: false,
        beforeSend(event) {
          return scrub(event) as typeof event;
        },
      });
      Object.entries(tags).forEach(([k, v]) => Sentry.setTag(k, v));
      sentryReady = true;
      return Sentry;
    });
  }
  return sentryModulePromise;
};

/**
 * Report an error with optional debugging context (route, role, boundary
 * name, component stack — never customer/business data). Safe to call
 * whether or not reporting is configured; never throws.
 */
export const captureError = (error: unknown, context?: ErrorContext): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  // Always visible locally, configured or not — an owner running `npm run
  // dev` or checking the console after a bug report shouldn't need Sentry
  // access just to see what happened.
  console.error('[captureError]', err, context);

  void loadSentry()
    .then(Sentry => {
      if (!Sentry) return; // unconfigured — console.error above is enough
      Sentry.captureException(err, { extra: scrub(context) as Record<string, unknown> });
    })
    .catch(() => {
      // Reporting must never itself become a source of uncaught errors.
    });
};

let globalHandlersInstalled = false;

/** Call once at startup. Cheap — only attaches listeners; the SDK itself
 * loads lazily on the first actual error (see loadSentry above). */
export const initErrorReporting = (): void => {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener('error', event => {
    captureError(event.error ?? event.message, { source: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', event => {
    captureError(event.reason, { source: 'unhandledrejection' });
  });
};
