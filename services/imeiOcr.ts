// Tier 2 of the camera scanner (domain/imeiScan.ts, components/ImeiScanner.tsx):
// on-device OCR, free and offline (no Gemini call). Two engines, in priority
// order, both feature-detected/lazy so a browser with neither costs nothing:
//
//  1. The native Shape Detection TextDetector API, where available — zero
//     extra weight, but support is limited (mainly older Chrome behind a
//     flag/origin trial) so this is best-effort only.
//  2. tesseract.js, dynamically imported on first use only. It's a real
//     dependency (~2MB of wasm+worker), so it must never enter the main
//     bundle — every import here is inside the function that needs it,
//     never a top-level import, so Vite code-splits it into its own chunk
//     that's only fetched the first time OCR actually runs.
//
// Only the character whitelist and cropping to the region of interest happen
// here; classifying the recognized text into IMEI/serial/etc is
// domain/imeiScan.ts's job (the caller runs classifyScannedValues on
// whatever candidate tokens this returns).

type TextDetectorCtor = new () => {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};

const getTextDetectorCtor = (): TextDetectorCtor | undefined =>
  (typeof window !== 'undefined' ? (window as unknown as { TextDetector?: TextDetectorCtor }).TextDetector : undefined);

export const isNativeTextDetectionSupported = (): boolean => !!getTextDetectorCtor();

// Digit sequences (5+, IMEI-length candidates included) and short
// alphanumeric runs (serial-shaped) — pulled out of whatever raw text either
// engine reads, since both can return a whole blob of text including the
// on-screen labels ("IMEI", "Serial Number", …) around the actual value.
function extractCandidateTokens(text: string): string[] {
  const matches = text.match(/[A-Z0-9]{5,20}/gi) || [];
  return Array.from(new Set(matches.map(t => t.toUpperCase())));
}

async function runNativeTextDetector(source: CanvasImageSource): Promise<string[]> {
  const Ctor = getTextDetectorCtor();
  if (!Ctor) return [];
  try {
    const detector = new Ctor();
    const results = await detector.detect(source);
    return extractCandidateTokens(results.map(r => r.rawValue).join(' '));
  } catch {
    return [];
  }
}

async function runTesseract(canvas: HTMLCanvasElement): Promise<string[]> {
  try {
    // Dynamic import: keeps tesseract.js out of the main bundle entirely
    // until a real scan actually reaches this tier.
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      await worker.setParameters({
        // IMEI/serial strings are digits and A-Z — constraining the
        // recognizer to this set measurably improves accuracy over free-form
        // text recognition, and rules out most non-numeric OCR noise.
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      });
      const { data } = await worker.recognize(canvas);
      return extractCandidateTokens(data.text || '');
    } finally {
      await worker.terminate();
    }
  } catch {
    return [];
  }
}

/**
 * Run on-device OCR against a (typically pre-cropped, region-of-interest)
 * canvas and return candidate alphanumeric tokens — NOT yet validated as an
 * IMEI/serial. The caller runs these through
 * domain/imeiScan.ts's classifyScannedValues, which is what actually decides
 * whether a token is a usable, verified field. Tries the free native
 * detector first; only reaches for tesseract.js (a real network+CPU cost on
 * first use) if that's unavailable or found nothing.
 */
export async function runOcrTier(canvas: HTMLCanvasElement): Promise<string[]> {
  const native = await runNativeTextDetector(canvas);
  if (native.length) return native;
  return runTesseract(canvas);
}
