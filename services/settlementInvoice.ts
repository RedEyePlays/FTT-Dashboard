import { Settlement, DropOff, Runner, SettlementPaymentMethod } from '../types';
import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from './printPreview';

// A standard-paper invoice for a completed runner settlement — NOT a thermal
// receipt, NOT a Dymo label, same regular-paper print pattern as
// services/repairPrint.ts's openPrint. One page, letter-ish width, browser's
// normal print dialog / default paper size.
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

const PAYMENT_LABEL: Record<SettlementPaymentMethod, string> = {
  cash: 'Cash', etransfer: 'E-Transfer', other: 'Other',
};

export function printSettlementInvoice(
  settlement: Settlement,
  runner: Runner | undefined,
  allDropOffs: DropOff[],
  opts: { storeName?: string } = {},
): boolean {
  const store = opts.storeName || 'FlipThatTech';
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return false;

  const devices = allDropOffs.filter(d => settlement.dropOffIds.includes(d.id));
  const rows = devices.map(d => `
    <tr>
      <td>${esc(d.item)}${d.imei ? `<br><span class="k" style="font-size:9px">${esc(d.imei)}</span>` : ''}</td>
      <td>${d.paidBy === 'runner' ? 'Runner paid' : 'Store paid'}</td>
      <td class="r">${money(d.purchasePrice)}</td>
      <td class="r">${money(d.dropOffFee)}</td>
    </tr>`).join('');

  const method = settlement.paymentMethod || 'cash';

  win.document.write(`<html><head><title>Settlement Invoice ${esc(settlement.id)}</title>
    <style>
      body{font-family:'Inter',system-ui,Arial,sans-serif;width:480px;margin:0 auto;padding:14px;color:#000;}
      h2{text-align:center;margin:0;} .sub{text-align:center;color:#555;font-size:11px;margin:2px 0 10px;}
      h3{font-size:13px;margin:12px 0 4px;border-bottom:1px solid #000;padding-bottom:2px;}
      .row{display:flex;justify-content:space-between;font-size:12px;padding:1px 0;}
      .k{color:#555;} .b{font-weight:800;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;}
      th,td{text-align:left;padding:3px 4px;border-bottom:1px solid #ddd;} th{border-bottom:1px solid #000;}
      td.r,th.r{text-align:right;}
      .tot{border-top:1px dashed #999;margin-top:6px;padding-top:4px;}
      .foot{text-align:center;font-size:11px;color:#555;margin-top:12px;}
      ${PRINT_PREVIEW_BAR_STYLE}
    </style></head><body>${PRINT_PREVIEW_BAR_HTML}
      <h2>${esc(store)}</h2>
      <div class="sub">Runner Settlement Invoice</div>
      <div class="row"><span class="k">Runner</span><span class="b">${esc(runner?.name || 'Unknown')}</span></div>
      <div class="row"><span class="k">Settlement date</span><span>${esc(settlement.date)}</span></div>
      <div class="row"><span class="k">Payment method</span><span>${esc(PAYMENT_LABEL[method])}</span></div>
      <h3>Devices (${devices.length})</h3>
      <table>
        <thead><tr><th>Item</th><th>Paid by</th><th class="r">Purchase</th><th class="r">Fee</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tot">
        <div class="row"><span class="k">Purchase cash fronted by runner</span><span>${money(settlement.totalPurchaseFronted)}</span></div>
        <div class="row"><span class="k">Total drop-off fees</span><span>${money(settlement.totalFees)}</span></div>
        <div class="row b" style="margin-top:2px"><span>Total paid to runner</span><span>${money(settlement.amountPaid)}</span></div>
      </div>
      ${settlement.notes ? `<h3>Notes</h3><p style="font-size:11px;color:#333">${esc(settlement.notes)}</p>` : ''}
      <div class="foot">Settlement ${esc(settlement.id)}</div>
    </body></html>`);
  win.document.close();
  return true;
}
