// Pure classification of the failures the camera scanner can hit, so
// components/ImeiScanner.tsx shows the user WHICH thing went wrong instead of
// one catch-all string, and so every branch is unit-testable without a camera.
//
// This exists because both scanner catch blocks used to discard the real
// exception entirely: `catch (err) { setError('Failed to process image.') }`
// with no console.error, and a startCamera that blamed permissions for every
// failure including ones with nothing to do with permissions. Whatever was
// actually breaking — no BarcodeDetector, tesseract failing to load, the
// Cloud Function rejecting — was invisible to the user AND to devtools.

/** A classified failure: what to show the user, and whether it's a real fault. */
export interface ScanFailure {
  /** Shown in the scanner's error banner — actionable, never a bare "failed". */
  message: string;
  /**
   * True when this is an UNEXPECTED fault worth reporting to error monitoring.
   * False for the ordinary, user-recoverable outcomes (permission denied, no
   * camera, offline) — those are logged but would be pure noise in a crash
   * dashboard, and they're not bugs.
   */
  unexpected: boolean;
  /** Stable tag for logs/telemetry, so a spike in one cause is greppable. */
  kind:
    | 'permission-denied'
    | 'no-camera'
    | 'insecure-context'
    | 'camera-in-use'
    | 'offline'
    | 'not-found'
    | 'unknown';
}

// DOMException names getUserMedia actually raises, per the Media Capture spec.
// Firefox and Safari differ on some of these, hence matching several per case.
const PERMISSION_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const NO_CAMERA_NAMES = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError']);
const IN_USE_NAMES = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);

const nameOf = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const n = (err as { name?: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return '';
};

/**
 * Why the camera wouldn't start. `secureContext` and `hasMediaDevices` are
 * passed in rather than read off `window` here so this stays pure — the
 * component supplies them from the real browser.
 *
 * The insecure-context and missing-mediaDevices cases are checked FIRST
 * because they don't produce a distinctive DOMException name: on plain HTTP,
 * `navigator.mediaDevices` is simply undefined, which used to surface as
 * "Could not access camera. Please allow permissions." — advice that can
 * never fix it, sending the user to hunt through settings for a permission
 * that was never the problem.
 */
export function describeCameraError(
  err: unknown,
  env: { secureContext?: boolean; hasMediaDevices?: boolean } = {},
): ScanFailure {
  if (env.secureContext === false) {
    return {
      kind: 'insecure-context',
      unexpected: false,
      message: 'The camera needs a secure (https) connection. Open the app over https or from its installed icon.',
    };
  }
  if (env.hasMediaDevices === false) {
    return {
      kind: 'no-camera',
      unexpected: false,
      message: "This browser doesn't offer camera access. Try Chrome or Safari, or type the number in by hand.",
    };
  }

  const name = nameOf(err);
  if (PERMISSION_NAMES.has(name)) {
    return {
      kind: 'permission-denied',
      unexpected: false,
      message: 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
    };
  }
  if (NO_CAMERA_NAMES.has(name)) {
    return {
      kind: 'no-camera',
      unexpected: false,
      message: 'No usable camera was found on this device. You can type the number in by hand instead.',
    };
  }
  if (IN_USE_NAMES.has(name)) {
    return {
      kind: 'camera-in-use',
      unexpected: false,
      message: 'The camera is already in use by another app. Close it and try again.',
    };
  }
  return {
    kind: 'unknown',
    unexpected: true,
    message: `Could not start the camera${name ? ` (${name})` : ''}. Check the browser's camera permission, then try again.`,
  };
}

/**
 * Why a capture/processing run failed. Distinguishes "we're offline so the AI
 * tier couldn't run" (expected, recoverable, not a fault) from a genuine
 * crash inside a tier — the case that was being reported as "Failed to
 * process image." with the real exception thrown away.
 */
export function describeScanError(err: unknown, env: { online?: boolean } = {}): ScanFailure {
  if (env.online === false || nameOf(err) === 'OfflineError') {
    return {
      kind: 'offline',
      unexpected: false,
      message: "You're offline, so the AI scan couldn't run. On-device scanning still works — or type the number in by hand.",
    };
  }
  const detail = err instanceof Error && err.message ? err.message : '';
  return {
    kind: 'unknown',
    unexpected: true,
    message: `Couldn't process that image${detail ? `: ${detail}` : '.'}${detail ? '.' : ''} Try again, or type the number in by hand.`,
  };
}

/**
 * The scanner ran cleanly and simply found nothing. Deliberately a SEPARATE
 * function from describeScanError: "nothing in frame" is the single most
 * common outcome of a bad angle or glare and is not a failure — conflating
 * the two is what made a real crash indistinguishable from a near-miss.
 */
export function describeScanNotFound(env: { online?: boolean } = {}): ScanFailure {
  return {
    kind: 'not-found',
    unexpected: false,
    message: env.online === false
      ? 'No IMEI or serial found. Try moving closer or reducing glare — AI scanning is unavailable while offline.'
      : 'No IMEI or serial detected. Try moving closer, reducing glare, or use "Scan with AI".',
  };
}
