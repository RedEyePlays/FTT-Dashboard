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

export const isBarcodeDetectionSupported = (): boolean => !!getBarcodeDetectorCtor();

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
 */
export async function detectBarcodes(source: CanvasImageSource): Promise<string[]> {
  const detector = getDetector();
  if (!detector) return [];
  try {
    const results = await detector.detect(source);
    return results.map(r => r.rawValue).filter(Boolean);
  } catch {
    return [];
  }
}
