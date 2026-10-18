import { Receipt } from '../types';

/**
 * CAPTURE MUST SURVIVE A DEAD CONNECTION, BECAUSE THE PAPER GETS BINNED.
 *
 * THE DECISION, and why: the brief allows either a local queue with retry or a
 * loud failure. This is the queue, because a loud failure fails in exactly the
 * place the feature is for. The named use cases are a counter, a car, and a
 * pocket of paper after a supplier trip — all places with no usable signal —
 * and "scanning is unavailable right now" there means the receipt is never
 * captured at all. The shop has already lost a night of time-clock punches to
 * a dropped connection; a receipt is worse, because the owner throws the paper
 * away once he has photographed it.
 *
 * WHY A QUEUE IS NEEDED AT ALL, when Firestore already has one: Firestore's
 * persistent cache queues the receipt DOCUMENT, but Cloud Storage does not
 * queue the IMAGE BYTES. An upload attempted offline fails outright. So the
 * document alone would sync and the archive would fill with receipts whose
 * photo does not exist — the exact silent loss this is written to prevent.
 * The bytes are therefore held in IndexedDB until they are actually stored.
 *
 * THE RULE THE UI MUST KEEP: a queued scan is "Saved on this device" and is
 * NEVER described as filed. `queueLabel` below is the only wording used, so
 * no screen can claim the second while it means the first. A scan that is
 * still on one phone is one dropped phone away from gone, and the owner has to
 * be able to see that.
 *
 * Pure: no IndexedDB, no Firebase, no DOM. services/receiptQueue.ts is the
 * storage layer; this is the state machine it follows.
 */

export type QueuedState =
  /** Bytes are on this device only. NOT filed. Nothing else has it. */
  | 'pending'
  /** Being uploaded right now. */
  | 'uploading'
  /** Stored and the document written — this is the only state meaning "filed". */
  | 'done'
  /**
   * Tried and failed for a reason retrying will not fix — refused by the rules,
   * or too big. Held, shown, and never silently dropped.
   */
  | 'failed';

export interface QueuedScan {
  id: string;
  /** The receipt document id these pages belong to; stable across retries. */
  receiptId: string;
  /** Page index within that receipt, so a two-page invoice re-assembles in order. */
  page: number;
  state: QueuedState;
  /** When it was photographed — the archive dates it by this, not by upload. */
  capturedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * WHAT THE OWNER IS TOLD. One wording, used everywhere.
 *
 * "Saved on this device" is deliberately not reassuring. It is accurate, and
 * the whole point is that the owner can tell it apart from "Filed" at a glance
 * while standing somewhere with no signal.
 */
export const queueLabel = (state: QueuedState): string => {
  switch (state) {
    case 'pending': return 'Saved on this device — not uploaded yet';
    case 'uploading': return 'Uploading…';
    case 'done': return 'Filed';
    case 'failed': return 'Could not upload — tap to retry';
  }
};

/** Is anything still only on this device? Drives the persistent warning. */
export const hasUnsent = (queue: QueuedScan[]): boolean =>
  queue.some(q => q.state === 'pending' || q.state === 'uploading' || q.state === 'failed');

export const unsentCount = (queue: QueuedScan[]): number =>
  queue.filter(q => q.state !== 'done').length;

/**
 * The banner the archive shows while anything is unsent.
 *
 * Named and plural-correct because it is the one thing standing between a
 * queued photo and a binned receipt.
 */
export const unsentWarning = (queue: QueuedScan[]): string | null => {
  const n = unsentCount(queue);
  if (n === 0) return null;
  return n === 1
    ? '1 scan is saved on this device and has not uploaded yet. Keep this device online until it does — don\'t throw the paper away.'
    : `${n} scans are saved on this device and have not uploaded yet. Keep this device online until they do — don't throw the paper away.`;
};

/* ---------------- Retry ---------------- */

export const MAX_ATTEMPTS = 6;

/**
 * How long before trying again, in ms. Exponential, capped.
 *
 * Capped rather than unbounded because the realistic recovery is "the owner
 * walks back into wifi", which is minutes, not hours — and because a backoff
 * that grows forever is indistinguishable from having given up.
 */
export const retryDelayMs = (attempts: number): number =>
  Math.min(60_000, 2_000 * Math.pow(2, Math.max(0, attempts - 1)));

/**
 * Is it worth trying this one now?
 *
 * A 'failed' scan is retried only on an explicit tap (`force`), not on a
 * timer: it failed for a reason retrying will not fix, and a loop re-sending
 * an 8 MB file the rules refuse costs the shop money for nothing.
 */
export const shouldAttempt = (
  q: QueuedScan,
  now: number,
  online: boolean,
  force = false,
): boolean => {
  if (q.state === 'done' || q.state === 'uploading') return false;
  if (force) return true;
  if (!online) return false;
  if (q.state === 'failed') return false;
  if (q.attempts >= MAX_ATTEMPTS) return false;
  if (q.attempts === 0) return true;
  return now - (q.lastAttemptAt || 0) >= retryDelayMs(q.attempts);
};

/**
 * Which failures are worth retrying.
 *
 * A permission denial or an over-size refusal will fail identically forever;
 * a network error is the case this queue exists for. Getting this wrong in the
 * generous direction burns the AI/storage budget on a doomed loop, and in the
 * strict direction throws away a receipt because a wifi hiccup looked fatal —
 * so the test is on the error, not on the attempt count.
 */
export const isRetryable = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code ?? '');
  const message = String((error as { message?: unknown })?.message ?? '');
  const hay = `${code} ${message}`.toLowerCase();
  if (/unauthorized|permission|forbidden|unauthenticated|quota|payload|too large|invalid/.test(hay)) return false;
  return true;
};

export const afterAttempt = (
  q: QueuedScan,
  now: number,
  error: unknown | null,
): QueuedScan => {
  if (!error) return { ...q, state: 'done', lastAttemptAt: now, lastError: undefined };
  const attempts = q.attempts + 1;
  const retryable = isRetryable(error);
  return {
    ...q,
    attempts,
    lastAttemptAt: now,
    lastError: String((error as { message?: unknown })?.message ?? error),
    state: retryable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
  };
};

/* ---------------- Showing queued scans in the archive ---------------- */

/**
 * A queued scan rendered as a receipt-shaped row, so the list is not missing
 * the thing the owner just photographed.
 *
 * Marked `pendingUpload` so every screen that shows it has to acknowledge the
 * difference rather than treating it as filed. It is NOT written to Firestore —
 * this is a view concern only.
 */
export interface PendingReceiptRow {
  pendingUpload: true;
  id: string;
  receiptId: string;
  capturedAt: number;
  state: QueuedState;
  label: string;
  pages: number;
}

export const pendingRows = (queue: QueuedScan[]): PendingReceiptRow[] => {
  const byReceipt = new Map<string, QueuedScan[]>();
  for (const q of queue) {
    if (q.state === 'done') continue;
    const list = byReceipt.get(q.receiptId) || [];
    list.push(q);
    byReceipt.set(q.receiptId, list);
  }
  return [...byReceipt.entries()]
    .map(([receiptId, pages]) => {
      // The worst state wins, so a two-page receipt with one failed page reads
      // as a problem rather than as half-done.
      const state: QueuedState = pages.some(p => p.state === 'failed') ? 'failed'
        : pages.some(p => p.state === 'uploading') ? 'uploading'
          : 'pending';
      return {
        pendingUpload: true as const,
        id: `queued:${receiptId}`,
        receiptId,
        capturedAt: Math.min(...pages.map(p => p.capturedAt)),
        state,
        label: queueLabel(state),
        pages: pages.length,
      };
    })
    .sort((a, b) => b.capturedAt - a.capturedAt);
};

/** True for a row that only exists on this device. Narrows the union in views. */
export const isPendingRow = (r: Receipt | PendingReceiptRow): r is PendingReceiptRow =>
  (r as PendingReceiptRow).pendingUpload === true;
