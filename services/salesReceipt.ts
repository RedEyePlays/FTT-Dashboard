import { SalesTransaction } from '../types';
import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from './printPreview';

// The thermal (80mm) sales receipt. Extracted here so it renders identically
// whether printed at checkout (hooks/useCheckout) or reprinted later from a
// sales-history list — the same transaction in, the same receipt out.
//
// Pure DOM/print side effect: opens a small window, writes the receipt, and
// triggers the browser print dialog. Returns false if the popup was blocked.
export function printSalesReceipt(tx: SalesTransaction, opts: { storeName?: string } = {}): boolean {
  const store = opts.storeName || 'FlipThatTech';
  const money = (n: number) => `$${(n || 0).toFixed(2)}`;
  const rows = tx.lines.map(l =>
    `<tr><td>${l.name}</td><td style="text-align:center">${l.quantity}</td><td style="text-align:right">${money(l.quantity * l.unitPrice)}</td></tr>`
  ).join('');
  const payParts = tx.paymentMethod === 'mixed'
    ? [['Cash', tx.cashAmount], ['Card', tx.cardAmount], ['E-transfer', tx.etransferAmount]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${money(Number(v))}`).join(' · ')
    : (tx.paymentMethod || '');
  const win = window.open('', '_blank', 'width=320,height=640');
  if (!win) return false;
  // Real physical 80mm thermal paper sizing via @page (not a CSS px guess):
  // open-ended (auto) height for the continuous roll, content capped at 72mm
  // — the safe printable width most 80mm thermal printheads actually use
  // (~4mm margin each side, matching the printer's own non-printable edge).
  win.document.write(`<html><head><title>Receipt ${tx.id}</title>
    <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body{font-family:'Inter',system-ui,Arial,sans-serif;width:72mm;margin:0 auto;padding:2mm 0;color:#000;font-size:3mm;}
    h2{text-align:center;margin:0 0 0.5mm;font-size:4.2mm;} .muted{color:#555;font-size:2.6mm;text-align:center;margin-bottom:2mm;}
    table{width:100%;border-collapse:collapse;font-size:2.9mm;} td{padding:0.5mm 0;} .tot td{border-top:0.25mm dashed #999;padding-top:1mm;}
    .row{display:flex;justify-content:space-between;font-size:2.9mm;} .b{font-weight:800;}
    ${PRINT_PREVIEW_BAR_STYLE}</style></head>
    <body>${PRINT_PREVIEW_BAR_HTML}<h2>${store}</h2><div class="muted">Receipt ${tx.id}<br/>${tx.date}</div>
    <table>${rows}</table>
    <div style="margin-top:2mm">
      <div class="row"><span>Subtotal</span><span>${money(tx.subtotal)}</span></div>
      <div class="row"><span>Tax</span><span>${money(tx.tax)}</span></div>
      <div class="row b" style="margin-top:1mm"><span>Total</span><span>${money(tx.totalPaid)}</span></div>
      ${tx.balanceOwing ? `<div class="row" style="margin-top:1mm"><span>Deposit Paid</span><span>${money(tx.deposit || 0)}</span></div><div class="row b" style="color:#b45309"><span>Balance Owing</span><span>${money(tx.balanceOwing)}</span></div>` : ''}
      <div class="row" style="margin-top:1.5mm;color:#555"><span>Payment</span><span>${payParts}</span></div>
      ${tx.customerName ? `<div class="row" style="color:#555"><span>Customer</span><span>${tx.customerName}</span></div>` : ''}
    </div>
    <p style="text-align:center;font-size:2.7mm;color:#555;margin-top:3mm">Thank you!</p>
    </body></html>`);
  win.document.close();
  return true;
}
