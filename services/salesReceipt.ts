import { SalesTransaction } from '../types';

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
  const win = window.open('', '_blank', 'width=380,height=640');
  if (!win) return false;
  win.document.write(`<html><head><title>Receipt ${tx.id}</title>
    <style>body{font-family:'Inter',system-ui,Arial,sans-serif;width:280px;margin:0 auto;padding:12px;color:#000;}
    h2{text-align:center;margin:0 0 2px;} .muted{color:#555;font-size:11px;text-align:center;margin-bottom:8px;}
    table{width:100%;border-collapse:collapse;font-size:12px;} td{padding:2px 0;} .tot td{border-top:1px dashed #999;padding-top:4px;}
    .row{display:flex;justify-content:space-between;font-size:12px;} .b{font-weight:800;}</style></head>
    <body><h2>${store}</h2><div class="muted">Receipt ${tx.id}<br/>${tx.date}</div>
    <table>${rows}</table>
    <div style="margin-top:8px">
      <div class="row"><span>Subtotal</span><span>${money(tx.subtotal)}</span></div>
      <div class="row"><span>Tax</span><span>${money(tx.tax)}</span></div>
      <div class="row b" style="margin-top:4px"><span>Total</span><span>${money(tx.totalPaid)}</span></div>
      ${tx.balanceOwing ? `<div class="row" style="margin-top:4px"><span>Deposit Paid</span><span>${money(tx.deposit || 0)}</span></div><div class="row b" style="color:#b45309"><span>Balance Owing</span><span>${money(tx.balanceOwing)}</span></div>` : ''}
      <div class="row" style="margin-top:6px;color:#555"><span>Payment</span><span>${payParts}</span></div>
      ${tx.customerName ? `<div class="row" style="color:#555"><span>Customer</span><span>${tx.customerName}</span></div>` : ''}
    </div>
    <p style="text-align:center;font-size:11px;color:#555;margin-top:12px">Thank you!</p>
    <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
    </body></html>`);
  win.document.close();
  return true;
}
