// Tier 1 of the camera scanner (domain/imeiScan.ts, components/ImeiScanner.tsx):
// the browser's native BarcodeDetector API, free/instant/offline. Support
// varies (notably on iOS/iPadOS Safari), so every entry point here is
// feature-detected and fails soft — a missing/erroring detector just means
// the scanner falls through to Tier 2 (OCR), never a thrown error.

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};

const getBarcodeDetectorCtor = (): BarcodeDetectorCtor | undefined =>
  (typeof window !== 'undefined' ? (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector : undefined);

/** Is the browser's OWN detector present? (Not "can we scan barcodes" — see below.) */
export const isBarcodeDetectionSupported = (): boolean => !!getBarcodeDetectorCtor();

/**
 * Can this build scan barcodes at all? Always true now that a JS fallback
 * ships (services/imeiBarcodeFallback.ts) — kept as a named function rather
 * than inlining `true` because the live scan loop's gate reads as a real
 * question, and because it's the one place to revisit if the fallback is ever
 * made conditional. Callers must gate the LIVE LOOP on this, never on
 * isBarcodeDetectionSupported: gating on the native check is precisely what
 * disabled live barcode scanning on iOS and pushed those scans to the AI tier.
 */
export const isBarcodeScanningAvailable = (): boolean => true;

/**
 * How often the live loop should sample frames, in ms. The JS fallback
 * decodes on the main thread and is markedly heavier than the native
 * detector, so it samples less often — still comfortably faster than a person
 * can reposition a phone over a label, and it keeps the preview smooth on the
 * older phones most likely to lack a native detector in the first place.
 */
export const liveScanIntervalMs = (): number => (isBarcodeDetectionSupported() ? 600 : 1000);

// Common 1D formats device boxes print (IMEI/serial/part-number barcodes)
// plus QR, since some boxes/manuals use a QR code for the IMEI instead.
const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code'];

let detectorInstance: InstanceType<BarcodeDetectorCtor> | null | undefined;

const getDetector = (): InstanceType<BarcodeDetectorCtor> | null => {
  if (detectorInstance !== undefined) return detectorInstance;
  const Ctor = getBarcodeDetectorCtor();
  try {
    detectorInstance = Ctor ? new Ctor({ formats: FORMATS }) : null;
  } catch {
    detectorInstance = null; // constructor threw (e.g. unsupported format list) — treat as unsupported
  }
  return detectorInstance;
};

/**
 * Decode every barcode visible in one frame (a video element for the live
 * loop, or a canvas snapshot on capture). Returns the raw decoded payloads —
 * classification into IMEI/serial/etc happens in domain/imeiScan.ts, since a
 * box can carry several barcodes and this layer shouldn't guess which is
 * which. Never throws: any detector failure (unsupported source type,
 * transient decode error) resolves to an empty array so the caller falls
 * through to the next tier.
 *
 * TIER ORDER, and why the JS fallback lives HERE rather than in the component:
 * native BarcodeDetector → JS fallback (services/imeiBarcodeFallback.ts,
 * lazy-loaded) → [caller continues to OCR → AI]. Putting the fallback behind
 * this one function means every existing caller — the live scan loop AND the
 * capture-frame backstop — gets it with no per-call-site wiring, so a barcode
 * is caught by simply pointing the camera on a browser with no native
 * detector, which is exactly the iOS-PWA case that was falling through to AI.
 *
 * The native detector is still tried FIRST wherever it exists: it's faster and
 * costs no download. The fallback chunk is only ever fetched on a browser that
 * lacks it.
 */
export async function detectBarcodes(source: CanvasImageSource): Promise<string[]> {
  const detector = getDetector();
  if (!detector) {
    // No native engine — this is the iOS/PWA path. Use the JS decoder rather
    // than reporting "no barcode" and letting the scan fall through to AI.
    const { detectBarcodesJs } = await import('./imeiBarcodeFallback');
    return detectBarcodesJs(source);
  }
  try {
    const results = await detector.detect(source);
    return results.map(r => r.rawValue).filter(Boolean);
  } catch (err) {
    // A native detector that EXISTS but throws is unexpected (a transient
    // decode error on one frame is normal and returns []; a throw is not).
    // Log it — this was silently swallowed before — then still try the JS
    // decoder, so a broken native implementation degrades to a working scan
    // rather than to an AI call.
    console.error('[imeiBarcode] native BarcodeDetector.detect failed', err);
    try {
      const { detectBarcodesJs } = await import('./imeiBarcodeFallback');
      return await detectBarcodesJs(source);
    } catch {
      return [];
    }
  }
}

/** Reset the memoized detector between tests. */
export const __resetDetectorForTests = () => { detectorInstance = undefined; };

/**
 * Start fetching the JS fallback chunk NOW, if this browser will need it.
 * Called when the scanner modal opens, for two reasons:
 *
 *  1. The first live-loop frame would otherwise stall on a ~460 kB download,
 *     making the scanner look broken for the first second on exactly the
 *     devices that already lack a native detector.
 *  2. OFFLINE USE IN THE INSTALLED PWA. The service worker (public/sw.js)
 *     caches /assets/** cache-first but only populates on first fetch, so a
 *     chunk never requested is not in the cache — a first-ever scan while
 *     offline would find no decoder at all. Fetching it as soon as the
 *     scanner is opened (normally while online) gets it into the SW cache so
 *     later offline scans work, which is the whole point of an on-device tier.
 *
 * Fire-and-forget: a failure here is already handled inside the fallback
 * (logged, then treated as "this tier found nothing").
 */
export const prewarmBarcodeFallback = (): void => {
  if (isBarcodeDetectionSupported()) return; // native engine — never needed
  void import('./imeiBarcodeFallback').then(m => m.warmFallbackDecoder()).catch(() => {});
};
