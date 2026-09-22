import {
  SalesTransaction, SalesLine, InventoryItem, RefundSplit, RefundPaidFrom, ItemKind,
} from '../types';
import { kindOf, getDeviceDisplayName } from './inventory';
import { isRecognizedSale } from './reports';
import { impliedRefundSplits } from './pos';
import { clampToBooksStart, booksStartClamps } from './dates';
import { queryWords, matchesWords, SearchableItem } from './itemSearch';

/**
 * EVERY SALE, LINE BY LINE — the report the accountant actually asks for.
 *
 * Reports had Daily History, Cash, Sales Tax, P&L, Expenses, Settlements,
 * Below-Minimum and Year-End. Tax and P&L are TOTALS; the tax tab groups by
 * month or quarter. Nothing listed each sale showing what went out the door,
 * for how much, what it cost, the tax on it and how the customer paid. So the
 * only way to answer "what did we actually sell in March" was to read the
 * transactions by hand.
 *
 * THE THREE REPORTS MUST AGREE. This is the whole reason the totals below are
 * derived the way they are, rather than however would have been convenient:
 *
 *   ledger revenue  ==  profitAndLoss(...).revenue
 *   ledger cost     ==  profitAndLoss(...).costOfGoods
 *   ledger profit   ==  profitAndLoss(...).grossProfit
 *   ledger tax      ==  taxRemittance(...).totalTaxCollected
 *
 * To make the first three true the ledger walks EXACTLY the two populations
 * the P&L walks: recognized transactions, plus standalone sold devices not
 * referenced by any transaction line (an off-POS sale logged straight onto the
 * inventory row). Leaving the second out would have made the ledger quietly
 * smaller than the P&L, which is the kind of discrepancy that costs an evening
 * to find. `isRecognizedSale` is imported, not re-derived.
 *
 * TOTALS COME FROM THE TRANSACTION, NOT THE LINES. A sale's subtotal, cost and
 * tax are stored on the transaction; per-line cost is not stored at all. So the
 * per-line cost shown on screen is an APPORTIONMENT (by the line's share of the
 * sale) and the totals are summed from the transaction fields. Summing the
 * apportioned line costs instead would drift by a cent per sale and put the
 * ledger permanently out with the P&L.
 *
 * VOIDS AND RETURNS ARE NOT REVENUE. They appear as their own negative rows in
 * the month they HAPPENED (voidedAt / returnedAt), never folded into the
 * revenue total — the P&L excludes them entirely, so folding them in is exactly
 * how the two would stop agreeing. The original sale stays in its own month,
 * untouched.
 *
 * Pure: no DOM, no Firestore.
 */

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;
const inRange = (d: string | undefined, lo: string, hi: string): boolean => !!d && d >= lo && d <= hi;
const order = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

/** YYYY-MM-DD from an epoch ms, in LOCAL time (see domain/dates.ts). */
const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------------- Rows ---------------- */

/** What kind of thing this line was, for the filter. */
export type LedgerLineKind = 'device' | 'accessory' | 'service';

export interface LedgerRow {
  /** Stable key: transaction id + line index. */
  key: string;
  saleId: string;
  date: string;
  /** The line's own facts. */
  name: string;
  sku?: string;
  imei?: string;
  lineKind: LedgerLineKind;
  quantity: number;
  /** Sale price for this line AFTER discount — quantity × unit price. */
  revenue: number;
  /** COST FIGURES — owner / allowProfit only. Stripped by trimLedgerRow. */
  purchaseCost?: number;
  repairCost?: number;
  totalCost?: number;
  profit?: number;
  /** This line's share of the sale's platform/channel fee. Owner-facing. */
  channelFee?: number;

  /** True on the FIRST line of each sale — the sale-level columns render here. */
  firstOfSale: boolean;
  customerName?: string;
  soldByEmail?: string;
  /** Sale-level money. Present on every row so a CSV filter can't lose it. */
  sale: LedgerSaleTotals;
  /** A void or a return: this row is negative and labelled. */
  reversal?: LedgerReversal;
}

export interface LedgerSaleTotals {
  /** Tax EXACTLY as recorded on the sale. Never recomputed. 0, never blank. */
  tax: number;
  cash: number;
  card: number;
  etransfer: number;
  storeCredit: number;
  totalPaid: number;
  paymentMethod: string;
  paymentNote?: string;
}

export interface LedgerReversal {
  kind: 'voided' | 'returned';
  /** The day it HAPPENED, which is the month this row belongs to. */
  on: string;
  /** What actually went back to the customer. */
  refundAmount: number;
  /** Where the money came from, itemised. */
  splits: RefundSplit[];
  label: string;
}

const REFUND_SOURCE_LABEL: Record<RefundPaidFrom, string> = {
  store_cash: 'Store cash',
  personal: 'Owner’s own cash',
  card: 'Card',
  etransfer: 'E-Transfer',
  other: 'Other',
};

export const refundSplitLabel = (splits: RefundSplit[]): string =>
  splits.map(s => `${REFUND_SOURCE_LABEL[s.paidFrom] || s.paidFrom} $${Math.abs(s.amount).toFixed(2)}`).join(' + ');

/**
 * Store credit used on a sale.
 *
 * There is no store-credit feature on main yet (it is part of the batch that
 * never landed — see the PR). The column exists and reads 0 so the ledger does
 * not need reshaping when it arrives; the field name is read defensively rather
 * than assumed.
 */
const storeCreditOn = (t: SalesTransaction): number =>
  round2(Number((t as unknown as { storeCreditUsed?: number }).storeCreditUsed) || 0);

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', mixed: 'Mixed', etransfer: 'E-Transfer',
};

/**
 * The money side of one sale.
 *
 * TAX IS READ, NEVER RECOMPUTED. A manually typed tax and the "no tax on the
 * cash half, tax the rest" mode both land in `t.tax` at checkout, and
 * recomputing from subtotal × rate here would silently contradict the receipt
 * the customer was handed. A sale with no tax reads $0.00.
 *
 * The three payment amounts are only itemised on a mixed sale; a single-method
 * sale carries the whole total under its own method, so that is what is
 * reported rather than leaving three blanks and a total.
 */
export const saleTotals = (t: SalesTransaction): LedgerSaleTotals => {
  const total = round2(t.totalPaid);
  const method = t.paymentMethod || 'cash';
  const explicit = {
    cash: round2(t.cashAmount || 0),
    card: round2(t.cardAmount || 0),
    etransfer: round2(t.etransferAmount || 0),
  };
  const itemised = explicit.cash + explicit.card + explicit.etransfer >= 0.005;
  const base = itemised ? explicit : {
    cash: method === 'cash' ? total : 0,
    card: method === 'card' ? total : 0,
    etransfer: method === 'etransfer' ? total : 0,
  };
  return {
    tax: round2(t.tax),
    ...base,
    storeCredit: storeCreditOn(t),
    totalPaid: total,
    paymentMethod: PAYMENT_LABEL[method] || method,
    ...(t.notes ? { paymentNote: t.notes } : {}),
  };
};

/* ---------------- Building the rows ---------------- */

const lineKindOf = (l: SalesLine): LedgerLineKind => {
  const k = l.kind as ItemKind | 'service' | undefined;
  if (k === 'accessory') return 'accessory';
  if (k === 'device') return 'device';
  return 'service';
};

/**
 * A line's share of a sale-level figure, by its share of the sale's subtotal.
 *
 * Used for cost and the channel fee, neither of which is stored per line. A
 * zero subtotal (a fully discounted sale) apportions nothing rather than
 * dividing by zero.
 */
const share = (total: number, lineRevenue: number, subtotal: number): number =>
  subtotal > 0 ? round2((total || 0) * (lineRevenue / subtotal)) : 0;

export interface LedgerFilter {
  kinds?: LedgerLineKind[];
  /** 'cash' | 'card' | 'mixed' | 'etransfer', as stored. */
  paymentMethods?: string[];
  /** Seller uid. */
  soldBy?: string;
  query?: string;
}

export interface SalesLedger {
  start: string;
  end: string;
  clampedToBooksStart: boolean;
  rows: LedgerRow[];
  /** Void/return rows, in the month the reversal happened. */
  reversalRows: LedgerRow[];
  totals: LedgerTotals;
}

export interface LedgerTotals {
  units: number;
  revenue: number;
  /** Owner / allowProfit only. */
  cost?: number;
  profit?: number;
  tax: number;
  cash: number;
  card: number;
  etransfer: number;
  storeCredit: number;
  /** Refunds paid out in range. Reported apart from revenue, never netted off. */
  refunds: number;
  saleCount: number;
}

const rowText = (r: LedgerRow): string =>
  [r.name, r.sku, r.imei, r.customerName, r.soldByEmail, r.saleId].filter(Boolean).join(' ');

/**
 * The whole ledger for an inclusive [start, end] range.
 *
 * `inventory` is used for two things and only two: resolving a line's IMEI/SKU
 * for display, and finding standalone sold devices the P&L also counts.
 */
export const salesLedger = (
  input: {
    transactions: SalesTransaction[];
    inventory: InventoryItem[];
    booksStartDate?: string;
  },
  start: string,
  end: string,
  filter: LedgerFilter = {},
): SalesLedger => {
  const clampedToBooksStart = booksStartClamps(order(start, end)[0], input.booksStartDate);
  const [lo, hi] = order(clampToBooksStart(start, input.booksStartDate), end);
  const byId = new Map(input.inventory.map(i => [i.id, i]));

  const rows: LedgerRow[] = [];
  const reversalRows: LedgerRow[] = [];
  let revenue = 0, cost = 0, tax = 0, cash = 0, card = 0, etransfer = 0, storeCredit = 0;
  let units = 0, refunds = 0, saleCount = 0;

  // Every inventory id any transaction line references, so a device sold
  // through the POS is not also counted as a standalone sale. Same guard the
  // P&L uses, and for the same reason.
  const txnInvIds = new Set<string>();
  input.transactions.forEach(t => t.lines?.forEach(l => l.inventoryId && txnInvIds.add(l.inventoryId)));

  for (const t of input.transactions) {
    // --- A reversal lands in the month it HAPPENED, not the month of the sale.
    const reversedOn = t.status === 'voided' ? t.voidedAt : t.status === 'returned' ? t.returnedAt : undefined;
    if (t.status === 'voided' || t.status === 'returned') {
      const on = reversedOn ? localDate(reversedOn) : t.date;
      if (inRange(on, lo, hi)) {
        const splits = impliedRefundSplits(t);
        const refundAmount = round2(splits.reduce((n, s) => n + s.amount, 0));
        refunds = round2(refunds + refundAmount);
        reversalRows.push({
          key: `${t.id}:reversal`,
          saleId: t.id,
          date: on,
          name: `${t.status === 'voided' ? 'Voided' : 'Returned'} — sale of ${t.date}`,
          lineKind: 'service',
          quantity: 0,
          revenue: -refundAmount,
          firstOfSale: true,
          customerName: t.customerName,
          soldByEmail: t.soldByEmail,
          sale: saleTotals(t),
          reversal: {
            kind: t.status,
            on,
            refundAmount,
            splits,
            label: `${t.status === 'voided' ? 'Voided' : 'Returned'} ${on} · refunded ${refundSplitLabel(splits)}`,
          },
        });
      }
      // A reversed sale contributes nothing to revenue, cost or tax — exactly
      // as isRecognizedSale decides for the P&L and the tax report.
      continue;
    }

    if (!inRange(t.date, lo, hi) || !isRecognizedSale(t)) continue;

    const totals = saleTotals(t);
    const subtotal = round2(t.subtotal);
    const saleCostTotal = round2((t.purchaseCost || 0) + (t.repairCost || 0));
    const lines = t.lines || [];
    let first = true;
    const saleRows: LedgerRow[] = [];

    lines.forEach((l, idx) => {
      const item = l.inventoryId ? byId.get(l.inventoryId) : undefined;
      const lineRevenue = round2((l.unitPrice || 0) * (l.quantity || 0));
      const purchase = share(t.purchaseCost || 0, lineRevenue, subtotal);
      const repair = share(t.repairCost || 0, lineRevenue, subtotal);
      saleRows.push({
        key: `${t.id}:${idx}`,
        saleId: t.id,
        date: t.date,
        name: item ? getDeviceDisplayName(item) : (l.name || 'Item'),
        sku: l.sku || item?.sku,
        imei: item?.imei,
        lineKind: lineKindOf(l),
        quantity: l.quantity || 0,
        revenue: lineRevenue,
        purchaseCost: purchase,
        repairCost: repair,
        totalCost: round2(purchase + repair),
        profit: round2(lineRevenue - purchase - repair),
        channelFee: share(t.platformFee || 0, lineRevenue, subtotal),
        firstOfSale: first,
        customerName: t.customerName,
        soldByEmail: t.soldByEmail,
        sale: totals,
      });
      first = false;
    });

    const kept = saleRows.filter(r => matchesFilter(r, t, filter));
    if (kept.length === 0) continue;
    // The sale-level columns belong to whichever of its lines actually survived
    // the filter, so a filtered view never drops the tax and payment block.
    kept.forEach((r, i) => { r.firstOfSale = i === 0; });
    rows.push(...kept);

    // TOTALS FROM THE TRANSACTION, NOT THE LINES — see the header. When a
    // filter is in play the sale is only partly on screen, so the totals follow
    // what is shown and are apportioned the same way the rows are.
    const whole = kept.length === saleRows.length;
    const shownRevenue = round2(kept.reduce((n, r) => n + r.revenue, 0));
    revenue = round2(revenue + (whole ? subtotal : shownRevenue));
    cost = round2(cost + (whole ? saleCostTotal : round2(kept.reduce((n, r) => n + (r.totalCost || 0), 0))));
    tax = round2(tax + (whole ? totals.tax : share(totals.tax, shownRevenue, subtotal)));
    cash = round2(cash + (whole ? totals.cash : share(totals.cash, shownRevenue, subtotal)));
    card = round2(card + (whole ? totals.card : share(totals.card, shownRevenue, subtotal)));
    etransfer = round2(etransfer + (whole ? totals.etransfer : share(totals.etransfer, shownRevenue, subtotal)));
    storeCredit = round2(storeCredit + (whole ? totals.storeCredit : share(totals.storeCredit, shownRevenue, subtotal)));
    units += kept.reduce((n, r) => n + r.quantity, 0);
    saleCount += 1;
  }

  // --- Standalone sold devices: an off-POS sale logged straight onto the
  // inventory row. The P&L counts these, so the ledger must too or the two
  // disagree by exactly those devices.
  for (const i of input.inventory) {
    if (kindOf(i) !== 'device' || !i.soldDate || txnInvIds.has(i.id)) continue;
    if (!inRange(i.soldDate, lo, hi)) continue;
    const lineRevenue = round2(i.salePrice || 0);
    const purchase = round2(i.purchaseCost || 0);
    const repair = round2(i.repairCost || 0);
    const row: LedgerRow = {
      key: `inv:${i.id}`,
      saleId: i.sku || i.id,
      date: i.soldDate,
      name: getDeviceDisplayName(i),
      sku: i.sku,
      imei: i.imei,
      lineKind: 'device',
      quantity: 1,
      revenue: lineRevenue,
      purchaseCost: purchase,
      repairCost: repair,
      totalCost: round2(purchase + repair),
      profit: round2(lineRevenue - purchase - repair),
      channelFee: round2(i.platformFees || 0),
      firstOfSale: true,
      customerName: i.soldTo || undefined,
      sale: {
        // A direct sale carries no tax field at all — it reads as $0.00, which
        // is also why the ledger's tax total still equals the tax report's
        // (that report only ever counted transactions).
        tax: 0, cash: 0, card: 0, etransfer: 0, storeCredit: 0,
        totalPaid: lineRevenue,
        paymentMethod: 'Direct sale',
      },
    };
    if (!matchesFilter(row, undefined, filter)) continue;
    rows.push(row);
    revenue = round2(revenue + lineRevenue);
    cost = round2(cost + purchase + repair);
    units += 1;
    saleCount += 1;
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.saleId.localeCompare(b.saleId) || a.key.localeCompare(b.key));
  reversalRows.sort((a, b) => a.date.localeCompare(b.date));

  return {
    start: lo, end: hi, clampedToBooksStart, rows, reversalRows,
    totals: {
      units, revenue, cost, profit: round2(revenue - cost), tax,
      cash, card, etransfer, storeCredit, refunds, saleCount,
    },
  };
};

/* ---------------- Filtering ---------------- */

const matchesFilter = (
  row: LedgerRow,
  t: SalesTransaction | undefined,
  f: LedgerFilter,
): boolean => {
  if (f.kinds?.length && !f.kinds.includes(row.lineKind)) return false;
  if (f.paymentMethods?.length) {
    const method = t?.paymentMethod || (t ? 'cash' : 'direct');
    if (!f.paymentMethods.includes(method)) return false;
  }
  if (f.soldBy && t?.soldBy !== f.soldBy) return false;
  const words = queryWords(f.query || '');
  if (words.length === 0) return true;
  // The SHARED multi-word matcher (domain/itemSearch.ts), so searching the
  // ledger behaves the way searching Inventory and the till already do.
  const text = rowText(row).toLowerCase();
  const s: SearchableItem = { plain: text, squashed: text.replace(/\s+/g, '') };
  return matchesWords(s, words);
};

/* ---------------- Trimming for a manager ---------------- */

/**
 * Remove every cost figure from a row for somebody without
 * reports.profit.detailed.
 *
 * THE FIELDS ARE DELETED, not merely hidden by the table — the CSV export
 * writes whatever the row object holds, and a hidden column with a live value
 * underneath is a mask in name only. Same discipline as the Money Trail's
 * trimBelowFloorRow.
 *
 * A manager keeps the date, the item, the customer, the seller, the price, the
 * tax and the payment split — everything they need to explain a day's takings
 * without learning what the shop pays.
 */
export const trimLedgerRow = (row: LedgerRow, canViewCost: boolean): LedgerRow => {
  if (canViewCost) return row;
  const { purchaseCost: _p, repairCost: _r, totalCost: _t, profit: _pr, channelFee: _c, ...rest } = row;
  return rest;
};

export const trimLedgerTotals = (totals: LedgerTotals, canViewCost: boolean): LedgerTotals => {
  if (canViewCost) return totals;
  const { cost: _c, profit: _p, ...rest } = totals;
  return rest;
};

export const trimLedger = (ledger: SalesLedger, canViewCost: boolean): SalesLedger => ({
  ...ledger,
  rows: ledger.rows.map(r => trimLedgerRow(r, canViewCost)),
  reversalRows: ledger.reversalRows.map(r => trimLedgerRow(r, canViewCost)),
  totals: trimLedgerTotals(ledger.totals, canViewCost),
});

/* ---------------- CSV ---------------- */

/**
 * Exactly what is on screen, in the same columns — the file the accountant
 * gets. Built from the ALREADY-TRIMMED rows, so a manager's export cannot
 * carry a figure their screen withheld.
 */
export const salesLedgerCsvRows = (
  ledger: SalesLedger,
  canViewCost: boolean,
): Record<string, string | number>[] => {
  const out: Record<string, string | number>[] = ledger.clampedToBooksStart
    ? [{ Date: `Figures start ${ledger.start} (books start date)` }]
    : [];
  const line = (r: LedgerRow): Record<string, string | number> => ({
    Date: r.date,
    Sale: r.saleId,
    Item: r.name,
    SKU: r.sku || '',
    'IMEI/Serial': r.imei || '',
    Type: r.lineKind,
    Customer: r.customerName || '',
    'Sold by': r.soldByEmail || '',
    Qty: r.quantity,
    'Sale price': r.revenue.toFixed(2),
    ...(canViewCost ? {
      'Purchase cost': (r.purchaseCost ?? 0).toFixed(2),
      'Repair cost': (r.repairCost ?? 0).toFixed(2),
      'Total cost': (r.totalCost ?? 0).toFixed(2),
      Profit: (r.profit ?? 0).toFixed(2),
      'Channel fee': (r.channelFee ?? 0).toFixed(2),
    } : {}),
    Tax: r.firstOfSale ? r.sale.tax.toFixed(2) : '',
    Cash: r.firstOfSale ? r.sale.cash.toFixed(2) : '',
    Card: r.firstOfSale ? r.sale.card.toFixed(2) : '',
    'E-Transfer': r.firstOfSale ? r.sale.etransfer.toFixed(2) : '',
    'Store credit': r.firstOfSale ? r.sale.storeCredit.toFixed(2) : '',
    'Total paid': r.firstOfSale ? r.sale.totalPaid.toFixed(2) : '',
    Payment: r.firstOfSale ? r.sale.paymentMethod : '',
    Note: r.firstOfSale ? (r.sale.paymentNote || '') : '',
    Reversal: r.reversal ? r.reversal.label : '',
  });
  out.push(...ledger.rows.map(line), ...ledger.reversalRows.map(line));
  out.push({
    Date: 'Total',
    Sale: '', Item: `${ledger.totals.saleCount} sales`, SKU: '', 'IMEI/Serial': '',
    Type: '', Customer: '', 'Sold by': '',
    Qty: ledger.totals.units,
    'Sale price': ledger.totals.revenue.toFixed(2),
    ...(canViewCost ? {
      'Purchase cost': '', 'Repair cost': '',
      'Total cost': (ledger.totals.cost ?? 0).toFixed(2),
      Profit: (ledger.totals.profit ?? 0).toFixed(2),
      'Channel fee': '',
    } : {}),
    Tax: ledger.totals.tax.toFixed(2),
    Cash: ledger.totals.cash.toFixed(2),
    Card: ledger.totals.card.toFixed(2),
    'E-Transfer': ledger.totals.etransfer.toFixed(2),
    'Store credit': ledger.totals.storeCredit.toFixed(2),
    'Total paid': '', Payment: '', Note: '',
    Reversal: ledger.totals.refunds > 0 ? `${ledger.totals.refunds.toFixed(2)} refunded` : '',
  });
  return out;
};

/** The sellers who actually appear in a range, for the seller filter. */
export const ledgerSellers = (transactions: SalesTransaction[], lo: string, hi: string): { id: string; email: string }[] => {
  const seen = new Map<string, string>();
  for (const t of transactions) {
    if (!inRange(t.date, lo, hi) || !t.soldBy) continue;
    seen.set(t.soldBy, t.soldByEmail || t.soldBy);
  }
  return [...seen.entries()].map(([id, email]) => ({ id, email })).sort((a, b) => a.email.localeCompare(b.email));
};
