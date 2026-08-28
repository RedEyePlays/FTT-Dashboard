import { Settlement, DropOff, DeviceBuyer, SettlementPaymentMethod } from '../types';
import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from './printPreview';
import {
  isLegacySettlement, legacySettlementDirection, legacySettlementDirectionLabel,
  settlementOwedLabel, LEGACY_SETTLEMENT_NOTE,
} from '../domain/dropoffs';

// A standard-paper invoice for a completed (or about-to-be-completed) device buyer
// settlement — the document the buyer signs, so it must state the direction of
// the money unambiguously: the store FINANCED the purchase and the buyer OWES
// the store, with principal (the device price the store advanced) and the
// store's service fee shown as two separate lines, never one opaque total.
// A settlement recorded before that rework (no `model`) is reprinted exactly as
// it was recorded, under a clear "prior model" banner — historical documents
// are never retro-fitted with today's wording.
// — NOT a thermal receipt, NOT a Dymo label, same regular-paper
// print pattern as services/repairPrint.ts's openPrint. One page, letter-ish
// width, browser's normal print dialog / default paper size.
//
// Printable at two points in the flow, both through this SAME function so
// the numbers on paper can never disagree with what actually gets saved:
//  - BEFORE committing, from the review screen (components/
//    SettlementReviewModal.tsx) — `settlement` there is a draft built by
//    domain/dropoffs.ts's buildSettlementFromReview, not yet written
//    anywhere, so the device buyer can check the exact breakdown before agreeing.
//  - AFTER committing, re-printed from settlement history
//    (components/DropOffView.tsx) — same function, the real saved record.
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

const PAYMENT_LABEL: Record<SettlementPaymentMethod, string> = {
  cash: 'Cash', etransfer: 'E-Transfer', other: 'Other',
};

// How the purchase was funded, from the buyer's side of the page: 'runner'
// (legacy stored value) = his own money, so no principal to repay.
const PAID_BY_LABEL: Record<string, string> = {
  runner: 'Buyer-funded (own money)', store: 'Store-funded (owed back)', personal: 'Owner-funded (owed back)',
};

// The full print document, built as a pure string — no window/DOM — so the
// exact markup (and, critically, the totals baked into it) can be asserted
// on directly in tests instead of only through window.open-dependent
// behavior. printSettlementInvoice below is the thin, untestable shell that
// actually opens the window and writes this out.
export function settlementInvoiceHtml(
  settlement: Settlement,
  buyer: DeviceBuyer | undefined,
  allDropOffs: DropOff[],
  opts: { storeName?: string } = {},
): string {
  const store = opts.storeName || 'FlipThatTech';
  const devices = allDropOffs.filter(d => settlement.dropOffIds.includes(d.id));
  // The line as actually reviewed/agreed: if this device's fee was edited on
  // the review screen (settlement.lineAdjustments), show and total the
  // ADJUSTED fee — never the drop-off's raw stored dropOffFee — so the
  // printout matches settlement.totalFees exactly, not a stale snapshot.
  const feeFor = (d: DropOff): number => {
    const adj = settlement.lineAdjustments?.find(a => a.dropOffId === d.id);
    return adj ? adj.adjustedFee : (d.dropOffFee || 0);
  };
  const rows = devices.map(d => `
    <tr>
      <td>${esc(d.item)}${d.imei ? `<br><span class="k" style="font-size:9px">${esc(d.imei)}</span>` : ''}</td>
      <td>${esc(d.dateDropped)}</td>
      <td>${esc(PAID_BY_LABEL[d.paidBy] || 'Store paid')}</td>
      <td class="r">${money(d.purchasePrice)}</td>
      <td class="r">${money(feeFor(d))}</td>
    </tr>`).join('');

  const method = settlement.paymentMethod || 'cash';
  const legacy = isLegacySettlement(settlement);
  const legacyDir = legacySettlementDirection(settlement.amountPaid);
  const owed = settlement.amountOwed || 0;
  const directionCls = legacy ? (legacyDir === 'buyer_owes_store' ? 'owe' : '') : 'owe';
  const directionText = legacy
    ? legacySettlementDirectionLabel(settlement.amountPaid, legacyDir)
    : settlementOwedLabel(owed);

  // Principal and fee stay two separate printed lines. The buyer signs for a
  // breakdown he can check line by line, not a single number.
  const totalsBlock = legacy ? `
        <div class="row"><span class="k">Purchase cash recorded as fronted by device buyer</span><span>${money(settlement.totalPurchaseFronted)}</span></div>
        <div class="row"><span class="k">Total drop-off fees</span><span>${money(settlement.totalFees)}</span></div>
        ${settlement.adjustmentAmount != null ? `<div class="row"><span class="k">Adjustment${settlement.adjustmentNote ? ` — ${esc(settlement.adjustmentNote)}` : ''}</span><span>${settlement.adjustmentAmount < 0 ? '-' : '+'}${money(Math.abs(settlement.adjustmentAmount))}</span></div>` : ''}
        <div class="row b" style="margin-top:2px"><span>Net amount</span><span>${money(Math.abs(settlement.amountPaid || 0))}</span></div>` : `
        <div class="row"><span class="k">Principal owed (device purchase price advanced by store)</span><span>${money(settlement.principalOwed)}</span></div>
        ${(settlement.principalPersonalFunded || 0) >= 0.005 ? `<div class="row"><span class="k" style="font-size:10px">&nbsp;&nbsp;of which owner-funded out of pocket</span><span style="font-size:10px">${money(settlement.principalPersonalFunded)}</span></div>` : ''}
        <div class="row"><span class="k">Service fee</span><span>${money(settlement.totalFees)}</span></div>
        ${settlement.adjustmentAmount != null ? `<div class="row"><span class="k">Adjustment${settlement.adjustmentNote ? ` — ${esc(settlement.adjustmentNote)}` : ''}</span><span>${settlement.adjustmentAmount < 0 ? '-' : '+'}${money(Math.abs(settlement.adjustmentAmount))}</span></div>` : ''}
        <div class="row b" style="margin-top:2px"><span>Total owed to store</span><span>${money(owed)}</span></div>`;

  return `<html><head><title>Settlement Invoice ${esc(settlement.id)}</title>
    <style>
      body{font-family:'Inter',system-ui,Arial,sans-serif;width:480px;margin:0 auto;padding:14px;color:#000;}
      h2{text-align:center;margin:0;} .sub{text-align:center;color:#555;font-size:11px;margin:2px 0 10px;}
      h3{font-size:13px;margin:12px 0 4px;border-bottom:1px solid #000;padding-bottom:2px;}
      .row{display:flex;justify-content:space-between;font-size:12px;padding:1px 0;}
      .k{color:#555;} .b{font-weight:800;} .owe{color:#b45309;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;}
      th,td{text-align:left;padding:3px 4px;border-bottom:1px solid #ddd;} th{border-bottom:1px solid #000;}
      td.r,th.r{text-align:right;}
      .tot{border-top:1px dashed #999;margin-top:6px;padding-top:4px;}
      .direction{margin-top:8px;padding:6px 8px;border:1px solid #000;border-radius:4px;text-align:center;font-weight:800;font-size:13px;}
      .sig{display:flex;justify-content:space-between;gap:24px;margin-top:36px;}
      .sig .line{flex:1;text-align:center;font-size:11px;color:#555;}
      .sig .line .rule{border-top:1px solid #000;margin-bottom:4px;padding-top:28px;}
      .foot{text-align:center;font-size:11px;color:#555;margin-top:12px;}
      .legacy{font-size:10px;color:#b45309;text-align:center;margin:6px 0 0;}
      ${PRINT_PREVIEW_BAR_STYLE}
    </style></head><body>${PRINT_PREVIEW_BAR_HTML}
      <h2>${esc(store)}</h2>
      <div class="sub">Device Buyer Settlement Invoice — ${esc(settlement.id)}</div>
      <div class="row"><span class="k">Device buyer</span><span class="b">${esc(buyer?.name || 'Unknown')}</span></div>
      <div class="row"><span class="k">Settlement date</span><span>${esc(settlement.date)}</span></div>
      <div class="row"><span class="k">Settlement ID</span><span>${esc(settlement.id)}</span></div>
      <div class="row"><span class="k">Payment method</span><span>${esc(PAYMENT_LABEL[method])}</span></div>
      <h3>Devices (${devices.length})</h3>
      <table>
        <thead><tr><th>Item</th><th>Dropped off</th><th>Paid by</th><th class="r">Purchase</th><th class="r">Service fee</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tot">${totalsBlock}
      </div>
      <div class="direction ${directionCls}">${esc(directionText)}</div>
      ${legacy ? `<p class="legacy">${esc(LEGACY_SETTLEMENT_NOTE)}</p>` : ''}
      ${settlement.notes ? `<h3>Notes</h3><p style="font-size:11px;color:#333">${esc(settlement.notes)}</p>` : ''}
      <div class="sig">
        <div class="line"><div class="rule"></div>Device buyer signature</div>
        <div class="line"><div class="rule"></div>${esc(store)} signature</div>
      </div>
      <div class="foot">Settlement ${esc(settlement.id)}</div>
    </body></html>`;
}

export function printSettlementInvoice(
  settlement: Settlement,
  buyer: DeviceBuyer | undefined,
  allDropOffs: DropOff[],
  opts: { storeName?: string } = {},
): boolean {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return false;
  win.document.write(settlementInvoiceHtml(settlement, buyer, allDropOffs, opts));
  win.document.close();
  return true;
}
