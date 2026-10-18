import { Receipt, ReceiptPage } from '../types';
import { resizeForUpload } from './imageResize';

/**
 * PUTTING A RECEIPT IMAGE IN CLOUD STORAGE, AND TAKING IT BACK OUT.
 *
 * Both halves together, like services/devicePhotoUpload.ts: a delete that
 * removes the row and leaves the object is a bill the shop pays monthly for a
 * file nobody can see.
 *
 * ITS OWN PREFIX — `receipts/{workspaceId}/{receiptId}/…` — and NOT
 * `deviceImages/`. That prefix is publicly readable with no auth, deliberately,
 * so the kiosk and Marketplace links work; its own comment in storage.rules
 * names receipts as a thing that must never go there. A receipt carries trade
 * pricing and card details.
 *
 * Failures REJECT and say why. A scan that silently does not upload is worse
 * than no feature at all, because the owner bins the paper after photographing
 * it — which is why the caller queues the bytes (services/receiptQueue.ts) and
 * only clears them once BOTH the upload and the document write have resolved.
 */

async function storageApi() {
  const [{ ref, uploadBytes, getDownloadURL, deleteObject }, storage] = await Promise.all([
    import('firebase/storage'),
    import('./firebase').then(m => m.loadStorage()),
  ]);
  return { ref, uploadBytes, getDownloadURL, deleteObject, storage };
}

/** One definition of where a receipt page lives, so uploader and deleter agree. */
export const receiptPagePath = (workspaceId: string, receiptId: string, pageId: string): string =>
  `receipts/${workspaceId}/${receiptId}/${pageId}.jpg`;

export const receiptThumbPath = (workspaceId: string, receiptId: string, pageId: string): string =>
  `receipts/${workspaceId}/${receiptId}/${pageId}_thumb.jpg`;

export interface UploadReceiptPageInput {
  workspaceId: string;
  receiptId: string;
  pageId: string;
  file: Blob;
}

/**
 * Resize, upload the full page and its thumbnail, and hand back the row.
 *
 * Resized to FULL_MAX_EDGE 1600 / JPEG_QUALITY 0.8, the same as the device
 * photo path: a phone original is several MB and receipt text stays legible at
 * 1600px, which is also what keeps the parse cheap. The thumbnail is for the
 * archive list, which would otherwise pull every full page over shop wifi.
 */
export async function uploadReceiptPage(
  input: UploadReceiptPageInput,
): Promise<ReceiptPage> {
  const { ref, uploadBytes, storage } = await storageApi();
  const { full, thumb } = await resizeForUpload(input.file);

  const fullPath = receiptPagePath(input.workspaceId, input.receiptId, input.pageId);
  const thumbnailPath = receiptThumbPath(input.workspaceId, input.receiptId, input.pageId);

  await uploadBytes(ref(storage, fullPath), full, { contentType: 'image/jpeg' });
  // The thumbnail is a convenience, not the record. If it fails the page is
  // still filed and still viewable; the list falls back to the full image.
  let thumbOk = true;
  try {
    await uploadBytes(ref(storage, thumbnailPath), thumb, { contentType: 'image/jpeg' });
  } catch {
    thumbOk = false;
  }

  return {
    path: fullPath,
    ...(thumbOk ? { thumbPath: thumbnailPath } : {}),
    sizeBytes: full.size,
    contentType: 'image/jpeg',
  };
}

/** A viewable URL for a stored path. */
export async function receiptUrl(path: string): Promise<string> {
  const { ref, getDownloadURL, storage } = await storageApi();
  return getDownloadURL(ref(storage, path));
}

/**
 * Remove every object behind a receipt.
 *
 * ONLY called from the owner-only delete path. Marking a receipt
 * `not_expense` must never reach this — that status keeps the image, which is
 * the whole difference between "not a business cost" and "this photo should
 * not exist".
 */
export async function deleteReceiptObjects(receipt: Pick<Receipt, 'pages'>): Promise<void> {
  const { ref, deleteObject, storage } = await storageApi();
  for (const page of receipt.pages || []) {
    for (const path of [page.path, page.thumbPath]) {
      if (!path) continue;
      // Each object independently: one already-missing file must not strand
      // the rest, which would leave exactly the orphans this exists to avoid.
      try { await deleteObject(ref(storage, path)); } catch { /* already gone */ }
    }
  }
}

/** Read a Blob as base64 for the parse callable, header stripped. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(blob);
  });
}
