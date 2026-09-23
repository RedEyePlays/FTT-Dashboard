import { LookupError } from './api';
import {
  Showroom, ShowroomItem, ShowroomRepair, lookupShowroom,
} from './showroomApi';

/**
 * THE COUNTER KIOSK.
 *
 * A tablet a customer picks up while they wait: what is for sale, what a
 * repair costs, and what the shop pays for a trade-in. No login on the device
 * and nothing internal reachable from it — the token in the URL identifies the
 * workspace, and everything shown is built from an allow-list server-side
 * (functions/src/showroomPolicy.ts).
 *
 * Three things drive the design, all of them from the tablet being UNATTENDED:
 *   • It must recover by itself. Idle → attract mode → home, so the next
 *     customer never finds somebody else's half-finished browse.
 *   • It must not blank on a wifi blip. A failed poll keeps the last data and
 *     says quietly when it was from.
 *   • It must never show a stock count, a cost, or anything a shop would not
 *     print on a card in the window.
 */

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const money = (n: number): string =>
  `$${n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const money2 = (n: number): string =>
  `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Idle timings. Long enough not to snatch the screen from a slow reader. */
export const ATTRACT_AFTER_MS = 60_000;
export const DETAIL_HOME_AFTER_MS = 90_000;
const ATTRACT_SLIDE_MS = 6_000;
const POLL_MS = 120_000;

type View =
  | { name: 'home' }
  | { name: 'item'; sku: string }
  | { name: 'repairs' }
  | { name: 'tradein'; model?: string; condition?: string }
  | { name: 'attract'; index: number };

interface State {
  data: Showroom | null;
  /** When the data we are showing was actually fetched. */
  loadedAt: number;
  stale: boolean;
  error: string | null;
  view: View;
  sort: 'price-asc' | 'price-desc';
  maxPrice: number | null;
}

const CATEGORY_ORDER = ['Phones', 'Laptops', 'Gaming PCs', 'Tablets'];

/* ---------------- Rendering ---------------- */

const photoOf = (item: ShowroomItem, big = false): string => {
  const src = big ? (item.photo?.url || item.photo?.thumbUrl) : (item.photo?.thumbUrl || item.photo?.url);
  if (!src) {
    // An item with no photo still appears — the outline placeholder, never a
    // gap that makes the shelf look broken.
    return '<div class="k-photo k-photo-none" aria-hidden="true">▢</div>';
  }
  return `<div class="k-photo"><img src="${escapeHtml(src)}" alt="" loading="lazy" /></div>`;
};

const stockNote = (item: ShowroomItem): string =>
  item.photo?.stock
    ? `<p class="k-stock-note">Stock photo — actual device may vary${item.photo.credit ? ` · ${escapeHtml(item.photo.credit)}` : ''}</p>`
    : '';

const card = (item: ShowroomItem): string => `
  <button class="k-card" data-sku="${escapeHtml(item.sku)}">
    ${photoOf(item)}
    <div class="k-card-body">
      <p class="k-card-title">${escapeHtml(item.title)}</p>
      <p class="k-card-sub">${[item.storage, item.colour].filter((v): v is string => !!v).map(escapeHtml).join(' · ')}</p>
      <p class="k-card-price">${money(item.price)}</p>
    </div>
  </button>`;

function renderHome(s: State): string {
  const d = s.data!;
  const items = visibleItems(s);
  const groups = CATEGORY_ORDER
    .map(category => ({ category, items: items.filter(i => i.category === category) }))
    .filter(g => g.items.length > 0);

  const prices = d.items.map(i => i.price);
  const ceiling = prices.length ? Math.max(...prices) : 0;

  return `
    <header class="k-head">
      <h1 class="k-shop">${escapeHtml(d.shopName)}</h1>
      <nav class="k-tabs">
        <button class="k-tab is-on" data-go="home">In stock</button>
        ${d.repairs.length ? '<button class="k-tab" data-go="repairs">Repair prices</button>' : ''}
        ${d.tradeIns.length ? '<button class="k-tab" data-go="tradein">Sell us yours</button>' : ''}
      </nav>
    </header>

    <div class="k-controls">
      <button class="k-chip${s.sort === 'price-asc' ? ' is-on' : ''}" data-sort="price-asc">Price: low to high</button>
      <button class="k-chip${s.sort === 'price-desc' ? ' is-on' : ''}" data-sort="price-desc">Price: high to low</button>
      ${ceiling > 0 ? `
        <label class="k-filter">
          Under <strong id="k-max-label">${s.maxPrice ? money(s.maxPrice) : 'any price'}</strong>
          <input id="k-max" type="range" min="0" max="${Math.ceil(ceiling)}" step="50"
            value="${s.maxPrice ?? Math.ceil(ceiling)}" />
        </label>` : ''}
    </div>

    ${groups.length === 0
      ? '<p class="k-empty">Nothing matching that right now — ask us what else we have.</p>'
      : groups.map(g => `
        <section class="k-section">
          <h2 class="k-section-title">${escapeHtml(g.category)}</h2>
          <div class="k-grid">${g.items.map(card).join('')}</div>
        </section>`).join('')}

    ${footer(s)}`;
}

function renderItem(s: State, sku: string): string {
  const item = s.data!.items.find(i => i.sku === sku);
  if (!item) return renderHome(s);
  const compare = item.compareTotal != null ? `
    <p class="k-compare">
      Same parts new${item.compareStore ? ` at ${escapeHtml(item.compareStore)}` : ''}:
      <strong>${money2(item.compareTotal)}</strong>
      ${item.saving != null ? `<span class="k-save">You save ${money2(item.saving)}</span>` : ''}
    </p>` : '';

  const rows: [string, string | undefined][] = [
    ['Condition', item.condition],
    ['Storage', item.storage],
    ['Colour', item.colour],
    ['Battery health', item.batteryHealth],
    ['Specs', item.specs],
  ];

  return `
    <header class="k-head">
      <button class="k-back" data-go="home">← Back</button>
      <h1 class="k-shop">${escapeHtml(s.data!.shopName)}</h1>
    </header>

    <article class="k-detail">
      ${photoOf(item, true)}
      ${stockNote(item)}
      <h2 class="k-detail-title">${escapeHtml(item.title)}</h2>
      <p class="k-detail-price">${money(item.price)}</p>
      ${compare}
      <dl class="k-specs">
        ${rows.filter(([, v]) => v).map(([k, v]) => `
          <div class="k-spec"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v!)}</dd></div>`).join('')}
      </dl>
      ${item.warrantyDays > 0 ? `<p class="k-warranty">${item.warrantyDays}-day warranty from ${escapeHtml(s.data!.shopName)}</p>` : ''}
      <!-- The SKU is how a customer points at something without describing it. -->
      <p class="k-ask">Ask us about <strong>${escapeHtml(item.sku || 'this one')}</strong></p>
    </article>

    ${footer(s)}`;
}

function repairRow(r: ShowroomRepair): string {
  return `
    <div class="k-row">
      <div class="k-row-main">
        <span class="k-row-title">${escapeHtml(r.repairType)}</span>
        ${r.turnaround ? `<span class="k-row-sub">${escapeHtml(r.turnaround)}</span>` : ''}
      </div>
      <span class="k-row-price">${r.fromPrice ? 'from ' : ''}${money(r.price)}</span>
    </div>`;
}

function renderRepairs(s: State): string {
  const d = s.data!;
  const models = [...new Set(d.repairs.map(r => r.deviceModel))];
  return `
    <header class="k-head">
      <button class="k-back" data-go="home">← Back</button>
      <h1 class="k-shop">Repair prices</h1>
    </header>
    ${models.map(model => `
      <section class="k-section">
        <h2 class="k-section-title">${escapeHtml(model)}</h2>
        <div class="k-rows">${d.repairs.filter(r => r.deviceModel === model).map(repairRow).join('')}</div>
      </section>`).join('')}
    ${d.repairWarrantyDays > 0
      ? `<p class="k-warranty">Our repairs are covered for ${d.repairWarrantyDays} days.</p>` : ''}
    <p class="k-caveat">Prices marked “from” are a starting point — an unusual job may cost more. Ask us and we’ll check.</p>
    ${footer(s)}`;
}

function renderTradeIn(s: State): string {
  const d = s.data!;
  const models = [...new Set(d.tradeIns.map(t => t.deviceModel))];
  const { model, condition } = s.view as { model?: string; condition?: string };

  // Step 1: model.
  if (!model) {
    return `
      <header class="k-head">
        <button class="k-back" data-go="home">← Back</button>
        <h1 class="k-shop">Sell us yours</h1>
      </header>
      <p class="k-lead">Pick your device.</p>
      <div class="k-pick">${models.map(m =>
        `<button class="k-pick-btn" data-model="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')}</div>
      ${tradeCaveat()}
      ${footer(s)}`;
  }

  const forModel = d.tradeIns.filter(t => t.deviceModel === model);

  // Step 2: condition.
  if (!condition) {
    return `
      <header class="k-head">
        <button class="k-back" data-go="tradein">← Back</button>
        <h1 class="k-shop">${escapeHtml(model)}</h1>
      </header>
      <p class="k-lead">What sort of shape is it in?</p>
      <div class="k-pick">${forModel.map(t =>
        `<button class="k-pick-btn" data-condition="${escapeHtml(t.condition)}">${escapeHtml(t.condition)}</button>`).join('')}</div>
      ${tradeCaveat()}
      ${footer(s)}`;
  }

  // Step 3: the RANGE — never a firm number.
  const match = forModel.find(t => t.condition === condition);
  return `
    <header class="k-head">
      <button class="k-back" data-go="tradein">← Start again</button>
      <h1 class="k-shop">${escapeHtml(model)}</h1>
    </header>
    <article class="k-quote">
      <p class="k-quote-what">${escapeHtml(model)} · ${escapeHtml(condition)}</p>
      ${match
        ? `<p class="k-quote-range">${money(match.lowPrice)}–${money(match.highPrice)}</p>`
        : '<p class="k-quote-range">Ask us</p>'}
      <p class="k-quote-note">See us at the counter for a final offer.</p>
    </article>
    ${tradeCaveat()}
    ${footer(s)}`;
}

/**
 * UNMISSABLE, because it has to be. Battery health, a swollen battery and a
 * past repair all move the number and none of them can be seen from a tablet.
 * The screen must not be quotable against the shop.
 */
const tradeCaveat = (): string => `
  <p class="k-caveat k-caveat-loud">
    This is an estimate, not an offer. Every device is inspected at the counter —
    battery health, past repairs and any damage change the price.
  </p>`;

function renderAttract(s: State, index: number): string {
  const items = s.data!.items;
  const item = items[index % Math.max(1, items.length)];
  if (!item) return renderHome(s);
  return `
    <div class="k-attract">
      ${photoOf(item, true)}
      <h2 class="k-attract-title">${escapeHtml(item.title)}</h2>
      <p class="k-attract-price">${money(item.price)}</p>
      ${item.condition ? `<p class="k-attract-sub">${escapeHtml(item.condition)}</p>` : ''}
      <p class="k-attract-hint">Touch to browse</p>
    </div>`;
}

/**
 * The footer carries the honest bit: when this was last refreshed. A shop wifi
 * blip must not blank the screen, so the last data stays up — but silently
 * showing a sold device as available is the failure this line prevents.
 */
function footer(s: State): string {
  const minutes = Math.round((Date.now() - s.loadedAt) / 60000);
  const when = !s.loadedAt ? '' : minutes < 2 ? 'just now' : `${minutes} min ago`;
  return `<p class="k-foot">${s.stale ? '⚠ Showing the last update · ' : ''}${when ? `Updated ${when}` : ''}</p>`;
}

/* ---------------- Filtering ---------------- */

function visibleItems(s: State): ShowroomItem[] {
  const items = s.data!.items.filter(i => s.maxPrice == null || i.price <= s.maxPrice);
  const dir = s.sort === 'price-desc' ? -1 : 1;
  return [...items].sort((a, b) => (a.price - b.price) * dir || a.title.localeCompare(b.title));
}

/* ---------------- The app ---------------- */

export function mountShowroom(app: HTMLElement, token: string): () => void {
  app.className = 'showroom';

  const state: State = {
    data: null, loadedAt: 0, stale: false, error: null,
    view: { name: 'home' }, sort: 'price-asc', maxPrice: null,
  };

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let attractTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const render = () => {
    if (stopped) return;
    if (!state.data) {
      app.innerHTML = state.error
        ? `<div class="k-msg"><p>${escapeHtml(state.error)}</p></div>`
        : '<div class="k-msg"><p>Loading…</p></div>';
      return;
    }
    switch (state.view.name) {
      case 'attract': app.innerHTML = renderAttract(state, state.view.index); break;
      case 'item': app.innerHTML = renderItem(state, state.view.sku); break;
      case 'repairs': app.innerHTML = renderRepairs(state); break;
      case 'tradein': app.innerHTML = renderTradeIn(state); break;
      default: app.innerHTML = renderHome(state);
    }
  };

  const goHome = () => {
    // Clearing the filter matters: the next customer must not inherit
    // somebody else's "under $300".
    state.view = { name: 'home' };
    state.maxPrice = null;
    state.sort = 'price-asc';
    render();
  };

  const stopAttract = () => {
    if (attractTimer) { clearInterval(attractTimer); attractTimer = null; }
  };

  const startAttract = () => {
    if (!state.data?.items.length || state.view.name === 'attract') return;
    state.view = { name: 'attract', index: 0 };
    render();
    stopAttract();
    attractTimer = setInterval(() => {
      if (state.view.name !== 'attract') return;
      state.view = { name: 'attract', index: state.view.index + 1 };
      render();
    }, ATTRACT_SLIDE_MS);
  };

  /**
   * Any touch resets the clock. Inside a detail page the shorter timer wins,
   * so the tablet returns to Home before it starts the slideshow — a customer
   * walking away from a product page leaves it on somebody else's choice.
   */
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const inDetail = state.view.name === 'item' || state.view.name === 'tradein' || state.view.name === 'repairs';
    idleTimer = setTimeout(() => {
      if (inDetail) { goHome(); resetIdle(); return; }
      startAttract();
    }, inDetail ? DETAIL_HOME_AFTER_MS : ATTRACT_AFTER_MS);
  };

  const load = async (initial: boolean) => {
    try {
      const result = await lookupShowroom(token);
      if (stopped) return;
      if (!result.found) {
        state.data = null;
        state.error = 'This screen is not set up. Ask a staff member.';
      } else {
        state.data = result;
        state.loadedAt = Date.now();
        state.stale = false;
        state.error = null;
      }
    } catch (e) {
      // A wifi blip must NOT blank the screen. Keep what we have and say so.
      if (state.data) state.stale = true;
      else state.error = e instanceof LookupError ? e.message : 'Could not load. Trying again shortly.';
    }
    if (initial || state.view.name !== 'attract') render();
  };

  const onPointer = (e: Event) => {
    resetIdle();
    if (state.view.name === 'attract') {
      stopAttract();
      goHome();
      e.preventDefault();
      return;
    }
    const el = (e.target as HTMLElement)?.closest('[data-sku],[data-go],[data-sort],[data-model],[data-condition]') as HTMLElement | null;
    if (!el) return;

    if (el.dataset.sku) { state.view = { name: 'item', sku: el.dataset.sku }; render(); return; }
    if (el.dataset.sort) { state.sort = el.dataset.sort as State['sort']; render(); return; }
    if (el.dataset.model) { state.view = { name: 'tradein', model: el.dataset.model }; render(); return; }
    if (el.dataset.condition && state.view.name === 'tradein') {
      state.view = { name: 'tradein', model: state.view.model, condition: el.dataset.condition };
      render();
      return;
    }
    const go = el.dataset.go;
    if (go === 'home') { goHome(); return; }
    if (go === 'repairs') { state.view = { name: 'repairs' }; render(); return; }
    if (go === 'tradein') { state.view = { name: 'tradein' }; render(); return; }
  };

  const onInput = (e: Event) => {
    resetIdle();
    const el = e.target as HTMLInputElement;
    if (el?.id !== 'k-max') return;
    const value = Number(el.value);
    const ceiling = Math.max(...(state.data?.items.map(i => i.price) || [0]));
    state.maxPrice = value >= ceiling ? null : value;
    const label = document.getElementById('k-max-label');
    if (label) label.textContent = state.maxPrice ? money(state.maxPrice) : 'any price';
    // Re-render only the grid so the slider does not lose the drag.
    const grids = app.querySelector('.k-section')?.parentElement;
    if (grids) render();
  };

  app.addEventListener('click', onPointer);
  app.addEventListener('touchstart', resetIdle, { passive: true });
  app.addEventListener('input', onInput);

  render();
  void load(true);
  pollTimer = setInterval(() => void load(false), POLL_MS);
  resetIdle();

  return () => {
    stopped = true;
    app.removeEventListener('click', onPointer);
    app.removeEventListener('touchstart', resetIdle);
    app.removeEventListener('input', onInput);
    if (idleTimer) clearTimeout(idleTimer);
    stopAttract();
    if (pollTimer) clearInterval(pollTimer);
  };
}

/** Exported for the tests — the pure parts of the screen. */
export const __test = { visibleItems, footer, renderHome, renderItem, renderTradeIn, renderRepairs };
export type { State as ShowroomState };
