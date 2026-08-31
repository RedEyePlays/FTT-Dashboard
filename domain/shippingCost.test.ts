import { describe, it, expect } from 'vitest';
import { costShareForLine, isOnlineSale, IN_STORE_PLATFORM, platformFeeAmount } from './pos';
import { profitAndLoss, profitLossCsvRows, yearEndSummary, yearEndCsvRows } from './reports';
import { computeAnalytics, presetRange } from './analytics';
import { SalesTransaction, InventoryItem } from '../types';

// Online sales carry TWO distinct costs off the top: the marketplace's
// commission and shipping. Only platformFeePercent existed, so shipping had to
// be crammed into the fee (inflating it into a fake number) or logged as a
// general expense (losing the link to the device). The workaround people reach
// for — dropping the sale price to "absorb" shipping — misstates revenue AND
// sales tax, which is what these tests exist to make unnecessary.

const DATE = '2026-04-10';

const tx = (p: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 't1', date: DATE, customerName: 'Walk-in',
  subtotal: 500, tax: 65, platformFee: 0,
  purchaseCost: 200, repairCost: 0, totalCost: 200,
  totalPaid: 565, netProfit: 300,
  lines: [{ kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 500 }],
  ...p,
});

const plOf = (transactions: SalesTransaction[], inventory: InventoryItem[] = []) =>
  profitAndLoss({
    transactions, inventory, payPeriods: [], cashReconciliations: [],
    settlements: [], expenses: [], expenseCategories: [],
  }, DATE, DATE);

describe('isOnlineSale — what gates the shipping field', () => {
  it('an in-store sale is not online, so the field never appears', () => {
    expect(isOnlineSale(IN_STORE_PLATFORM)).toBe(false);
    expect(isOnlineSale(undefined)).toBe(false);
    expect(isOnlineSale('')).toBe(false);
  });

  it('any real marketplace is', () => {
    for (const p of ['eBay', 'Best Buy', 'Amazon', 'Facebook Marketplace', 'Swappa', 'Other']) {
      expect(isOnlineSale(p)).toBe(true);
    }
  });
});

describe('costShareForLine — ONE apportionment for both whole-sale costs', () => {
  it('splits by each line\'s share of the subtotal', () => {
    // A $1000 cart: a $750 device and a $250 device.
    expect(costShareForLine(20, 750, 1000)).toBe(15);
    expect(costShareForLine(20, 250, 1000)).toBe(5);
  });

  it('gives the whole amount to a single-line sale', () => {
    expect(costShareForLine(20, 500, 500)).toBe(20);
  });

  it('apportions shipping EXACTLY as it apportions the platform fee', () => {
    // The point of one shared function: the two costs can never disagree
    // about which line they belong to.
    const fee = platformFeeAmount(1000, 10);   // 100
    const shipping = 20;
    for (const line of [750, 250]) {
      const feeShare = costShareForLine(fee, line, 1000);
      const shipShare = costShareForLine(shipping, line, 1000);
      expect(shipShare / shipping).toBeCloseTo(feeShare / fee, 10);
    }
  });

  it('the shares add back up to the whole, with nothing lost', () => {
    const shares = [750, 250].map(l => costShareForLine(20, l, 1000));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 10);
  });

  it('apportions nothing on a zero subtotal rather than dividing by zero', () => {
    expect(costShareForLine(20, 0, 0)).toBe(0);
    expect(Number.isFinite(costShareForLine(20, 0, 0))).toBe(true);
  });
});

describe('shipping is a COST — it never touches price or tax', () => {
  const shipped = tx({
    platformName: 'Best Buy', platformFee: 50, shippingCost: 20,
    // subtotal/tax/totalPaid are IDENTICAL to the unshipped sale above.
    netProfit: 500 - 200 - 50 - 20,
  });
  const plain = tx({ platformName: 'Best Buy', platformFee: 50, netProfit: 500 - 200 - 50 });

  it('leaves subtotal, tax and the recorded total untouched', () => {
    expect(shipped.subtotal).toBe(plain.subtotal);
    expect(shipped.tax).toBe(plain.tax);
    expect(shipped.totalPaid).toBe(plain.totalPaid);
    // The workaround this replaces would have shown 480/62.40/542.40.
    expect(shipped.subtotal).toBe(500);
    expect(shipped.tax).toBe(65);
  });

  it('reduces profit by EXACTLY the shipping amount, and nothing more', () => {
    expect(plain.netProfit - shipped.netProfit).toBe(20);
  });

  it('the P&L revenue is unchanged by shipping — it is not a discount', () => {
    expect(plOf([shipped]).revenue).toBe(plOf([plain]).revenue);
    expect(plOf([shipped]).revenue).toBe(500);
  });

  it('shipping is NOT folded into cost of goods either', () => {
    // Cost of goods is what the STOCK cost; shipping is a selling cost.
    expect(plOf([shipped]).costOfGoods).toBe(200);
    expect(plOf([shipped]).grossProfit).toBe(300);
  });
});

describe('P&L: shipping is its own line, never merged into platform fees', () => {
  const shipped = tx({ platformName: 'eBay', platformFee: 50, shippingCost: 20 });

  it('reports the two costs separately', () => {
    const pl = plOf([shipped]);
    expect(pl.platformFees).toBe(50);
    expect(pl.shipping).toBe(20);
    // Emphatically not one merged 70.
    expect(pl.shipping).not.toBe(70);
    expect(pl.platformFees).not.toBe(70);
  });

  it('both come off net profit', () => {
    // gross 300 − fees 50 − shipping 20
    expect(plOf([shipped]).netProfit).toBe(230);
  });

  it('an in-store sale with no shipping reports 0 and behaves exactly as before', () => {
    const pl = plOf([tx()]);
    expect(pl.shipping).toBe(0);
    expect(pl.platformFees).toBe(0);
    expect(pl.netProfit).toBe(pl.grossProfit);   // nothing extra subtracted
    expect(pl.revenue).toBe(500);
  });

  it('picks shipping up from a standalone sold device too, not only transactions', () => {
    const device: InventoryItem = {
      id: 'i1', kind: 'device', sku: 'FTT-1', date: '2026-04-01', item: 'Pixel 8',
      imei: '', boughtFrom: '', purchaseCost: 300, repairCost: 0,
      soldDate: DATE, soldTo: 'Buyer', salePrice: 600,
      platformFees: 60, shippingCost: 25, notes: '',
    };
    const pl = plOf([], [device]);
    expect(pl.platformFees).toBe(60);
    expect(pl.shipping).toBe(25);
    expect(pl.netProfit).toBe(600 - 300 - 60 - 25);
  });

  it('appears as its OWN row in the accountant CSV export', () => {
    const rows = profitLossCsvRows(plOf([shipped]));
    const shippingRow = rows.find(r => r.Line === 'Shipping');
    const feeRow = rows.find(r => r.Line === 'Platform fees');
    expect(shippingRow).toBeTruthy();
    expect(feeRow).toBeTruthy();
    expect(shippingRow!.Amount).toBe('-20.00');
    expect(feeRow!.Amount).toBe('-50.00');
    // Two distinct rows, not one combined line.
    expect(rows.filter(r => String(r.Line).includes('Shipping'))).toHaveLength(1);
  });

  it('carries through the year-end summary and its export', () => {
    const input = {
      transactions: [shipped], inventory: [], payPeriods: [], cashReconciliations: [],
      settlements: [], expenses: [], expenseCategories: [],
    };
    const s = yearEndSummary(input, 2026);
    expect(s.shipping).toBe(20);
    expect(s.platformFees).toBe(50);
    const row = yearEndCsvRows(s).find(r => r.Metric === 'Shipping');
    expect(row?.Value).toBe('-20.00');
  });
});

describe('analytics: shipping reduces profit without touching revenue', () => {
  const range = () => presetRange('custom', new Date(`${DATE}T12:00:00`).getTime(), { start: DATE, end: DATE });
  const base = { repairs: [], inventory: [], customers: [], auditLogs: [], activity: [] };

  it('a shipped standalone device reports its postage as a cost, not profit', () => {
    const device: InventoryItem = {
      id: 'i1', kind: 'device', sku: 'FTT-1', date: '2026-04-01', item: 'Pixel 8',
      imei: '', boughtFrom: '', purchaseCost: 300, repairCost: 0,
      soldDate: DATE, soldTo: 'Buyer', salePrice: 600,
      platformFees: 60, shippingCost: 25, notes: '',
    };
    const a = computeAnalytics(range(), { ...base, salesTransactions: [], inventory: [device] }, Date.now());
    expect(a.revenue).toBe(600);                       // revenue untouched
    expect(a.grossProfit).toBe(600 - 300 - 60 - 25);   // was 215 + 25 before
  });

  it('a transaction sale carries it through the recorded netProfit', () => {
    const shipped = tx({ platformName: 'eBay', platformFee: 50, shippingCost: 20, netProfit: 230 });
    const a = computeAnalytics(range(), { ...base, salesTransactions: [shipped] }, Date.now());
    expect(a.revenue).toBe(500);
    expect(a.grossProfit).toBe(230);
  });

  it('an in-store sale with no shipping is completely unaffected', () => {
    const a = computeAnalytics(range(), { ...base, salesTransactions: [tx()] }, Date.now());
    expect(a.revenue).toBe(500);
    expect(a.grossProfit).toBe(300);
  });
});
