import { describe, it, expect } from 'vitest';
import { describeCameraError, describeScanError, describeScanNotFound } from './scannerErrors';

// The scanner used to show ONE string for every failure ("Failed to process
// image.", or "Could not access camera. Please allow permissions." for any
// camera problem at all) while discarding the real exception. These guard that
// each distinct cause now produces its own actionable message, and that only
// genuine faults are flagged for error monitoring.

const domErr = (name: string) => Object.assign(new Error(name), { name });

describe('describeCameraError', () => {
  it('blames permissions ONLY when permission was actually denied', () => {
    const f = describeCameraError(domErr('NotAllowedError'));
    expect(f.kind).toBe('permission-denied');
    expect(f.message).toMatch(/allow the camera/i);
    expect(f.unexpected).toBe(false); // a user choice, not a bug
  });

  it('says no camera — not "allow permissions" — when the device has none', () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']) {
      const f = describeCameraError(domErr(name));
      expect(f.kind).toBe('no-camera');
      expect(f.message).toMatch(/no usable camera/i);
      expect(f.message).not.toMatch(/permission/i); // the old advice, which could never help here
    }
  });

  it('names the insecure-context case, which no permission change can fix', () => {
    const f = describeCameraError(null, { secureContext: false });
    expect(f.kind).toBe('insecure-context');
    expect(f.message).toMatch(/https/i);
    // Checked ahead of the exception name: on http there IS no useful exception.
    expect(describeCameraError(domErr('NotAllowedError'), { secureContext: false }).kind).toBe('insecure-context');
  });

  it('distinguishes a camera held by another app', () => {
    const f = describeCameraError(domErr('NotReadableError'));
    expect(f.kind).toBe('camera-in-use');
    expect(f.message).toMatch(/already in use/i);
  });

  it('reports a browser with no mediaDevices at all as unsupported, not denied', () => {
    const f = describeCameraError(null, { hasMediaDevices: false });
    expect(f.kind).toBe('no-camera');
    expect(f.message).toMatch(/doesn't offer camera access/i);
  });

  it('treats an unrecognised failure as unexpected AND surfaces its name for diagnosis', () => {
    const f = describeCameraError(domErr('WeirdNewError'));
    expect(f.kind).toBe('unknown');
    expect(f.unexpected).toBe(true); // the only camera case worth reporting
    expect(f.message).toContain('WeirdNewError'); // no longer a dead end
  });
});

describe('describeScanError', () => {
  it('treats offline as a recoverable state, not a processing failure', () => {
    const f = describeScanError(new Error('nope'), { online: false });
    expect(f.kind).toBe('offline');
    expect(f.unexpected).toBe(false);
    expect(f.message).toMatch(/on-device scanning still works/i);
  });

  it('recognises OfflineError by name even when navigator says online', () => {
    expect(describeScanError(Object.assign(new Error('x'), { name: 'OfflineError' })).kind).toBe('offline');
  });

  it('surfaces the underlying message for a real fault instead of a catch-all', () => {
    const f = describeScanError(new Error('tesseract worker failed to load'), { online: true });
    expect(f.kind).toBe('unknown');
    expect(f.unexpected).toBe(true);
    expect(f.message).toContain('tesseract worker failed to load');
  });

  it('still produces a usable sentence for a thrown non-Error', () => {
    const f = describeScanError('just a string', { online: true });
    expect(f.message).toMatch(/couldn't process that image/i);
    expect(f.message).not.toContain('undefined');
  });
});

describe('describeScanNotFound', () => {
  it('is NOT flagged as a fault — a clean run that found nothing is normal', () => {
    const f = describeScanNotFound({ online: true });
    expect(f.kind).toBe('not-found');
    expect(f.unexpected).toBe(false);
  });

  it('suggests AI when online, and does not when offline (where it cannot work)', () => {
    expect(describeScanNotFound({ online: true }).message).toMatch(/Scan with AI/);
    const offline = describeScanNotFound({ online: false }).message;
    expect(offline).toMatch(/unavailable while offline/i);
    expect(offline).not.toMatch(/use "Scan with AI"/);
  });
});
