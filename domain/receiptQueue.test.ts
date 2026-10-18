import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS, QueuedScan, afterAttempt, hasUnsent, isPendingRow, isRetryable,
  pendingRows, queueLabel, retryDelayMs, shouldAttempt, unsentCount,
  unsentWarning,
} from './receiptQueue';

/**
 * A SCAN THAT SILENTLY DOESN'T UPLOAD IS WORSE THAN NO FEATURE AT ALL.
 *
 * The owner bins the paper once he has photographed it, so the one thing the
 * queue must never do is let "saved on this device" read as "filed". These
 * tests are mostly about that distinction and about not retrying forever.
 */

const NOW = 1_780_000_000_000;

const scan = (over: Partial<QueuedScan> = {}): QueuedScan => ({
  id: 'p1', receiptId: 'r1', page: 0, state: 'pending',
  capturedAt: NOW, attempts: 0, sizeBytes: 220_000, contentType: 'image/jpeg',
  ...over,
});

describe('a queued scan is never described as filed', () => {
  it('says plainly that it is only on this device', () => {
    expect(queueLabel('pending')).toBe('Saved on this device — not uploaded yet');
    // 'done' is the ONLY state whose wording is "Filed".
    expect(queueLabel('done')).toBe('Filed');
    for (const s of ['pending', 'uploading', 'failed'] as const) {
      expect(queueLabel(s)).not.toBe('Filed');
    }
  });

  it('warns for as long as anything is unsent, and tells the owner not to bin the paper', () => {
    expect(unsentWarning([])).toBeNull();
    const one = unsentWarning([scan()])!;
    expect(one).toMatch(/1 scan is saved on this device/);
    expect(one).toMatch(/don't throw the paper away/);
    const two = unsentWarning([scan(), scan({ id: 'p2' })])!;
    expect(two).toMatch(/2 scans are saved/);
  });

  it('counts anything not yet stored as unsent, including failures', () => {
    const q = [scan({ state: 'done' }), scan({ id: 'b', state: 'pending' }), scan({ id: 'c', state: 'failed' }), scan({ id: 'd', state: 'uploading' })];
    expect(unsentCount(q)).toBe(3);
    expect(hasUnsent(q)).toBe(true);
    expect(hasUnsent([scan({ state: 'done' })])).toBe(false);
  });
});

describe('retrying, without looping forever', () => {
  it('backs off exponentially and then stops growing', () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(3)).toBe(8_000);
    expect(retryDelayMs(99)).toBe(60_000);
  });

  it('tries a fresh scan immediately when online, and never when offline', () => {
    expect(shouldAttempt(scan(), NOW, true)).toBe(true);
    expect(shouldAttempt(scan(), NOW, false)).toBe(false);
  });

  it('waits out the backoff between attempts', () => {
    const tried = scan({ attempts: 2, lastAttemptAt: NOW });
    expect(shouldAttempt(tried, NOW + 1_000, true)).toBe(false);
    expect(shouldAttempt(tried, NOW + 4_000, true)).toBe(true);
  });

  it('never re-sends something already stored or in flight', () => {
    expect(shouldAttempt(scan({ state: 'done' }), NOW, true)).toBe(false);
    expect(shouldAttempt(scan({ state: 'uploading' }), NOW, true)).toBe(false);
    // Not even on an explicit tap — that would upload the same page twice.
    expect(shouldAttempt(scan({ state: 'done' }), NOW, true, true)).toBe(false);
  });

  it('gives up after MAX_ATTEMPTS rather than burning the budget', () => {
    expect(shouldAttempt(scan({ attempts: MAX_ATTEMPTS, lastAttemptAt: 0 }), NOW, true)).toBe(false);
  });

  it('a FAILED scan is retried only on an explicit tap', () => {
    const failed = scan({ state: 'failed', attempts: 3, lastAttemptAt: 0 });
    // Not on a timer: it failed for a reason retrying will not fix, and a loop
    // re-sending a refused 8 MB file costs the shop money for nothing.
    expect(shouldAttempt(failed, NOW, true)).toBe(false);
    expect(shouldAttempt(failed, NOW, true, true)).toBe(true);
  });
});

describe('which failures are worth retrying', () => {
  it('a network problem is — that is what the queue is for', () => {
    expect(isRetryable(new Error('network request failed'))).toBe(true);
    expect(isRetryable({ code: 'storage/retry-limit-exceeded' })).toBe(true);
    expect(isRetryable(new Error('Failed to fetch'))).toBe(true);
  });

  it('a refusal is NOT — it will fail identically forever', () => {
    expect(isRetryable({ code: 'storage/unauthorized' })).toBe(false);
    expect(isRetryable({ code: 'permission-denied' })).toBe(false);
    expect(isRetryable(new Error('Payload too large'))).toBe(false);
    expect(isRetryable({ code: 'resource-exhausted', message: 'quota' })).toBe(false);
  });

  it('a success clears the error and marks it filed', () => {
    const done = afterAttempt(scan({ attempts: 2, lastError: 'boom' }), NOW, null);
    expect(done.state).toBe('done');
    expect(done.lastError).toBeUndefined();
  });

  it('a retryable failure goes back to pending, a fatal one to failed', () => {
    expect(afterAttempt(scan(), NOW, new Error('network')).state).toBe('pending');
    expect(afterAttempt(scan(), NOW, { code: 'storage/unauthorized' }).state).toBe('failed');
  });

  it('a retryable failure still becomes failed once attempts run out', () => {
    const last = scan({ attempts: MAX_ATTEMPTS - 1 });
    const after = afterAttempt(last, NOW, new Error('network'));
    expect(after.attempts).toBe(MAX_ATTEMPTS);
    expect(after.state).toBe('failed');
    // And it keeps WHY, so the archive can say so rather than just sulking.
    expect(after.lastError).toMatch(/network/);
  });
});

describe('queued scans appear in the archive, marked as not filed', () => {
  it('groups pages into one row per receipt', () => {
    const rows = pendingRows([
      scan({ id: 'p1', receiptId: 'r1', page: 0 }),
      scan({ id: 'p2', receiptId: 'r1', page: 1 }),
      scan({ id: 'p3', receiptId: 'r2', capturedAt: NOW + 5000 }),
    ]);
    expect(rows).toHaveLength(2);
    // Newest capture first.
    expect(rows[0].receiptId).toBe('r2');
    expect(rows[1].pages).toBe(2);
  });

  it('omits anything already stored', () => {
    expect(pendingRows([scan({ state: 'done' })])).toEqual([]);
  });

  it('THE WORST STATE WINS, so a half-failed receipt reads as a problem', () => {
    const rows = pendingRows([
      scan({ id: 'p1', receiptId: 'r1', state: 'pending' }),
      scan({ id: 'p2', receiptId: 'r1', state: 'failed' }),
    ]);
    expect(rows[0].state).toBe('failed');
    expect(rows[0].label).toBe(queueLabel('failed'));
  });

  it('carries the label from the one place it is written', () => {
    const row = pendingRows([scan()])[0];
    expect(row.label).toBe(queueLabel('pending'));
    expect(row.label).not.toBe('Filed');
  });

  it('is distinguishable from a real receipt in the type system', () => {
    const row = pendingRows([scan()])[0];
    expect(isPendingRow(row)).toBe(true);
    expect(isPendingRow({
      id: 'r1', pages: [], status: 'unreviewed', uploadedBy: 'u', uploadedByEmail: 'e', uploadedAt: NOW,
    })).toBe(false);
  });

  it('dates a queued row by when it was PHOTOGRAPHED', () => {
    // A receipt scanned in a car on Friday is a Friday receipt even if it
    // reaches Firebase on Monday.
    const row = pendingRows([scan({ capturedAt: NOW - 86_400_000 })])[0];
    expect(row.capturedAt).toBe(NOW - 86_400_000);
  });
});
