// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import {
  detectBarcodes, isBarcodeDetectionSupported, isBarcodeScanningAvailable,
  liveScanIntervalMs, __resetDetectorForTests,
} from './imeiBarcode';
import { __resetFallbackReaderForTests } from './imeiBarcodeFallback';
import { classifyScannedValues, hasVerifiedField } from '../domain/imeiScan';

// TIER ORDER: native BarcodeDetector → JS fallback → (caller: OCR → AI).
//
// The reported bug: in the installed PWA on iOS, BarcodeDetector is absent, so
// tier 1 returned nothing and scans fell through to the paid AI tier — even for
// the shop's own QR-coded ZP 450 inventory labels. These tests remove the
// native detector entirely (exactly that environment) and assert a QR still
// resolves here, so the caller never reaches OCR or AI at all.

function qrCanvas(payload: string): HTMLCanvasElement {
  const matrix = new MultiFormatWriter().encode(payload, BarcodeFormat.QR_CODE, 300, 300, new Map());
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = matrix.get(x, y) ? 0 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const image = { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext = (() => ({ getImageData: () => image, drawImage: () => {} })) as never;
  return canvas;
}

const removeNativeDetector = () => { delete (window as { BarcodeDetector?: unknown }).BarcodeDetector; };

beforeEach(() => { __resetDetectorForTests(); __resetFallbackReaderForTests(); });
afterEach(() => { removeNativeDetector(); vi.restoreAllMocks(); });

describe('tier 1 with NO native BarcodeDetector (the iOS / installed-PWA case)', () => {
  beforeEach(removeNativeDetector);

  it('reports the native API as unsupported but scanning as still available', () => {
    // The live loop must gate on the SECOND of these. Gating on the first is
    // what disabled live barcode scanning on iOS and pushed scans to AI.
    expect(isBarcodeDetectionSupported()).toBe(false);
    expect(isBarcodeScanningAvailable()).toBe(true);
  });

  it("resolves a QR from one of the app's own inventory labels — no AI tier needed", async () => {
    const imei = '356789101234563';
    const values = await detectBarcodes(qrCanvas(imei));
    expect(values).toEqual([imei]);

    // And it survives the real validation path, so the scanner would stop here
    // (applyTierResult('barcode', …)) rather than continuing to OCR/AI.
    const fields = classifyScannedValues(values);
    expect(hasVerifiedField(fields)).toBe(true);
    expect(fields[0].value).toBe(imei);
  });

  it('samples the live loop less often when running on the heavier JS decoder', () => {
    expect(liveScanIntervalMs()).toBe(1000);
  });
});

describe('tier 1 with a native BarcodeDetector present', () => {
  it('uses the native detector and does NOT load the JS fallback', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: '356789101234563' }]);
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class { detect = detect; };
    __resetDetectorForTests();

    expect(await detectBarcodes(document.createElement('canvas'))).toEqual(['356789101234563']);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(isBarcodeDetectionSupported()).toBe(true);
    expect(liveScanIntervalMs()).toBe(600); // the faster native cadence is kept
  });

  it('falls back to the JS decoder when the native one THROWS, and logs why', async () => {
    // A native detector that exists but throws used to silently return [] — a
    // scan would then fall through to AI with no trace of the real reason.
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() { return Promise.reject(new Error('native detector exploded')); }
    };
    __resetDetectorForTests();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const imei = '356789101234563';
    expect(await detectBarcodes(qrCanvas(imei))).toEqual([imei]);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('BarcodeDetector');
  });

  it('returns [] for a plain miss without treating it as a failure', async () => {
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() { return Promise.resolve([]); }
    };
    __resetDetectorForTests();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await detectBarcodes(document.createElement('canvas'))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
