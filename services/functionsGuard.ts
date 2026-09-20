// Cloud Functions calls (AI ops, technician repair updates, and any future
// notification sends) go over a plain HTTPS request — unlike Firestore reads/
// writes there is no offline queue or local cache behind them. Calling one
// while offline would otherwise hang until the browser's own request timeout
// (which can be 30s+) or reject with an opaque low-level network error deep
// inside the Firebase SDK. Failing fast, with a recognizable error type, lets
// every caller show a clear "unavailable offline" message instead.
export class OfflineError extends Error {
  constructor(message = "This needs an internet connection — you're offline.") {
    super(message);
    this.name = 'OfflineError';
  }
}

export const assertOnline = (message?: string): void => {
  if (!navigator.onLine) {
    throw new OfflineError(message);
  }
};

// Two Firestore TRANSACTIONS that cannot be made safe offline, with the
// sentence each one shows. A transaction needs a live server and is not queued
// by the offline cache (PR #197's finding), so without this they rejected with
// a raw Firebase error and a device intake failed while selling one still
// worked — same class of bug, same confusion, no explanation.
//
// Neither may fall back to a local write: both exist precisely to stop two
// clients claiming the same thing, and a provisional value to reconcile later
// trades one clear failure for a silent duplicate somebody has to hunt down.
export const OFFLINE_SKU_MESSAGE =
  "Can't allocate a SKU while offline — reconnect to add this device.";
export const OFFLINE_IMEI_INDEX_MESSAGE =
  "Can't check this IMEI against inventory while offline — reconnect to add this device.";
