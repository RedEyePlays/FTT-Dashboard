import { DevicePhoto } from '../types';
import { photoPath, thumbPath } from '../domain/devicePhotos';
import { resizeForUpload } from './imageResize';
import { newId } from '../domain/ids';

/**
 * PUTTING A DEVICE PHOTO IN CLOUD STORAGE, AND TAKING IT BACK OUT AGAIN.
 *
 * Both halves live here together on purpose: a delete that removes the row but
 * leaves the object is a bill the shop pays every month for a file nobody can
 * see. The path is built by domain/devicePhotos.ts so the uploader and the
 * deleter cannot disagree about where it went.
 *
 * Failures REJECT and say why (the writeFailed pattern). A photo that silently
 * doesn't upload is the same class of bug as the Quick Purchase one — the
 * screen said it worked and the thing was never there.
 */

// Imported lazily, exactly as services/backupStorage.ts does, so the Firebase
// Storage SDK stays out of the main bundle for the pages that never upload.
async function storageApi() {
  const [{ ref, uploadBytes, getDownloadURL, deleteObject }, storage] = await Promise.all([
    import('firebase/storage'),
    import('./firebase').then(m => m.loadStorage()),
  ]);
  return { ref, uploadBytes, getDownloadURL, deleteObject, storage };
}

export interface UploadDevicePhotoInput {
  workspaceId: string;
  itemId: string;
  file: Blob;
  addedBy: string;
  /** Reports 0..1 as the two objects land, for the progress bar. */
  onProgress?: (fraction: number) => void;
}

/**
 * Resize, upload both sizes, and hand back the row to store on the device.
 *
 * The row is NOT written here — the caller owns the device document and the
 * optimistic-concurrency question that goes with it.
 */
export async function uploadDevicePhoto(input: UploadDevicePhotoInput): Promise<DevicePhoto> {
  const { workspaceId, itemId, file, addedBy, onProgress } = input;
  const id = newId();

  onProgress?.(0.05);
  // Never upload a 12 MP original — see services/imageResize.ts.
  const { full, thumb } = await resizeForUpload(file);
  onProgress?.(0.3);

  const { ref, uploadBytes, getDownloadURL, storage } = await storageApi();
  const meta = { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' };

  const fullRef = ref(storage, photoPath(workspaceId, itemId, id));
  await uploadBytes(fullRef, full, meta);
  onProgress?.(0.7);

  const thumbRef = ref(storage, thumbPath(workspaceId, itemId, id));
  await uploadBytes(thumbRef, thumb, meta);
  onProgress?.(0.9);

  const [url, thumbUrl] = await Promise.all([getDownloadURL(fullRef), getDownloadURL(thumbRef)]);
  onProgress?.(1);

  return { id, url, thumbUrl, kind: 'real', addedBy, addedAt: Date.now() };
}

/**
 * Remove the objects behind a photo row.
 *
 * A MISSING OBJECT IS NOT A FAILURE: re-deleting, or deleting a stock photo
 * whose file is shared with other devices of the same model, must not stop the
 * row being removed. Anything else propagates, so the caller can tell the user
 * the delete did not happen.
 */
export async function deleteDevicePhotoObjects(
  workspaceId: string,
  itemId: string,
  photo: DevicePhoto,
): Promise<void> {
  // A STOCK photo's file is shared by every device of that model (it lives
  // under _stock/<modelKey>, not under this device), so removing it here would
  // blank the photo on every other one. The row goes; the file stays.
  if (photo.kind === 'stock') return;

  const { ref, deleteObject, storage } = await storageApi();
  const paths = [photoPath(workspaceId, itemId, photo.id), thumbPath(workspaceId, itemId, photo.id)];
  await Promise.all(paths.map(async p => {
    try {
      await deleteObject(ref(storage, p));
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'storage/object-not-found') return;   // already gone: fine
      throw e;
    }
  }));
}
