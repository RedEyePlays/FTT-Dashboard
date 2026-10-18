import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, Receipt, ReceiptPage } from '../types';
import { QueuedScan, shouldAttempt, afterAttempt } from '../domain/receiptQueue';
import {
  dequeueScan, enqueueScan, getScanBlob, listQueue, queueAvailable, setScanState,
  updateScan,
} from '../services/receiptQueue';
import { blobToBase64, uploadReceiptPage } from '../services/receiptUpload';
import { parseReceiptImage } from '../services/geminiService';
import { saveReceipt } from '../services/firestoreDb';
import { newId } from '../domain/ids';

/**
 * CAPTURE → HELD ON THIS DEVICE → UPLOADED → FILED → PARSED.
 *
 * The order matters and is the whole reason this is a hook rather than a few
 * calls in a click handler.
 *
 * 1. The bytes go into IndexedDB FIRST, before anything is attempted over the
 *    network. Cloud Storage has no offline queue, so an upload tried with no
 *    signal fails outright — and the owner bins the paper once he has
 *    photographed it. Holding the bytes first is what makes a scan in a car
 *    survive to the next time the phone sees wifi.
 *
 * 2. A queued page is only dropped from IndexedDB once BOTH the upload and the
 *    receipt-document write have resolved. Dropping it on the upload alone
 *    would lose the page if the document write then failed — the same silent
 *    loss in a smaller window.
 *
 * 3. THE PARSE RUNS LAST AND IS ALLOWED TO FAIL. A receipt that will not parse
 *    is still filed, still viewable and still searchable by its upload date. A
 *    parse failure is a fact about the photograph, not an error state for the
 *    receipt — so a failed parse writes a note on the document and nothing
 *    else.
 *
 * NOTHING HERE CREATES AN EXPENSE, and nothing here can. There is no call to
 * saveExpense in this file and no path from a parse result to the books.
 */

export interface UseReceiptCaptureInput {
  workspaceId: string | undefined;
  me: AppUser | null;
  isOffline: boolean;
  /** Surfaced to the owner when a scan cannot be held or cannot be filed. */
  onProblem?: (message: string) => void;
}

export interface UseReceiptCapture {
  queue: QueuedScan[];
  /** Start one or more receipts — one per file, each its own document. */
  scan: (files: File[]) => Promise<void>;
  /** Add pages to an existing receipt. A two-page invoice is one receipt. */
  addPages: (receiptId: string, files: File[]) => Promise<void>;
  /** Push the queue now, including anything previously given up on. */
  retry: () => Promise<void>;
}

export const useReceiptCapture = (
  { workspaceId, me, isOffline, onProblem }: UseReceiptCaptureInput,
): UseReceiptCapture => {
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  // One drain at a time. Two concurrent drains would upload the same page
  // twice and bill the shop for two parses of one receipt.
  const draining = useRef(false);
  const problem = useRef(onProblem);
  problem.current = onProblem;

  const refresh = useCallback(async () => setQueue(await listQueue()), []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Receipt documents this session has written, so page 2 extends page 1. */
  const pendingDocs = useRef(new Map<string, Receipt>());

  /**
   * Upload one page, write/extend the receipt document, then parse.
   *
   * Pulled out so the no-queue path above and the drain below cannot diverge
   * on the ordering, which is the part that protects the photo.
   */
  const sendOne = useCallback(async (q: QueuedScan, blob: Blob): Promise<void> => {
    if (!workspaceId || !me) throw new Error('Not signed in.');

    const page: ReceiptPage = await uploadReceiptPage({
      workspaceId, receiptId: q.receiptId, pageId: q.id, file: blob,
    });

    // The document, written AFTER the object is actually stored so the archive
    // never lists a receipt whose photo does not exist.
    const existing = pendingDocs.current.get(q.receiptId);
    const doc: Receipt = existing
      ? { ...existing, pages: [...existing.pages, page], updatedAt: Date.now() }
      : {
        id: q.receiptId,
        pages: [page],
        status: 'unreviewed',
        uploadedBy: me.id,
        uploadedByEmail: me.email,
        // Dated by when it was PHOTOGRAPHED, not when it happened to upload —
        // a receipt scanned in a car on Friday is a Friday receipt even if it
        // reaches Firebase on Monday.
        uploadedAt: q.capturedAt,
      };
    pendingDocs.current.set(q.receiptId, doc);
    await saveReceipt(workspaceId, doc);

    // Only now is the page genuinely filed.
    await dequeueScan(q.id);

    // THE PARSE IS LAST AND MAY FAIL. Only the first page is parsed: it is the
    // one with the total and the payee on it, and parsing page two of a
    // supplier invoice doubles the cost for nothing.
    if (doc.pages.length === 1) {
      try {
        const { parsed, model } = await parseReceiptImage(await blobToBase64(blob), 'image/jpeg');
        await saveReceipt(workspaceId, {
          ...doc,
          parsed: { ...parsed, parsedAt: Date.now(), ...(model ? { model } : {}) },
          updatedAt: Date.now(),
        });
        pendingDocs.current.set(q.receiptId, {
          ...doc, parsed: { ...parsed, parsedAt: Date.now(), ...(model ? { model } : {}) },
        });
      } catch (e) {
        // Filed, viewable, searchable — just not read. Recorded on the
        // document so the review screen can say so instead of showing an
        // empty form with no explanation.
        const why = e instanceof Error ? e.message : 'the photo could not be read';
        await saveReceipt(workspaceId, {
          ...doc, parsed: { failed: why, parsedAt: Date.now() }, updatedAt: Date.now(),
        }).catch(() => { /* the receipt is already filed; the note is a nicety */ });
      }
    }
  }, [workspaceId, me]);

  /**
   * Hold the bytes, then try to send them.
   *
   * `receiptId` is allocated here and stays stable across retries, so a page
   * that uploads on the third attempt still lands on the right receipt.
   */
  const hold = useCallback(async (
    receiptId: string,
    files: File[],
    firstPage: number,
  ): Promise<void> => {
    const available = await queueAvailable();
    const capturedAt = Date.now();
    for (let i = 0; i < files.length; i++) {
      const pageId = newId();
      if (available) {
        const ok = await enqueueScan({
          id: pageId, receiptId, page: firstPage + i, blob: files[i], capturedAt,
        });
        if (ok) continue;
      }
      // NO QUEUE AVAILABLE (private browsing, cleared site data, full disk).
      // This is the loud-failure path: try it immediately and say so if it
      // fails, rather than claiming to have saved something that is nowhere.
      try {
        await sendOne(
          { id: pageId, receiptId, page: firstPage + i, state: 'pending', capturedAt, attempts: 0, sizeBytes: files[i].size, contentType: files[i].type || 'image/jpeg' },
          files[i],
        );
      } catch (e) {
        problem.current?.(
          `${files[i].name || 'That scan'} could not be saved on this device and could not be uploaded. Keep the paper — it is not filed.`,
        );
        throw e;
      }
    }
    await refresh();
  }, [refresh, sendOne]);

  const drain = useCallback(async (force = false): Promise<void> => {
    if (draining.current || !workspaceId || !me) return;
    draining.current = true;
    try {
      const now = Date.now();
      const online = !isOffline;
      for (const q of await listQueue()) {
        if (!shouldAttempt(q, now, online, force)) continue;
        await setScanState(q.id, 'uploading');
        await refresh();
        const blob = await getScanBlob(q.id);
        if (!blob) {
          // The bytes are gone (cleared site data) and cannot be recovered.
          // Say so rather than leaving a row that retries forever.
          await updateScan({ ...q, state: 'failed', lastError: 'The saved image is no longer on this device.' });
          continue;
        }
        try {
          await sendOne(q, blob);
        } catch (e) {
          await updateScan(afterAttempt({ ...q, state: 'pending' }, Date.now(), e));
        }
        await refresh();
      }
    } finally {
      draining.current = false;
      await refresh();
    }
  }, [workspaceId, me, isOffline, refresh, sendOne]);

  // Push whenever the connection comes back, and on a slow timer as a
  // fallback for the case where the browser never fires an `online` event.
  useEffect(() => {
    if (isOffline) return;
    void drain();
    const t = setInterval(() => { void drain(); }, 30_000);
    return () => clearInterval(t);
  }, [isOffline, drain]);

  const scan = useCallback(async (files: File[]): Promise<void> => {
    // ONE RECEIPT PER FILE, and SEVERAL IN A ROW with no review step between
    // them — backlog capture after a supplier trip is a named use case.
    for (const file of files) {
      await hold(newId(), [file], 0);
    }
    void drain();
  }, [hold, drain]);

  const addPages = useCallback(async (receiptId: string, files: File[]): Promise<void> => {
    const existing = pendingDocs.current.get(receiptId);
    await hold(receiptId, files, existing?.pages.length ?? 1);
    void drain();
  }, [hold, drain]);

  const retry = useCallback(async (): Promise<void> => { await drain(true); }, [drain]);

  return useMemo(() => ({ queue, scan, addPages, retry }), [queue, scan, addPages, retry]);
};
