// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImeiScanner } from './ImeiScanner';

// The scanner used to swallow the real exception outright:
//   catch (err) { setError('Failed to process image.') }   // no console.error
// and startCamera blamed permissions for EVERY failure. Whatever was actually
// breaking was invisible in devtools and undiagnosable from the message.
//
// These tests assert both halves of the fix against the real component: the
// underlying error always reaches the console, and the message shown tells the
// four cases apart (permission / no camera / offline / nothing found).

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/imeiBarcode', () => ({
  isBarcodeDetectionSupported: vi.fn(() => false),
  isBarcodeScanningAvailable: vi.fn(() => true),
  liveScanIntervalMs: vi.fn(() => 600),
  prewarmBarcodeFallback: vi.fn(),
  detectBarcodes: vi.fn(async () => [] as string[]),
}));
vi.mock('../services/imeiOcr', () => ({ runOcrTier: vi.fn(async () => [] as string[]) }));
vi.mock('../services/geminiService', () => ({
  extractImeiFromImage: vi.fn(async () => ({ imei1: '', imei2: '', serial: '', eid: '' })),
}));

import { detectBarcodes } from '../services/imeiBarcode';
import { runOcrTier } from '../services/imeiOcr';
import { extractImeiFromImage } from '../services/geminiService';

let errorSpy: ReturnType<typeof vi.spyOn>;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); }); };

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });

const domErr = (name: string) => Object.assign(new Error(`${name} raised`), { name });

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (detectBarcodes as any).mockResolvedValue([]);
  (runOcrTier as any).mockResolvedValue([]);
  (extractImeiFromImage as any).mockResolvedValue({ imei1: '', imei2: '', serial: '', eid: '' });
  setOnline(true);
  (globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  };
  let stash: unknown = null;
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    configurable: true, get() { return stash; }, set(v) { stash = v; },
  });
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  (HTMLCanvasElement.prototype as any).toDataURL = vi.fn(() => 'data:image/jpeg;base64,AAAA');
});

afterEach(() => { errorSpy.mockRestore(); });

const banner = (host: HTMLElement) => host.textContent || '';

async function mountScanner() {
  const r = mount(<ImeiScanner onScan={() => {}} onClose={() => {}} />);
  await flush();
  return r;
}

async function clickCapture(host: HTMLElement) {
  const btn = host.querySelector('button.w-16.h-16') as HTMLButtonElement | null;
  if (!btn) return;
  await act(async () => {
    btn.click();
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  });
}

describe('camera failures are distinguished, and the real error is logged', () => {
  it('permission denied says so — and logs the underlying exception', async () => {
    const err = domErr('NotAllowedError');
    (navigator.mediaDevices.getUserMedia as any) = vi.fn(async () => { throw err; });
    const { host, unmount } = await mountScanner();

    expect(banner(host)).toMatch(/allow the camera/i);
    // The exception itself — not just a string — reaches the console.
    expect(errorSpy).toHaveBeenCalled();
    const call = errorSpy.mock.calls.find(c => String(c[0]).includes('permission-denied'));
    expect(call).toBeTruthy();
    expect(call![1]).toBe(err);
    unmount();
  });

  it('no camera present says no camera — NOT "allow permissions"', async () => {
    (navigator.mediaDevices.getUserMedia as any) = vi.fn(async () => { throw domErr('NotFoundError'); });
    const { host, unmount } = await mountScanner();
    expect(banner(host)).toMatch(/no usable camera/i);
    expect(banner(host)).not.toMatch(/allow the camera/i);
    unmount();
  });

  it('a camera held by another app is its own case', async () => {
    (navigator.mediaDevices.getUserMedia as any) = vi.fn(async () => { throw domErr('NotReadableError'); });
    const { host, unmount } = await mountScanner();
    expect(banner(host)).toMatch(/already in use/i);
    unmount();
  });

  it('an insecure context is reported as such, without ever calling getUserMedia', async () => {
    const getUserMedia = vi.fn();
    (navigator.mediaDevices as any) = { getUserMedia };
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
    const { host, unmount } = await mountScanner();

    expect(banner(host)).toMatch(/https/i);
    expect(getUserMedia).not.toHaveBeenCalled(); // it would only throw uselessly
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true });
    unmount();
  });
});

describe('capture failures are distinguished, and the real error is logged', () => {
  it('a crashing tier surfaces its real message instead of "Failed to process image."', async () => {
    const boom = new Error('tesseract worker failed to load');
    (runOcrTier as any).mockRejectedValue(boom);
    const { host, unmount } = await mountScanner();
    await clickCapture(host);

    expect(banner(host)).toContain('tesseract worker failed to load');
    expect(banner(host)).not.toContain('Failed to process image.');
    // And the exception is logged, which it previously never was.
    const call = errorSpy.mock.calls.find(c => c[1] === boom);
    expect(call).toBeTruthy();
    unmount();
  });

  it('offline is reported as offline, not as a processing crash', async () => {
    setOnline(false);
    (runOcrTier as any).mockRejectedValue(new Error('network down'));
    const { host, unmount } = await mountScanner();
    await clickCapture(host);

    expect(banner(host)).toMatch(/you're offline/i);
    expect(banner(host)).toMatch(/on-device scanning still works/i);
    unmount();
  });

  it('finding nothing is NOT reported as a failure — no console.error at all', async () => {
    const { host, unmount } = await mountScanner();
    errorSpy.mockClear();
    await clickCapture(host);

    expect(banner(host)).toMatch(/no imei or serial detected/i);
    // A clean run that simply found nothing must not look like a crash.
    expect(errorSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('when offline, the not-found hint stops suggesting the AI scan that cannot run', async () => {
    setOnline(false);
    const { host, unmount } = await mountScanner();
    await clickCapture(host);
    expect(banner(host)).toMatch(/unavailable while offline/i);
    unmount();
  });
});
