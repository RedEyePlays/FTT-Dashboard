import React, { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Star, Trash2, AlertTriangle } from 'lucide-react';
import { DevicePhoto } from '../types';
import {
  MAX_DEVICE_PHOTOS, STOCK_PHOTO_NOTE, canAddPhoto, orderedPhotos,
  removePhoto, setMainPhoto,
} from '../domain/devicePhotos';
import { uploadDevicePhoto, deleteDevicePhotoObjects } from '../services/devicePhotoUpload';
import { writeErrorMessage } from '../domain/writeErrors';

/**
 * THE PHOTO GALLERY ON A DEVICE.
 *
 * Two ways in, because they are two different moments: the CAMERA (capture=
 * "environment", the pattern ImeiScanner already uses) for a device on the
 * bench, and the gallery for a photo taken earlier.
 *
 * Deleting removes the Storage object too, not just the row — a row removed
 * without its file is a bill the shop pays every month for something nobody
 * can see. And an upload that fails SAYS SO: a photo that silently does not
 * upload is the same class of bug as the Quick Purchase one.
 */

interface Props {
  workspaceId: string;
  itemId: string;
  photos?: DevicePhoto[];
  currentUserId: string;
  /** Persist the new list. The caller owns the device document. */
  onChange: (photos: DevicePhoto[]) => void;
  /** Ask the Cloud Function for a stock photo. Owner-facing. */
  onFindStockPhoto?: () => void;
  findingStock?: boolean;
  disabled?: boolean;
}

export const DevicePhotos: React.FC<Props> = ({
  workspaceId, itemId, photos, currentUserId, onChange,
  onFindStockPhoto, findingStock, disabled,
}) => {
  const list = photos || [];
  const shown = orderedPhotos(list);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    let next = list;
    try {
      for (const file of Array.from(files)) {
        if (!canAddPhoto(next)) break;          // silently stop at the cap
        setProgress(0);
        const photo = await uploadDevicePhoto({
          workspaceId, itemId, file, addedBy: currentUserId,
          onProgress: setProgress,
        });
        next = [...next, photo];
        // Written after EACH photo, so a failure on the third keeps the first
        // two rather than losing the lot.
        onChange(next);
      }
    } catch (e) {
      setError(writeErrorMessage(e, 'The photo could not be uploaded.'));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const remove = async (photo: DevicePhoto) => {
    if (!window.confirm('Delete this photo?')) return;
    setError(null);
    try {
      await deleteDevicePhotoObjects(workspaceId, itemId, photo);
      onChange(removePhoto(list, photo.id));
    } catch (e) {
      // The row stays: a row with no file is recoverable, a file with no row
      // is invisible and paid for forever.
      setError(writeErrorMessage(e, 'The photo could not be deleted.'));
    }
  };

  const cap = !canAddPhoto(list);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
          Photos <span className="text-xs font-normal text-slate-400">{list.length}/{MAX_DEVICE_PHOTOS}</span>
        </h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {onFindStockPhoto && list.length === 0 && (
            <button type="button" onClick={onFindStockPhoto} disabled={!!findingStock || disabled}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 disabled:opacity-40">
              {findingStock ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {findingStock ? 'Looking…' : 'Find a photo'}
            </button>
          )}
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || cap || disabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40">
            <Camera className="w-3.5 h-3.5" /> Take photo
          </button>
          <button type="button" onClick={() => galleryRef.current?.click()} disabled={busy || cap || disabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 disabled:opacity-40">
            <ImagePlus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* capture="environment" opens the rear camera straight away — the same
          pattern ImeiScanner uses. The gallery input deliberately omits it. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />

      {busy && (
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          No photos yet. A stock photo is fetched automatically when there is a brand and model.
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {shown.map((p, i) => (
            <div key={p.id} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <img src={p.thumbUrl || p.url} alt="" loading="lazy" className="w-full aspect-square object-cover" />
              {i === 0 && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-600 text-white">Main</span>
              )}
              {p.kind === 'stock' && (
                <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[8px] leading-tight bg-black/60 text-white truncate"
                  title={`${STOCK_PHOTO_NOTE}${p.credit ? ` · ${p.credit}` : ''}`}>
                  Stock
                </span>
              )}
              {!disabled && (
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {i !== 0 && (
                    <button type="button" title="Set as main" onClick={() => onChange(setMainPhoto(list, p.id))}
                      className="p-1.5 rounded bg-white/90 text-slate-700 hover:bg-white">
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" title="Delete" onClick={() => void remove(p)}
                    className="p-1.5 rounded bg-white/90 text-rose-600 hover:bg-white">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
