import { RepairPrice, TradeInRange } from './settings';

/**
 * THE COUNTER KIOSK — the owner-facing half.
 *
 * The public half lives in functions/src/showroomPolicy.ts (what the tablet is
 * allowed to be told) and status-page/src/showroom.ts (how it looks). This
 * module is everything the SHOP side needs: the link to put on the tablet, and
 * the repair price list read off at the counter while quoting somebody.
 *
 * Pure on purpose — no React, no Firebase — so every branch below is testable
 * without a browser.
 */

/** The kiosk lives on the public status-page origin, never on the app's own. */
export const kioskUrl = (origin: string, token: string): string =>
  `${origin.replace(/\/+$/, '')}/showroom/${token}`;

/** The token in `/showroom/<token>`, matching the page's router. */
export const KIOSK_PATH_PREFIX = '/showroom';

/* ---------------------------- Repair prices ---------------------------- */

/** Money as it is read aloud. "from $189" where the price is a starting point. */
export const repairPriceLabel = (p: Pick<RepairPrice, 'price' | 'fromPrice'>): string =>
  `${p.fromPrice ? 'from ' : ''}$${(p.price || 0).toFixed(2)}`;

/** Only rows the owner has switched on, and only rows that say something. */
export const activeRepairPrices = (list?: RepairPrice[]): RepairPrice[] =>
  (list || []).filter(p => p.active !== false && !!(p.deviceModel || '').trim() && !!(p.repairType || '').trim());

export interface RepairPriceGroup {
  deviceModel: string;
  rows: RepairPrice[];
}

/**
 * Grouped by device, because that is the question a customer asks: "how much
 * for an iPhone 13?" — not "how much for a screen?". First-seen order is kept,
 * so the owner's own ordering in Settings is what staff and customers read.
 */
export function groupRepairPrices(list?: RepairPrice[]): RepairPriceGroup[] {
  const out: RepairPriceGroup[] = [];
  for (const row of activeRepairPrices(list)) {
    const model = row.deviceModel.trim();
    const found = out.find(g => g.deviceModel.toLowerCase() === model.toLowerCase());
    if (found) found.rows.push(row);
    else out.push({ deviceModel: model, rows: [row] });
  }
  return out;
}

/** The counter search box: matches model, repair type, or both together. */
export function searchRepairPrices(list: RepairPrice[] | undefined, query: string): RepairPrice[] {
  const q = (query || '').trim().toLowerCase();
  const rows = activeRepairPrices(list);
  if (!q) return rows;
  const terms = q.split(/\s+/);
  return rows.filter(r => {
    const hay = `${r.deviceModel} ${r.repairType}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/* ---------------------------- Trade-in ranges ---------------------------- */

/** Distinct models the shop has priced, first-seen order. */
export function tradeInModels(list?: TradeInRange[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of list || []) {
    if (r.active === false) continue;
    const model = (r.deviceModel || '').trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

/** The conditions priced for one model. */
export function tradeInConditions(list: TradeInRange[] | undefined, model: string): string[] {
  const m = (model || '').trim().toLowerCase();
  const out: string[] = [];
  for (const r of list || []) {
    if (r.active === false) continue;
    if ((r.deviceModel || '').trim().toLowerCase() !== m) continue;
    const c = (r.condition || '').trim();
    if (c && !out.some(x => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

/**
 * Suggested condition wording for the trade-in list — offered, never enforced,
 * because a shop's own words are usually better than ours. These are written
 * as a CUSTOMER would describe their own phone, not as a grade code: nobody
 * walks in and says their phone is a B2.
 */
export const TRADE_IN_CONDITIONS = [
  'Like new — no marks',
  'Good — light scratches',
  'Fair — visible wear',
  'Cracked screen',
  'Not powering on',
] as const;

export interface TradeInQuote {
  lowPrice: number;
  highPrice: number;
}

/**
 * Model + condition → a RANGE, never a firm number.
 *
 * A reversed range (someone typed the high into the low box) is put back the
 * right way round rather than shown as "$220–$180": the customer reads the
 * screen, not the typo. A missing pairing returns null, and the kiosk says it
 * needs a look rather than inventing a number.
 */
export function lookupTradeIn(list: TradeInRange[] | undefined, model: string, condition: string): TradeInQuote | null {
  const m = (model || '').trim().toLowerCase();
  const c = (condition || '').trim().toLowerCase();
  const row = (list || []).find(r =>
    r.active !== false
    && (r.deviceModel || '').trim().toLowerCase() === m
    && (r.condition || '').trim().toLowerCase() === c);
  if (!row) return null;
  const low = Number(row.lowPrice), high = Number(row.highPrice);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < 0) return null;
  return { lowPrice: Math.min(low, high), highPrice: Math.max(low, high) };
}

/**
 * The words beside every quote. Not a disclaimer in small print: the shop is
 * saying out loud that the tablet has not seen the phone.
 */
export const TRADE_IN_CAVEAT =
  'This is an estimate. The final offer depends on an in-person inspection — battery health, screen condition and past repairs all move it.';
