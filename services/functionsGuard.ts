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

export const assertOnline = (): void => {
  if (!navigator.onLine) {
    throw new OfflineError();
  }
};
