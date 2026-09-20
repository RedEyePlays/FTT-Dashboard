import { describe, it, expect } from 'vitest';
import { OfflineError, OFFLINE_SKU_MESSAGE, OFFLINE_IMEI_INDEX_MESSAGE } from './functionsGuard';

// PR #197 fixed the drawer's online-only writes. The SAME pattern was still
// live in two Firestore TRANSACTIONS — allocateSku and commitAutoInventory —
// so with the wifi down a device intake failed while selling one still worked:
// same class of bug, same confusion, and no explanation shown to anyone.

describe('two writes that cannot be made safe offline', () => {
  it('SKU allocation says what is wrong and what to do', () => {
    // The counter is the only thing stopping two devices taking the same
    // number, and two disconnected clients cannot agree on it.
    expect(OFFLINE_SKU_MESSAGE).toBe("Can't allocate a SKU while offline — reconnect to add this device.");
  });

  it('the IMEI index does too', () => {
    expect(OFFLINE_IMEI_INDEX_MESSAGE).toMatch(/offline/i);
    expect(OFFLINE_IMEI_INDEX_MESSAGE).toMatch(/reconnect/i);
  });

  it('neither message is a raw Firebase error', () => {
    for (const m of [OFFLINE_SKU_MESSAGE, OFFLINE_IMEI_INDEX_MESSAGE]) {
      expect(m).not.toMatch(/FIRESTORE|INTERNAL ASSERTION|code=|firebase/i);
    }
  });

  it('neither promises a retry that would produce a duplicate', () => {
    // Inventing a provisional SKU to reconcile later would trade one clear
    // failure for a silent duplicate somebody has to hunt down. Nothing in
    // either sentence suggests the app will sort it out by itself.
    for (const m of [OFFLINE_SKU_MESSAGE, OFFLINE_IMEI_INDEX_MESSAGE]) {
      expect(m).not.toMatch(/queued|will sync|automatically|try again later/i);
    }
  });

  it('carries the message through OfflineError, so a caller can show it verbatim', () => {
    const e = new OfflineError(OFFLINE_SKU_MESSAGE);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('OfflineError');
    expect(e.message).toBe(OFFLINE_SKU_MESSAGE);
  });

  it('still has its generic default for every other caller', () => {
    expect(new OfflineError().message).toMatch(/internet connection/i);
  });
});
