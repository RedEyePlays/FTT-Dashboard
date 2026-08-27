// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImeiScanner } from './ImeiScanner';

// Item "Verify" of the camera-scanner task, specifically:
//  - the barcode path is used when a barcode is present and NO AI call is made
//  - the on-device tiers fall through to AI when they find nothing
// Both are proven here against the real component with the browser-only
// pieces (BarcodeDetector, OCR, getUserMedia) mocked at the service
// boundary — domain/imeiScan.test.ts already covers the pure
// classification/validation logic these mocks feed into.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/imeiBarcode', () => ({
  isBarcodeDetectionSupported: vi.fn(() => false),
  detectBarcodes: vi.fn(async () => [] as string[]),
}));
vi.mock('../services/imeiOcr', () => ({
  runOcrTier: vi.fn(async () => [] as string[]),
}));
vi.mock('../services/geminiService', () => ({
  extractImeiFromImage: vi.fn(async () => ({ imei1: '', imei2: '', serial: '', eid: '' })),
}));

import { detectBarcodes, isBarcodeDetectionSupported } from '../services/imeiBarcode';
import { runOcrTier } from '../services/imeiOcr';
import { extractImeiFromImage } from '../services/geminiService';

const VALID_IMEI = '490154203237518';

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

beforeEach(() => {
  vi.clearAllMocks();
  (isBarcodeDetectionSupported as any).mockReturnValue(false);
  (detectBarcodes as any).mockResolvedValue([]);
  (runOcrTier as any).mockResolvedValue([]);
  (extractImeiFromImage as any).mockResolvedValue({ imei1: '', imei2: '', serial: '', eid: '' });

  (globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  };
  // happy-dom's real srcObject setter rejects anything that isn't a real
  // MediaStream instance — replace it with a plain stash so the component's
  // startCamera()/stopCamera() can run without a real camera.
  let srcObjectStash: unknown = null;
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    configurable: true,
    get() { return srcObjectStash; },
    set(v) { srcObjectStash = v; },
  });
  // happy-dom's canvas has no real 2D context; stub just enough for the
  // component's draw/read calls to not throw.
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  (HTMLCanvasElement.prototype as any).toDataURL = vi.fn(() => 'data:image/jpeg;base64,AAAA');
});

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function clickCapture(host: HTMLElement) {
  const btn = host.querySelector('button.w-16.h-16') as HTMLButtonElement;
  await act(async () => {
    btn.click();
    // Several sequential awaits chain inside handleCapture (barcode -> OCR ->
    // AI) — give the microtask queue a few turns to drain them all.
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
  });
}

describe('ImeiScanner tier fallthrough', () => {
  it('a barcode present on capture is used and Gemini is never called', async () => {
    (isBarcodeDetectionSupported as any).mockReturnValue(true);
    (detectBarcodes as any).mockResolvedValue([VALID_IMEI]);

    const onScan = vi.fn();
    const { host, unmount } = mount(<ImeiScanner onScan={onScan} onClose={() => {}} />);
    await flush();

    await clickCapture(host);

    expect(onScan).toHaveBeenCalledWith(VALID_IMEI);
    expect(runOcrTier).not.toHaveBeenCalled();
    expect(extractImeiFromImage).not.toHaveBeenCalled();
    unmount();
  });

  it('falls through to AI when barcode detection is unsupported and OCR finds nothing', async () => {
    (isBarcodeDetectionSupported as any).mockReturnValue(false); // feature-detect: not available
    (runOcrTier as any).mockResolvedValue([]);
    (extractImeiFromImage as any).mockResolvedValue({ imei1: VALID_IMEI, imei2: '', serial: '', eid: '' });

    const onScan = vi.fn();
    const { host, unmount } = mount(<ImeiScanner onScan={onScan} onClose={() => {}} />);
    await flush();

    await clickCapture(host);

    expect(detectBarcodes).toHaveBeenCalled(); // still attempted as a capture-time backstop
    expect(extractImeiFromImage).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(VALID_IMEI);
    unmount();
  });

  it('when barcode AND OCR both find nothing, OCR ran before AI was reached', async () => {
    (isBarcodeDetectionSupported as any).mockReturnValue(true);
    (detectBarcodes as any).mockResolvedValue([]);
    (runOcrTier as any).mockResolvedValue(['garbage##']);
    (extractImeiFromImage as any).mockResolvedValue({ imei1: VALID_IMEI, imei2: '', serial: '', eid: '' });

    const { host, unmount } = mount(<ImeiScanner onScan={() => {}} onClose={() => {}} />);
    await flush();

    await clickCapture(host);

    expect(runOcrTier).toHaveBeenCalled();
    expect(extractImeiFromImage).toHaveBeenCalledTimes(1); // OCR's garbage token classified to nothing, fell through
    unmount();
  });
});
