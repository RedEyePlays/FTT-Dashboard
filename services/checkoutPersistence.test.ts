// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { saveCheckoutState, loadCheckoutState, clearCheckoutState } from './checkoutPersistence';
import { PersistedCheckoutState, CHECKOUT_PERSIST_TTL_MS } from '../domain/checkoutPersistence';

const state = (p: Partial<PersistedCheckoutState> = {}): PersistedCheckoutState => ({
  savedAt: Date.now(), cart: [], customerName: '', customerPhone: '', customerEmail: '', customerNotes: '',
  paymentMethod: 'cash', cashTaxStatus: 'none', etransferTaxStatus: 'none', paymentNotes: '',
  cashAmount: '', cardAmount: '', etransferAmount: '', taxCollected: '', deposit: '',
  platformName: 'None / In-Store', platformFeePercent: '0',
  ...p,
});

beforeEach(() => { sessionStorage.clear(); });

describe('checkoutPersistence storage round-trip', () => {
  it('save then load returns the same data', () => {
    const key = 'k1';
    const s = state({ customerName: 'Jane' });
    saveCheckoutState(key, s);
    expect(loadCheckoutState(key, s.savedAt)).toEqual(s);
  });

  it('loading a key that was never saved returns null', () => {
    expect(loadCheckoutState('never-saved', Date.now())).toBeNull();
  });

  it('clear removes the saved state', () => {
    const key = 'k1';
    saveCheckoutState(key, state());
    clearCheckoutState(key);
    expect(loadCheckoutState(key, Date.now())).toBeNull();
  });

  it('an expired save is not restored, and is actively cleared', () => {
    const key = 'k1';
    const s = state({ savedAt: 1_000_000 });
    saveCheckoutState(key, s);
    const now = s.savedAt + CHECKOUT_PERSIST_TTL_MS + 1;
    expect(loadCheckoutState(key, now)).toBeNull();
    // The stale entry was actually removed, not just skipped this one read.
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('a save under one key is invisible under a different key (the user/workspace-scoping mechanism)', () => {
    saveCheckoutState('user-a', state({ customerName: 'A' }));
    expect(loadCheckoutState('user-b', Date.now())).toBeNull();
  });

  it('malformed JSON in storage is treated as no saved state, not a crash', () => {
    sessionStorage.setItem('bad', '{not json');
    expect(loadCheckoutState('bad', Date.now())).toBeNull();
  });

  it('a value with no savedAt is treated as no saved state', () => {
    sessionStorage.setItem('bad2', JSON.stringify({ cart: [] }));
    expect(loadCheckoutState('bad2', Date.now())).toBeNull();
  });
});
