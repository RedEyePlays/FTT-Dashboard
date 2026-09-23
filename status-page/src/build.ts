import { LookupError } from './api';
import { BuildLookupResult, PublicBuild, PublicPart, lookupBuild } from './buildApi';

/**
 * THE PUBLIC BUILD LISTING.
 *
 * One link per build, pasted into a Facebook Marketplace post. It is opened on
 * a phone, by somebody who has not decided to buy yet — so the order on the
 * page is the order of their questions: what is it, what does it cost, what
 * would it cost me to build myself, what is in it, what happens if it breaks,
 * who are you.
 *
 * Visually the display card's sibling (services/buildPrint.ts): the same
 * accent bar, the same enormous price, the same spec list. It is a listing,
 * not a form printout.
 */

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const money = (n: number): string =>
  `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A tel: href needs the digits only; the visible text keeps the formatting. */
const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Open Graph tags, so the link previews properly when it is pasted into
 * Marketplace or a text message — which is the entire point of the link.
 * Written into the live document because this page is one static HTML file
 * shared with the repair form; there is no server to render them per build.
 *
 * Crawlers that do not run JavaScript will not see these. That is an accepted
 * limit of keeping one static bundle: the page is noindex anyway, and the
 * scrapers that matter here (Facebook, iMessage, WhatsApp) do execute it.
 */
function setMeta(b: PublicBuild): void {
  const title = `${b.name} — ${b.price != null ? money(b.price) : 'Ask us'}`;
  const specs = b.parts.slice(0, 4).map(p => p.name).join(' · ');
  const value = b.saving != null && b.storeName
    ? ` Same parts new at ${b.storeName}: ${money(b.storeTotal!)} — you save ${money(b.saving)}.`
    : '';
  const description = `${specs}${specs ? '. ' : ''}${b.warrantyDays > 0 ? `${b.warrantyDays}-day warranty from ${b.shopName}.` : `From ${b.shopName}.`}${value}`;

  document.title = title;
  const tags: [string, string][] = [
    ['og:title', title],
    ['og:description', description],
    ['og:type', 'product'],
    ['og:site_name', b.shopName],
    // A link with no picture is a grey box in a Messenger thread. The full
    // image, not the thumbnail — a scraper scales it down itself, and a 400px
    // one scaled UP looks like a scam.
    ['twitter:card', b.photo?.url ? 'summary_large_image' : 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
  ];
  if (b.photo?.url) {
    tags.push(['og:image', b.photo.url], ['twitter:image', b.photo.url]);
  }
  if (b.price != null) {
    tags.push(['product:price:amount', String(b.price)], ['product:price:currency', 'CAD']);
  }
  for (const [property, content] of tags) {
    const attr = property.startsWith('og:') || property.startsWith('product:') ? 'property' : 'name';
    let el = document.head.querySelector(`meta[${attr}="${property}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }
}

/**
 * The machine's photo, and the honesty line beneath a stock one.
 *
 * A REAL photo is labelled nothing — a caption under an actual picture of the
 * actual machine only makes a buyer wonder what the catch is. A stock photo
 * always says so, and carries its credit, because it is a picture of something
 * LIKE the thing for sale.
 */
function renderPhoto(b: PublicBuild): string {
  if (!b.photo?.url) return '';
  const note = b.photo.stock
    ? `<p class="b-photo-note">Stock photo — actual device may vary${b.photo.credit ? ` · ${escapeHtml(b.photo.credit)}` : ''}</p>`
    : '';
  return `
    <figure class="b-photo">
      <img src="${escapeHtml(b.photo.url)}" alt="${escapeHtml(b.name)}" />
      ${note}
    </figure>`;
}

function renderPart(p: PublicPart): string {
  // The price line: what it costs new, and at the named store when that is
  // different. Never a cost — the server has no field for one.
  const prices: string[] = [];
  if (p.storePrice != null && p.storeName) {
    prices.push(`${money(p.storePrice)} at ${escapeHtml(p.storeName)}`);
  } else if (p.newPrice != null) {
    prices.push(`${money(p.newPrice)} new`);
  }
  return `
    <li class="b-part">
      <div class="b-part-main">
        <span class="b-part-cat">${escapeHtml(p.category)}</span>
        <span class="b-part-name">${escapeHtml(p.name)}</span>
      </div>
      <div class="b-part-meta">
        <span class="b-cond${p.condition === 'New' ? ' b-cond-new' : ''}">${escapeHtml(p.condition)}</span>
        ${p.warranty ? `<span class="b-warranty">${escapeHtml(p.warranty)}</span>` : ''}
        ${prices.length ? `<span class="b-part-price">${prices.join('')}</span>` : ''}
      </div>
    </li>`;
}

function renderComparison(b: PublicBuild): string {
  // Only when the total behind it is COMPLETE. A total from some of the parts
  // is a different number wearing the same label, and a buyer cannot tell —
  // so a partial one is labelled rather than presented as the whole.
  if (b.storeTotal != null && b.storeName) {
    return `
      <div class="b-compare">
        <p class="b-compare-line">Same parts new at <strong>${escapeHtml(b.storeName)}</strong>: <strong>${money(b.storeTotal)}</strong></p>
        ${b.saving != null ? `<p class="b-save">You save ${money(b.saving)}</p>` : ''}
      </div>`;
  }
  if (b.retailComplete && b.retailTotal != null) {
    return `
      <div class="b-compare">
        <p class="b-compare-line">Same parts new: <strong>${money(b.retailTotal)}</strong></p>
        ${b.saving != null ? `<p class="b-save">You save ${money(b.saving)}</p>` : ''}
      </div>`;
  }
  if (b.retailTotal != null && b.retailTotal > 0) {
    return `
      <div class="b-compare">
        <p class="b-compare-partial">Some parts priced at ${money(b.retailTotal)} new — ask us for the full comparison.</p>
      </div>`;
  }
  return '';
}

function renderBuild(b: PublicBuild): string {
  const sold = b.status === 'Sold';
  const contact: string[] = [];
  if (b.shopPhone) {
    contact.push(`<a class="b-action" href="${escapeHtml(telHref(b.shopPhone))}">Call ${escapeHtml(b.shopPhone)}</a>`);
  }
  if (b.shopEmail) {
    const subject = encodeURIComponent(`Interested in: ${b.name}`);
    contact.push(`<a class="b-action b-action-alt" href="mailto:${escapeHtml(b.shopEmail)}?subject=${subject}">Message us</a>`);
  }

  return `
    <article class="b-card${sold ? ' is-sold' : ''}">
      ${renderPhoto(b)}
      <header class="b-head">
        ${sold ? '<span class="b-sold-flag">Sold</span>' : '<span class="b-avail-flag">Available</span>'}
        <h1 class="b-name">${escapeHtml(b.name)}</h1>
        <p class="b-price">${b.price != null ? money(b.price) : 'Ask us'}</p>
        ${renderComparison(b)}
      </header>

      ${sold ? '<p class="b-sold-note">This one has been sold. The specs are below — we build these to order, so get in touch if you want something similar.</p>' : ''}

      <h2 class="b-section">What’s in it</h2>
      <ul class="b-parts">${b.parts.map(renderPart).join('')}</ul>

      ${b.warrantyDays > 0
        ? `<p class="b-shopwarranty"><strong>${b.warrantyDays}-day warranty</strong> from ${escapeHtml(b.shopName)}</p>`
        : ''}

      <footer class="b-foot">
        <p class="b-shop">${escapeHtml(b.shopName)}</p>
        ${b.shopAddress ? `<p class="b-addr">${escapeHtml(b.shopAddress)}</p>` : ''}
        ${contact.length ? `<div class="b-actions">${contact.join('')}</div>` : ''}
      </footer>
    </article>`;
}

/**
 * Gone. Deliberately identical for a token that never existed, one that was
 * revoked, and one whose sold grace period has run out — nobody should be able
 * to tell those apart by looking.
 */
const NOT_FOUND = `
  <article class="b-card b-missing">
    <h1 class="b-name">No longer available</h1>
    <p class="b-missing-note">This listing has been taken down or has expired. If you were sent this link, get in touch with the shop and we’ll tell you what we have.</p>
  </article>`;

const LOADING = '<article class="b-card b-loading"><p>Loading…</p></article>';

const problem = (message: string): string => `
  <article class="b-card b-missing">
    <h1 class="b-name">Can’t load this right now</h1>
    <p class="b-missing-note">${escapeHtml(message)}</p>
  </article>`;

/** Render the build page for a token into the given element. */
export async function renderBuildPage(app: HTMLElement, token: string): Promise<void> {
  app.className = 'build-page';
  app.innerHTML = LOADING;

  let result: BuildLookupResult;
  try {
    result = await lookupBuild(token);
  } catch (err) {
    const message = err instanceof LookupError && (err.code === 'unavailable' || err.code === 'resource-exhausted')
      ? err.message
      : 'Something went wrong. Please try again in a moment.';
    app.innerHTML = problem(message);
    return;
  }

  if (!result.found) {
    app.innerHTML = NOT_FOUND;
    return;
  }

  setMeta(result);
  app.innerHTML = renderBuild(result);
}
