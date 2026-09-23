import { DevicePhoto, InventoryItem } from '../types';

/**
 * DEVICE PHOTOS: which one is the main one, and what a customer is told.
 *
 * Pure — no DOM, no Storage. The upload path lives in services/, the gallery
 * in components/; everything that decides ORDER and WORDING is here so both
 * can be reasoned about without a browser.
 */

/** Six is plenty for a phone, and keeps a device document from bloating. */
export const MAX_DEVICE_PHOTOS = 6;

/**
 * THE MAIN PHOTO.
 *
 * A REAL photo always beats a stock one, whatever the order says. This is the
 * rule that makes "a real photo takes priority everywhere" true without
 * anybody having to remember to delete the placeholder — the moment somebody
 * photographs the device, the stock image drops behind on every surface at
 * once. Within a kind, the stored order wins, so "set as main" still works.
 */
export const mainPhoto = (photos?: DevicePhoto[]): DevicePhoto | null => {
  const list = photos || [];
  return list.find(p => p.kind === 'real') || list[0] || null;
};

/** Photos in display order: real first, then stock, each keeping its order. */
export const orderedPhotos = (photos?: DevicePhoto[]): DevicePhoto[] => {
  const list = photos || [];
  return [...list.filter(p => p.kind === 'real'), ...list.filter(p => p.kind !== 'real')];
};

/** Move one photo to the front — "set as main". */
export const setMainPhoto = (photos: DevicePhoto[], id: string): DevicePhoto[] => {
  const target = photos.find(p => p.id === id);
  if (!target) return photos;
  return [target, ...photos.filter(p => p.id !== id)];
};

export const removePhoto = (photos: DevicePhoto[], id: string): DevicePhoto[] =>
  photos.filter(p => p.id !== id);

/** Room for another? */
export const canAddPhoto = (photos?: DevicePhoto[]): boolean =>
  (photos || []).length < MAX_DEVICE_PHOTOS;

export const hasRealPhoto = (photos?: DevicePhoto[]): boolean =>
  (photos || []).some(p => p.kind === 'real');

/**
 * THE LABEL A CUSTOMER SEES.
 *
 * A stock photo is a picture of the MODEL, not of the device being sold, and
 * showing one unlabelled next to a price is a small lie that a customer only
 * discovers when they open the box. A real photo needs no caveat, so it gets
 * none — a label on everything is a label nobody reads.
 */
export const STOCK_PHOTO_NOTE = 'Stock photo — actual device may vary';

export const photoNote = (photo: DevicePhoto | null): string | null =>
  photo && photo.kind === 'stock' ? STOCK_PHOTO_NOTE : null;

/**
 * The attribution line, shown wherever a stock photo is shown publicly.
 *
 * Small and at the edge, but PRESENT: most Commons files are CC-BY or
 * CC-BY-SA, and those licences require credit. Dropping it because it is ugly
 * would make every public use of the image a licence breach.
 */
export const photoCredit = (photo: DevicePhoto | null): string | null =>
  photo && photo.kind === 'stock' && photo.credit ? photo.credit : null;

/* ---------------- The damage-photo nudge ---------------- */

/**
 * Conditions that need no explanation. Anything else has marks on it, and a
 * buyer who can see them does not ask for a refund about them.
 */
const CLEAN_CONDITIONS = new Set(['New', 'Like New']);

/**
 * Should we ask for a photo of the damage?
 *
 * A NUDGE, NEVER A BLOCK. The device saves either way; this only decides
 * whether to offer the prompt once. Asked only when the grade says there is
 * something to see AND there is no real photo yet — a shop that has already
 * photographed the device has answered the question.
 */
export const wantsDamagePhoto = (
  item: Pick<InventoryItem, 'condition' | 'photos' | 'kind'>,
): boolean => {
  if (item.kind === 'accessory') return false;
  const condition = (item.condition || '').trim();
  if (!condition || CLEAN_CONDITIONS.has(condition)) return false;
  return !hasRealPhoto(item.photos);
};

export const DAMAGE_PHOTO_PROMPT =
  'This one is marked as “{condition}”. A photo of the marks now saves a conversation later — want to add one?';

export const damagePhotoPrompt = (condition: string): string =>
  DAMAGE_PHOTO_PROMPT.replace('{condition}', condition);

/* ---------------- Storage paths ---------------- */

/**
 * Where a photo lives. ONE shape, used by the uploader and the delete path, so
 * a deleted row can always find its object — a row removed without its file is
 * a bill the shop pays forever.
 */
export const photoPath = (workspaceId: string, itemId: string, photoId: string): string =>
  `deviceImages/${workspaceId}/${itemId}/${photoId}.jpg`;

export const thumbPath = (workspaceId: string, itemId: string, photoId: string): string =>
  `deviceImages/${workspaceId}/${itemId}/${photoId}_thumb.jpg`;
