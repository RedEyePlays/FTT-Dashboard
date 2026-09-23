// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBuildPage } from './build';
import { PublicBuild } from './buildApi';

/**
 * THE PUBLIC LISTING, RENDERED.
 *
 * functions/src/publicBuildPolicy.test.ts proves the server never SENDS a
 * cost, a serial or a customer. This is the other half: that the page shows
 * what it is given, degrades honestly when the comparison is incomplete, and
 * has nowhere to put a private field even if one arrived.
 */

const BUILD: PublicBuild = {
  found: true,
  name: 'Starter Gaming PC',
  status: 'Available',
  price: 1200,
  retailTotal: 1380,
  retailComplete: true,
  storeTotal: 1510,
  storeName: 'Canada Computers',
  saving: 310,
  warrantyDays: 90,
  shopName: 'FlipThatTech',
  shopPhone: '416-555-0100',
  shopAddress: '12 Main St, Toronto',
  shopEmail: 'hello@flipthat.tech',
  parts: [
    { category: 'CPU', name: 'Ryzen 7 7800X3D', condition: 'New', newPrice: 480, storePrice: 510, storeName: 'Canada Computers', warranty: '3 years of maker warranty left' },
    { category: 'GPU', name: 'RTX 4070 Windforce', condition: 'Used — tested', newPrice: 900, storePrice: 1000, storeName: 'Canada Computers' },
  ],
};

let app: HTMLElement;

const mockLookup = (result: unknown) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result }),
  }));
};

const TOKEN = 'b7k2m9qrstvwxyz34567bcdfgh';
const render = async (result: unknown) => {
  mockLookup(result);
  await renderBuildPage(app, TOKEN);
  return app.textContent || '';
};

beforeEach(() => {
  app = document.createElement('div');
  document.body.appendChild(app);
  document.head.querySelectorAll('meta[property], meta[name="twitter:card"]').forEach(m => m.remove());
});
afterEach(() => {
  app.remove();
  vi.unstubAllGlobals();
});

describe('an available build', () => {
  it('leads with the name and the price', async () => {
    const text = await render(BUILD);
    expect(text).toContain('Starter Gaming PC');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('Available');
  });

  it('shows the comparison and the saving', async () => {
    const text = await render(BUILD);
    expect(text).toContain('Same parts new at');
    expect(text).toContain('Canada Computers');
    expect(text).toContain('$1,510.00');
    expect(text).toContain('You save $310.00');
  });

  it('lists every part with its condition and remaining maker warranty', async () => {
    const text = await render(BUILD);
    expect(text).toContain('Ryzen 7 7800X3D');
    expect(text).toContain('RTX 4070 Windforce');
    expect(text).toContain('New');
    expect(text).toContain('Used — tested');
    expect(text).toContain('3 years of maker warranty left');
  });

  it('shows the shop, its warranty, and a way to get in touch', async () => {
    const text = await render(BUILD);
    expect(text).toContain('90-day warranty');
    expect(text).toContain('FlipThatTech');
    expect(text).toContain('12 Main St, Toronto');
    expect(app.querySelector('a[href^="tel:"]')?.getAttribute('href')).toBe('tel:4165550100');
    expect(app.querySelector('a[href^="mailto:"]')).toBeTruthy();
  });
});

describe('a partial comparison is LABELLED, never presented as the whole', () => {
  it('says so, and claims no saving from it', async () => {
    const text = await render({
      ...BUILD,
      retailComplete: false, retailTotal: 480, storeTotal: undefined,
      storeName: undefined, saving: undefined,
    });
    expect(text).toContain('Some parts priced at $480.00 new');
    expect(text).toContain('ask us for the full comparison');
    expect(text).not.toContain('You save');
  });

  it('falls back to the plain retail line when no store is named', async () => {
    const text = await render({ ...BUILD, storeTotal: undefined, storeName: undefined });
    expect(text).toContain('Same parts new:');
    expect(text).toContain('$1,380.00');
  });

  it('shows no comparison block at all when nothing is priced', async () => {
    const text = await render({
      ...BUILD, retailComplete: false, retailTotal: undefined,
      storeTotal: undefined, storeName: undefined, saving: undefined,
      parts: [{ category: 'CPU', name: 'Ryzen 7', condition: 'New' }],
    });
    expect(text).not.toContain('Same parts new');
    expect(text).not.toContain('ask us for the full comparison');
    expect(text).toContain('Ryzen 7');      // the listing still works
  });
});

describe('a SOLD build', () => {
  it('says so clearly and KEEPS THE SPECS VISIBLE', async () => {
    const text = await render({ ...BUILD, status: 'Sold' });
    expect(text).toContain('Sold');
    expect(text).toContain('This one has been sold');
    // The specs are the reason somebody still clicks — we build these to order.
    expect(text).toContain('Ryzen 7 7800X3D');
    expect(text).toContain('RTX 4070 Windforce');
    expect(app.querySelector('.b-card.is-sold')).toBeTruthy();
  });
});

describe('a link that no longer resolves', () => {
  it('says "No longer available" rather than showing a dead page', async () => {
    const text = await render({ found: false });
    expect(text).toContain('No longer available');
  });

  it('says the SAME thing for a revoked token as for one that never existed', async () => {
    // Nobody should be able to tell those apart by looking.
    const revoked = await render({ found: false });
    app.innerHTML = '';
    const never = await render({ found: false });
    expect(revoked).toBe(never);
  });

  it('a server failure reads as a failure, not as "sold"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await renderBuildPage(app, TOKEN);
    expect(app.textContent).toContain('Can’t load this right now');
    expect(app.textContent).not.toContain('No longer available');
  });
});

describe('the link previews when pasted', () => {
  it('sets Open Graph title, description and price', async () => {
    await render(BUILD);
    const og = (p: string) => document.head.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
    expect(og('og:title')).toBe('Starter Gaming PC — $1,200.00');
    expect(og('og:description')).toContain('Ryzen 7 7800X3D');
    expect(og('og:description')).toContain('90-day warranty from FlipThatTech');
    expect(og('og:description')).toContain('you save $310.00');
    expect(og('product:price:amount')).toBe('1200');
    expect(og('product:price:currency')).toBe('CAD');
    expect(document.title).toBe('Starter Gaming PC — $1,200.00');
  });

  it('NEVER puts a private figure in the preview either', async () => {
    await render(BUILD);
    const description = document.head.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
    for (const word of ['cost', 'labour', 'margin', 'profit']) {
      expect({ word, found: description.toLowerCase().includes(word) }).toEqual({ word, found: false });
    }
  });
});

describe('escaping', () => {
  it('a build name with markup in it is text, not markup', async () => {
    await render({ ...BUILD, name: '<img src=x onerror=alert(1)>' });
    expect(app.querySelector('img')).toBeNull();
    expect(app.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
