// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MobileCheckout } from './MobileCheckout';

// The "Scan / Add" button is the main, thumb-sized CTA on the mobile
// checkout screen. A phone has no wedge-scanner gun, so the field it reads
// is normally empty — handleScan('') was a silent no-op, which from a phone
// in hand reads as "the button does nothing" / "doesn't open the camera"
// (only the small camera icon inside the input did that). This locks in the
// fix: tapping the big button with nothing typed now opens the camera
// directly, same as the icon.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

// MobileCheckout lazy-loads QRScanner (React.lazy + dynamic import) so most
// sessions never pay for the camera code. Pre-warm that import once so the
// per-test act() flush below only has to wait on React's own Suspense
// re-render, not a cold module load racing the assertion.
beforeAll(async () => { await import('./QRScanner'); });

beforeEach(() => {
  (globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  };
  // happy-dom's real srcObject setter rejects anything that isn't a real
  // MediaStream instance — same workaround ImeiScanner.test.tsx uses so
  // QRScanner's startCamera()/stopCamera() can run without a real camera.
  let srcObjectStash: unknown = null;
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    configurable: true,
    get() { return srcObjectStash; },
    set(v) { srcObjectStash = v; },
  });
});

const scanButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Scan / Add')) as HTMLButtonElement;

describe('MobileCheckout — "Scan / Add" button', () => {
  it('opens the camera when tapped with an empty scan field (the normal phone-in-hand case)', async () => {
    const { host, unmount } = mount(<MobileCheckout inventory={[]} onComplete={() => {}} />);
    act(() => { scanButton(host).click(); });
    // QRScanner is lazy-loaded via Suspense — flush the dynamic import. The
    // very first import in the whole run takes longer than a couple of
    // microtasks to settle, so wait on a real macrotask rather than just
    // chained promises.
    await act(async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toContain('Scan QR / Barcode');
    unmount();
  });

  it('does NOT open the camera when the field already has a value — adds/searches instead', async () => {
    const { host, unmount } = mount(<MobileCheckout inventory={[]} onComplete={() => {}} />);
    const input = host.querySelector('input[inputmode="search"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '123456789012345');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { scanButton(host).click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).not.toContain('Scan QR / Barcode');
    unmount();
  });

  it('the dedicated camera icon still opens the camera directly, unaffected by this change', async () => {
    const { host, unmount } = mount(<MobileCheckout inventory={[]} onComplete={() => {}} />);
    const cameraBtn = host.querySelector('button[aria-label="Scan with camera"]') as HTMLButtonElement;
    act(() => { cameraBtn.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('Scan QR / Barcode');
    unmount();
  });
});
