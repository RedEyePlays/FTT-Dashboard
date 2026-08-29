// Tier 1b of the camera scanner: a pure-JS barcode/QR decoder used ONLY when
// the browser has no native BarcodeDetector (services/imeiBarcode.ts).
//
// Why this exists: BarcodeDetector support is genuinely inconsistent on
// iOS/iPadOS Safari — and the installed PWA is a WebKit web view, so a device
// that has it in a Safari tab may not have it once the app is added to the
// home screen. Without a fallback, tier 1 silently found nothing there and
// every scan fell through to OCR and then to the AI tier: slower, needing a
// network round trip, and costing an API call to read a QR code the phone
// should decode instantly and offline. The shop's own ZP 450 inventory labels
// carry QR codes (services/labelLayout.ts), so scanning your own stock was
// hitting the AI tier — the case this most obviously should never do.
//
// @zxing/library is LAZY-LOADED on first use (a dynamic import inside the
// decode call, never a top-level one), so it forms its own chunk and never
// enters the main bundle. A browser WITH a native detector never downloads it
// at all: getReader() is only ever reached when detectBarcodes found no
// native detector.

// Kept in sync with imeiBarcode.ts's FORMATS — the same set the native
// detector is asked for, so switching engines can't silently change which
// codes the scanner can read. QR is what the shop's own labels use; the 1D
// formats are what device boxes print an IMEI/serial in.
type ZXingModule = typeof import('@zxing/library');

let readerPromise: Promise<{ mod: ZXingModule; reader: InstanceType<ZXingModule['MultiFormatReader']> } | null> | null = null;

const buildReader = async () => {
  const mod = await import('@zxing/library');
  const { MultiFormatReader, BarcodeFormat, DecodeHintType } = mod;
  const hints = new Map<number, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.DATA_MATRIX,
  ]);
  // TRY_HARDER costs a little CPU per frame but materially improves reads of
  // a slightly rotated or low-contrast label — which is the normal case when
  // someone is holding a phone over a device box.
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints as never);
  return { mod, reader };
};

/**
 * Load (once) and return the decoder, or null if the library can't be loaded
 * at all — an offline cold start with the chunk not yet cached, say. Failing
 * to load is NOT an error the user should see: it just means this tier finds
 * nothing and the scanner falls through to OCR, exactly as it behaved before
 * this fallback existed.
 */
const getReader = () => {
  if (!readerPromise) {
    readerPromise = buildReader().catch(err => {
      // Deliberately logged, not swallowed: "the fallback never loaded" is
      // the single most likely reason a report of "it still uses AI on my
      // phone" would recur, and it is invisible otherwise.
      console.error('[imeiBarcodeFallback] failed to load @zxing/library', err);
      return null;
    });
  }
  return readerPromise;
};

/** Reset between tests — the module-level promise otherwise leaks across cases. */
export const __resetFallbackReaderForTests = () => { readerPromise = null; };

/**
 * Build the decoder ahead of the first frame. See imeiBarcode.ts's
 * prewarmBarcodeFallback for why (first-frame latency, and getting the chunk
 * into the PWA's service-worker cache so later OFFLINE scans have a decoder).
 */
export const warmFallbackDecoder = (): Promise<unknown> => getReader();

// Pulls RGBA pixels out of whatever the scanner hands us. A <video> has to be
// drawn to a scratch canvas first (zxing reads pixel data, not media
// elements); a canvas can be read directly.
function toImageData(source: CanvasImageSource): ImageData | null {
  let canvas: HTMLCanvasElement | null = null;
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    canvas = source;
  } else if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    const v = source;
    if (!v.videoWidth || !v.videoHeight) return null; // stream not ready yet
    const scratch = document.createElement('canvas');
    scratch.width = v.videoWidth;
    scratch.height = v.videoHeight;
    const sctx = scratch.getContext('2d');
    if (!sctx) return null;
    sctx.drawImage(v, 0, 0, scratch.width, scratch.height);
    canvas = scratch;
  }
  if (!canvas || !canvas.width || !canvas.height) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null; // tainted canvas (cross-origin frame) — nothing decodable here
  }
}

/**
 * RGBA → one luminance byte per pixel. Required, not an optimization:
 * RGBLuminanceSource takes EITHER a packed-ARGB Int32Array or a
 * one-byte-per-pixel Uint8ClampedArray, and handing it a raw 4-bytes-per-pixel
 * RGBA buffer makes every decode fail with "no finder pattern found" — it
 * reads the frame as four times too wide. Standard Rec.601 weights.
 */
function toLuminance(image: ImageData): Uint8ClampedArray {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(width * height);
  for (let p = 0; p < out.length; p++) {
    const i = p * 4;
    out[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}

/**
 * Decode one frame with the JS fallback. Returns the raw decoded payloads —
 * exactly the same contract as imeiBarcode.ts's detectBarcodes, so the caller
 * can't tell which engine produced a value and the results go through the
 * SAME domain/imeiScan.ts classification + Luhn validation either way. Raw
 * output is never accepted as a field on its own.
 *
 * Never throws: zxing signals "no code in this frame" by THROWING
 * NotFoundException, which for a live scan loop is the overwhelmingly common
 * case (most frames have no barcode) and is not an error — so a miss resolves
 * to [] silently, while an unexpected failure is logged before doing the same.
 */
export async function detectBarcodesJs(source: CanvasImageSource): Promise<string[]> {
  const loaded = await getReader();
  if (!loaded) return [];
  const imageData = toImageData(source);
  if (!imageData) return [];

  const { mod, reader } = loaded;
  try {
    const luminance = new mod.RGBLuminanceSource(
      toLuminance(imageData),
      imageData.width,
      imageData.height,
    );
    const bitmap = new mod.BinaryBitmap(new mod.HybridBinarizer(luminance));
    const result = reader.decode(bitmap);
    const text = result?.getText?.();
    return text ? [text] : [];
  } catch (err) {
    // NotFoundException is the "no barcode in frame" signal, not a fault.
    if ((err as { name?: string })?.name === 'NotFoundException') return [];
    console.error('[imeiBarcodeFallback] decode failed', err);
    return [];
  } finally {
    reader.reset();
  }
}
