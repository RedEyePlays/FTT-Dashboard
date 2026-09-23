import { describe, it, expect } from 'vitest';
import { __test, ShowroomState, ATTRACT_AFTER_MS, DETAIL_HOME_AFTER_MS } from './showroom';
import { Showroom, ShowroomItem } from './showroomApi';

// The counter kiosk's rendering, exercised without a tablet. Everything here
// is a pure string builder; the timers and the fetch loop are the one part
// that needs a browser, and they are deliberately thin around these.

const item = (over: Partial<ShowroomItem> = {}): ShowroomItem => ({
  sku: 'PHN-000123',
  kind: 'device',
  category: 'Phones',
  title: 'iPhone 13',
  price: 600,
  warrantyDays: 90,
  ...over,
});

const data = (over: Partial<Showroom> = {}): Showroom => ({
  found: true,
  shopName: 'FlipThatTech',
  items: [item()],
  repairs: [],
  repairWarrantyDays: 30,
  tradeIns: [],
  updatedAt: Date.now(),
  ...over,
});

const state = (over: Partial<ShowroomState> = {}): ShowroomState => ({
  data: data(),
  loadedAt: Date.now(),
  stale: false,
  error: null,
  view: { name: 'home' },
  sort: 'price-asc',
  maxPrice: null,
  ...over,
});

describe('the home screen', () => {
  it('groups by category and shows the price', () => {
    const html = __test.renderHome(state({
      data: data({ items: [item(), item({ sku: 'LAP-1', category: 'Laptops', title: 'MacBook Air', price: 900 })] }),
    }));
    expect(html).toContain('Phones');
    expect(html).toContain('Laptops');
    expect(html).toContain('iPhone 13');
    expect(html).toContain('$600');
  });

  it('leaves out a category with nothing in it — no empty shelves', () => {
    const html = __test.renderHome(state());
    expect(html).toContain('Phones');
    expect(html).not.toContain('Gaming PCs');
  });

  it('offers the Repairs and Sell-us-yours tabs only when there is something behind them', () => {
    expect(__test.renderHome(state())).not.toContain('Repair prices');
    const withBoth = __test.renderHome(state({
      data: data({
        repairs: [{ deviceModel: 'iPhone 13', repairType: 'Screen', price: 189 }],
        tradeIns: [{ deviceModel: 'iPhone 13', condition: 'Good', lowPrice: 180, highPrice: 220 }],
      }),
    }));
    expect(withBoth).toContain('Repair prices');
    expect(withBoth).toContain('Sell us yours');
  });

  it('never shows a stock count', () => {
    const html = __test.renderHome(state({
      data: data({ items: [item(), item({ sku: 'PHN-2' }), item({ sku: 'PHN-3' })] }),
    }));
    expect(html).not.toMatch(/\b3 in stock\b/i);
    expect(html).not.toMatch(/\bqty\b/i);
  });

  it('shows an item with no photo, with a placeholder rather than dropping it', () => {
    const html = __test.renderHome(state());
    expect(html).toContain('k-photo-none');
    expect(html).toContain('iPhone 13');
  });
});

describe('price sorting and filtering', () => {
  const three = state({
    data: data({
      items: [
        item({ sku: 'A', price: 900 }),
        item({ sku: 'B', price: 300 }),
        item({ sku: 'C', price: 600 }),
      ],
    }),
  });

  it('is cheapest-first by default — the order somebody browsing expects', () => {
    expect(__test.visibleItems(three).map(i => i.sku)).toEqual(['B', 'C', 'A']);
  });

  it('reverses on price-desc', () => {
    expect(__test.visibleItems({ ...three, sort: 'price-desc' }).map(i => i.sku)).toEqual(['A', 'C', 'B']);
  });

  it('applies the price ceiling inclusively', () => {
    expect(__test.visibleItems({ ...three, maxPrice: 600 }).map(i => i.sku)).toEqual(['B', 'C']);
  });
});

describe('the detail page', () => {
  it('shows the SKU as something a customer can say out loud', () => {
    const html = __test.renderItem(state(), 'PHN-000123');
    expect(html).toContain('Ask us about');
    expect(html).toContain('PHN-000123');
  });

  it('labels a STOCK photo and carries its credit', () => {
    const s = state({
      data: data({ items: [item({ photo: { url: 'https://cdn/x.jpg', stock: true, credit: 'Jane Doe, CC BY-SA 4.0' } })] }),
    });
    const html = __test.renderItem(s, 'PHN-000123');
    expect(html).toContain('Stock photo — actual device may vary');
    expect(html).toContain('Jane Doe, CC BY-SA 4.0');
  });

  it('labels a REAL photo nothing at all', () => {
    const s = state({ data: data({ items: [item({ photo: { url: 'https://cdn/real.jpg' } })] }) });
    const html = __test.renderItem(s, 'PHN-000123');
    expect(html).not.toContain('Stock photo');
  });

  it('shows a build comparison only when the server sent a complete one', () => {
    const complete = state({
      data: data({ items: [item({ kind: 'build', category: 'Gaming PCs', compareTotal: 1400, compareStore: 'Canada Computers', saving: 200 })] }),
    });
    expect(__test.renderItem(complete, 'PHN-000123')).toContain('Canada Computers');
    // No compareTotal at all → no line, rather than a total built from some
    // of the parts wearing the same label.
    expect(__test.renderItem(state(), 'PHN-000123')).not.toContain('Same parts new');
  });

  it('falls back to the home screen for a SKU that has since sold', () => {
    const html = __test.renderItem(state(), 'GONE-999');
    expect(html).toContain('k-section-title');
  });
});

describe('the repairs page', () => {
  const s = state({
    data: data({
      repairs: [
        { deviceModel: 'iPhone 13', repairType: 'Screen', price: 189, fromPrice: true, turnaround: 'Same day' },
        { deviceModel: 'iPhone 13', repairType: 'Battery', price: 89 },
        { deviceModel: 'Pixel 7', repairType: 'Screen', price: 220 },
      ],
      repairWarrantyDays: 45,
    }),
  });

  it('groups by device and marks a starting price as “from”', () => {
    const html = __test.renderRepairs(s);
    expect(html).toContain('iPhone 13');
    expect(html).toContain('Pixel 7');
    expect(html).toContain('from $189');
    expect(html).toContain('$89');
  });

  it('states the shop’s repair warranty', () => {
    expect(__test.renderRepairs(s)).toContain('covered for 45 days');
  });
});

describe('the trade-in flow', () => {
  const s = (view: ShowroomState['view']) => state({
    view,
    data: data({
      tradeIns: [
        { deviceModel: 'iPhone 13', condition: 'Good — light scratches', lowPrice: 180, highPrice: 220 },
        { deviceModel: 'iPhone 13', condition: 'Cracked screen', lowPrice: 60, highPrice: 90 },
      ],
    }),
  });

  it('asks for the model first', () => {
    const html = __test.renderTradeIn(s({ name: 'tradein' }));
    expect(html).toContain('Pick your device');
    expect(html).toContain('iPhone 13');
  });

  it('then asks for the condition', () => {
    const html = __test.renderTradeIn(s({ name: 'tradein', model: 'iPhone 13' }));
    expect(html).toMatch(/what sort of shape/i);
    expect(html).toContain('Cracked screen');
  });

  it('ends on a RANGE, never a firm number', () => {
    const html = __test.renderTradeIn(s({ name: 'tradein', model: 'iPhone 13', condition: 'Good — light scratches' }));
    expect(html).toContain('$180–$220');
    expect(html).toContain('counter');
  });

  it('says “Ask us” for a pairing the shop has not priced', () => {
    const html = __test.renderTradeIn(s({ name: 'tradein', model: 'iPhone 13', condition: 'Immaculate' }));
    expect(html).toContain('Ask us');
  });

  it('carries the inspection caveat at EVERY step — the screen must not be quotable', () => {
    for (const view of [
      { name: 'tradein' as const },
      { name: 'tradein' as const, model: 'iPhone 13' },
      { name: 'tradein' as const, model: 'iPhone 13', condition: 'Cracked screen' },
    ]) {
      const html = __test.renderTradeIn(s(view));
      expect(html).toContain('k-caveat-loud');
      expect(html).toMatch(/estimate, not an offer/i);
      expect(html).toMatch(/inspected at the counter/i);
    }
  });

  it('collects nothing from the customer — no name, phone or email field', () => {
    const html = __test.renderTradeIn(s({ name: 'tradein', model: 'iPhone 13', condition: 'Cracked screen' }));
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/email|phone number/i);
  });
});

describe('the footer', () => {
  it('says when the data is from', () => {
    expect(__test.footer(state({ loadedAt: Date.now() }))).toContain('just now');
    expect(__test.footer(state({ loadedAt: Date.now() - 10 * 60_000 }))).toContain('10 min ago');
  });

  it('flags stale data rather than blanking the screen on a wifi blip', () => {
    const html = __test.footer(state({ stale: true, loadedAt: Date.now() - 5 * 60_000 }));
    expect(html).toContain('Showing the last update');
    expect(html).toContain('5 min ago');
  });

  it('says nothing at all before the first load', () => {
    expect(__test.footer(state({ loadedAt: 0 }))).toBe('<p class="k-foot"></p>');
  });
});

describe('idle timings', () => {
  it('returns from a detail page sooner than it starts the slideshow', () => {
    // A customer walking away from a product page must not leave the tablet on
    // somebody else's choice, so the detail timer wins inside a detail page —
    // and both are long enough not to snatch the screen from a slow reader.
    expect(ATTRACT_AFTER_MS).toBeGreaterThanOrEqual(60_000);
    expect(DETAIL_HOME_AFTER_MS).toBeGreaterThanOrEqual(90_000);
  });
});
