import { describe, it, expect } from 'vitest';
import { invPath, parseInvPath, DEFAULT_INV_SECTION } from './inventoryNav';

describe('invPath', () => {
  it('maps sections to clean routes', () => {
    expect(invPath('phones')).toBe('/inventory/phones');
    expect(invPath('laptops')).toBe('/inventory/laptops');
    expect(invPath('other')).toBe('/inventory/other');
    expect(invPath('accessories')).toBe('/inventory/accessories');
    expect(invPath('sold')).toBe('/inventory/sold');
    expect(invPath('lowstock')).toBe('/inventory/low-stock');
  });
});

describe('parseInvPath', () => {
  it('parses each section slug', () => {
    expect(parseInvPath('/inventory/phones')).toBe('phones');
    expect(parseInvPath('/inventory/laptops')).toBe('laptops');
    expect(parseInvPath('/inventory/other')).toBe('other');
    expect(parseInvPath('/inventory/accessories')).toBe('accessories');
    expect(parseInvPath('/inventory/sold')).toBe('sold');
    expect(parseInvPath('/inventory/low-stock')).toBe('lowstock');
  });

  it('redirects bare /inventory to the default section', () => {
    expect(parseInvPath('/inventory')).toBe(DEFAULT_INV_SECTION);
    expect(parseInvPath('/inventory/')).toBe(DEFAULT_INV_SECTION);
  });

  it('falls back to the default for unknown sub-paths', () => {
    expect(parseInvPath('/inventory/widgets')).toBe(DEFAULT_INV_SECTION);
  });

  it('STILL RESOLVES /inventory/devices — the old main inventory page', () => {
    // It was the inventory URL for the whole life of the app, so it is in
    // links, bookmarks and browser history. It now means Phones rather than
    // 404-ing or landing somewhere arbitrary.
    expect(parseInvPath('/inventory/devices')).toBe('phones');
  });

  it('returns null for non-inventory paths', () => {
    expect(parseInvPath('/')).toBeNull();
    expect(parseInvPath('/dashboard')).toBeNull();
    expect(parseInvPath('/inventoryx')).toBeNull();
  });

  it('round-trips path → section → path', () => {
    for (const s of ['phones', 'laptops', 'other', 'accessories', 'sold', 'lowstock'] as const) {
      expect(parseInvPath(invPath(s))).toBe(s);
    }
  });
});
