/**
 * RESIZE BEFORE UPLOAD, ALWAYS.
 *
 * A phone camera produces a 12 MP, 4–6 MB JPEG. Six of those on a device is
 * 30 MB the shop pays to store, pays again to serve, and which the kiosk then
 * tries to load over shop wifi — for an image displayed at 400px. So nothing
 * reaches Storage at its original size: the longest edge comes down to 1600px
 * at ~80% JPEG, plus a ~400px thumbnail for lists and the kiosk grid.
 *
 * Uses canvas, which every browser the shop runs already has. EXIF orientation
 * is handled by createImageBitmap's imageOrientation option where available,
 * so a photo taken in portrait does not upload sideways.
 */

export const FULL_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 400;
export const JPEG_QUALITY = 0.8;

export interface ResizedImage {
  full: Blob;
  thumb: Blob;
}

/** The size a longest-edge cap implies, never scaling a small image UP. */
export const fitWithin = (
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF rotation, so a portrait photo stays
      // portrait instead of arriving on its side.
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      // Older Safari rejects the option — fall through to the <img> path.
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

const dimensions = (source: ImageBitmap | HTMLImageElement) => ({
  width: 'width' in source ? source.width : 0,
  height: 'height' in source ? source.height : 0,
});

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not process the image.');
  // A white floor: a transparent PNG flattened to JPEG goes black otherwise.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('The image could not be prepared for upload.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

/** A full-size and a thumbnail JPEG, both well under the 5 MB storage cap. */
export async function resizeForUpload(file: Blob): Promise<ResizedImage> {
  const source = await loadBitmap(file);
  const { width, height } = dimensions(source);
  if (!width || !height) throw new Error('That file could not be read as an image.');

  const fullSize = fitWithin(width, height, FULL_MAX_EDGE);
  const thumbSize = fitWithin(width, height, THUMB_MAX_EDGE);

  const full = await toBlob(draw(source as CanvasImageSource, fullSize.width, fullSize.height));
  const thumb = await toBlob(draw(source as CanvasImageSource, thumbSize.width, thumbSize.height));

  if ('close' in source && typeof source.close === 'function') source.close();
  return { full, thumb };
}
