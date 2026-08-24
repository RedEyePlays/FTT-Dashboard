import { Repair, RepairBatch } from '../types';
import { REPAIR_STATUS_LABEL, balanceOwing, batchTotals, repairPartsCost, repairLabor } from '../domain/repairs';

// Reuses the app's print pattern: open a window, write inline-styled HTML, print.
const SHOP = 'FlipThatTech';
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

const openPrint = (title: string, width: number, body: string) => {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return;
  win.document.write(`<html><head><title>${esc(title)}</title>
    <style>
      body{font-family:'Inter',system-ui,Arial,sans-serif;width:${width}px;margin:0 auto;padding:14px;color:#000;}
      h2{text-align:center;margin:0;} .sub{text-align:center;color:#555;font-size:11px;margin:2px 0 10px;}
      h3{font-size:13px;margin:12px 0 4px;border-bottom:1px solid #000;padding-bottom:2px;}
      .row{display:flex;justify-content:space-between;font-size:12px;padding:1px 0;}
      .k{color:#555;} .b{font-weight:800;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;}
      th,td{text-align:left;padding:3px 4px;border-bottom:1px solid #ddd;} th{border-bottom:1px solid #000;}
      td.r,th.r{text-align:right;}
      .tot{border-top:1px dashed #999;margin-top:6px;padding-top:4px;}
      .disc{font-size:9px;color:#777;margin-top:10px;line-height:1.3;}
      .foot{text-align:center;font-size:11px;color:#555;margin-top:12px;}
      .estamp{text-align:center;font-weight:800;font-size:18px;letter-spacing:3px;color:#b45309;border:2px solid #b45309;border-radius:6px;padding:4px 0;margin:8px 0 4px;}
    </style></head><body>${body}
    <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
    </body></html>`);
  win.document.close();
};

const row = (k: string, v?: string) => (v ? `<div class="row"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>` : '');
// Public customer-facing repair-status page — a fully separate, standalone
// site (see status-page/) deployed to its own Firebase Hosting target, not a
// route of this app. Hardcoded rather than derived from window.location since
// this app's own origin is no longer where that page lives.
const trackUrl = (): string => 'https://status.flipthat.tech';
const deviceBlock = (r: Repair) => {
  const name = [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
  return `<h3>Device</h3>${row('Device', name)}${row('Type', r.deviceType)}${row('Storage', r.storage)}${row('Color', r.color)}${row('IMEI / Serial', r.imei)}${row('Carrier', r.carrier)}`;
};
const cosmeticBlock = (r: Repair) => {
  const checks = r.cosmetic?.checks?.length ? r.cosmetic.checks.join(', ') : '';
  if (!checks && !r.cosmetic?.notes) return '';
  return `<h3>Cosmetic Condition</h3>${checks ? `<div class="row"><span>${esc(checks)}</span></div>` : ''}${r.cosmetic?.notes ? `<div class="row"><span class="k">${esc(r.cosmetic.notes)}</span></div>` : ''}`;
};

// --- Retail receipts ---
export const printRetailReceipt = (r: Repair, kind: 'intake' | 'repair' | 'pickup') => {
  const title = kind === 'intake' ? 'Repair Intake' : kind === 'repair' ? 'Repair Receipt' : 'Pickup Receipt';
  const bal = balanceOwing(r);
  const money$ = `<h3>Charges</h3>${row('Repair Price', money(r.repairPrice))}${r.deposit ? row('Deposit', money(r.deposit)) : ''}<div class="row b tot"><span>Balance Owing</span><span>${money(bal)}</span></div>`;
  const warranty = kind === 'pickup' && r.warrantyUntil ? `<h3>Warranty</h3>${row('Covered until', r.warrantyUntil)}${r.warrantyDays ? row('Period', `${r.warrantyDays} days`) : ''}` : '';
  const body = `
    <h2>${SHOP}</h2><div class="sub">${title}<br/>${esc(r.repairNumber)} · ${esc(r.date)}</div>
    <h3>Customer</h3>${row('Name', r.customerName)}${row('Phone', r.customerPhone)}${row('Email', r.customerEmail)}
    ${deviceBlock(r)}
    <h3>Issue</h3><div class="row"><span>${esc(r.issue) || '—'}</span></div>
    ${cosmeticBlock(r)}
    ${row('Status', REPAIR_STATUS_LABEL[r.status])}${row('Est. Completion', r.estimatedCompletion)}
    ${money$}
    ${warranty}
    ${kind !== 'pickup' ? `<h3>Track Your Repair</h3><div class="row"><span class="k">Check status online anytime — no account needed:</span></div><div class="row b"><span>${esc(trackUrl())}</span></div><div class="row"><span class="k">Ticket ${esc(r.repairNumber)} + the name/phone on this ticket.</span></div>` : ''}
    ${kind === 'intake' ? '<p class="disc">The shop is not responsible for data loss. Devices not collected within 90 days may be sold to recover costs. Diagnostic fees may apply if repair is declined.</p>' : ''}
    <p class="foot">Thank you!</p>`;
  openPrint(`${title} ${r.repairNumber}`, 280, body);
};

// --- Repair estimate / quote (pre-work) ---
// A customer-facing quote produced BEFORE parts are committed or work begins —
// deliberately separate from the intake/repair/pickup receipts and the final
// invoice. Itemizes estimated parts + labor, is clearly marked ESTIMATE, and
// carries a "not a final bill" disclaimer so it can never be mistaken for one.
export const printRepairEstimate = (r: Repair, opts?: { validDays?: number }) => {
  const parts = r.parts && r.parts.length ? r.parts : [];
  const partsCost = repairPartsCost(r);
  const labor = repairLabor(r);
  const validDays = opts?.validDays ?? 14;
  const partRows = parts.length
    ? parts.map(p => `<tr><td>${esc(p.name) || 'Part'}</td><td class="r">${p.quantity || 1}</td><td class="r">${money((p.unitCost || 0) * (p.quantity || 1))}</td></tr>`).join('')
    : `<tr><td>Parts (estimated)</td><td class="r"></td><td class="r">${money(partsCost)}</td></tr>`;
  const body = `
    <h2>${SHOP}</h2><div class="sub">REPAIR ESTIMATE — not a final bill<br/>${esc(r.repairNumber)} · ${esc(r.date)}</div>
    <div class="estamp">ESTIMATE</div>
    <h3>Customer</h3>${row('Name', r.customerName)}${row('Phone', r.customerPhone)}${row('Email', r.customerEmail)}
    ${deviceBlock(r)}
    <h3>Reported Issue</h3><div class="row"><span>${esc(r.issue) || '—'}</span></div>
    ${cosmeticBlock(r)}
    <h3>Estimated Charges</h3>
    <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>
      ${partRows}
      <tr><td>Labor (estimated)</td><td class="r"></td><td class="r">${money(labor)}</td></tr>
    </tbody></table>
    <div class="tot"></div>
    <div class="row"><span class="k">Estimated Parts</span><span>${money(partsCost)}</span></div>
    <div class="row"><span class="k">Estimated Labor</span><span>${money(labor)}</span></div>
    <div class="row b tot"><span>Estimated Total</span><span>${money(r.repairPrice)}</span></div>
    ${r.estimatedCompletion ? row('Est. Completion', r.estimatedCompletion) : ''}
    <p class="disc"><strong>This is an estimate, not a final bill.</strong> Prices are approximate and may change once the device is fully diagnosed or if additional parts/work are required. We will contact you for approval before exceeding this estimate. Estimate valid for ${validDays} days from the date above. No work has been authorized or performed by this document.</p>
    <p class="foot">Questions? Contact ${SHOP}.</p>`;
  openPrint(`Estimate ${r.repairNumber}`, 300, body);
};

// --- Wholesale documents ---
export const printBatchIntake = (batch: RepairBatch, devices: Repair[]) => {
  const rows = devices.map((r, i) => `<tr><td>${i + 1}</td><td>${esc([r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || '')}</td><td>${esc(r.imei)}</td><td>${esc(r.issue)}</td></tr>`).join('');
  const body = `
    <h2>${SHOP}</h2><div class="sub">Batch Intake Sheet<br/>${esc(batch.batchNumber)} · ${esc(batch.dateReceived)}</div>
    <h3>Business</h3>${row('Company', batch.companyName)}${row('Contact', batch.contactPerson)}${row('Phone', batch.phone)}${row('Email', batch.email)}
    <h3>Devices Received (${devices.length})</h3>
    <table><thead><tr><th>#</th><th>Device</th><th>IMEI/Serial</th><th>Issue</th></tr></thead><tbody>${rows}</tbody></table>
    ${batch.notes ? `<h3>Notes</h3><div class="row"><span>${esc(batch.notes)}</span></div>` : ''}
    <p class="foot">Received by ${SHOP}</p>`;
  openPrint(`Batch Intake ${batch.batchNumber}`, 640, body);
};

export const printBatchInvoice = (batch: RepairBatch, devices: Repair[]) => {
  const t = batchTotals(batch, devices);
  const rows = devices.filter(r => r.status !== 'cancelled').map((r, i) =>
    `<tr><td>${i + 1}</td><td>${esc([r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || '')}</td><td>${esc(r.imei)}</td><td>${esc(r.issue)}</td><td class="r">${money(r.repairPrice)}</td></tr>`).join('');
  const body = `
    <h2>${SHOP}</h2><div class="sub">Batch Invoice<br/>${esc(batch.batchNumber)} · ${esc(batch.dateReceived)}</div>
    <h3>Bill To</h3>${row('Company', batch.companyName)}${row('Contact', batch.contactPerson)}${row('Phone', batch.phone)}
    <h3>Repairs (${t.count})</h3>
    <table><thead><tr><th>#</th><th>Device</th><th>IMEI/Serial</th><th>Repair</th><th class="r">Price</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"></div>
    <div class="row"><span class="k">Total Repairs</span><span>${t.count}</span></div>
    <div class="row b"><span>Total Cost</span><span>${money(t.totalCost)}</span></div>
    <div class="row"><span class="k">Amount Paid</span><span>${money(t.amountPaid)}</span></div>
    <div class="row b"><span>Remaining Balance</span><span>${money(t.remaining)}</span></div>
    <p class="foot">Thank you for your business!</p>`;
  openPrint(`Batch Invoice ${batch.batchNumber}`, 640, body);
};

// --- Per-device repair sheet (retail ticket or wholesale device) ---
// Clean, printable on normal paper; compact enough to fold as a device label.
export const printDeviceSheet = (r: Repair, ctx?: { companyName?: string; batchNumber?: string }) => {
  const isRetail = r.type === 'retail';
  const who = isRetail ? (r.customerName || 'Walk-in') : (ctx?.companyName || 'Wholesale');
  const num = isRetail ? r.repairNumber : (ctx?.batchNumber ? `${ctx.batchNumber} · ${r.repairNumber}` : r.repairNumber);
  const cosmetic = r.cosmetic?.checks?.length ? r.cosmetic.checks.join(', ') : '';
  const money$ = isRetail
    ? `${row('Repair Price', money(r.repairPrice))}${r.deposit ? row('Deposit', money(r.deposit)) : ''}<div class="row b"><span>Balance Owing</span><span>${money(balanceOwing(r))}</span></div>`
    : row('Repair Price', money(r.repairPrice));
  const body = `
    <h2>${SHOP}</h2><div class="sub">Repair Device Sheet</div>
    <div class="row b" style="font-size:15px;margin-top:4px"><span>${esc(num)}</span><span>${esc(REPAIR_STATUS_LABEL[r.status])}</span></div>
    <div class="row"><span class="k">${isRetail ? 'Customer' : 'Company / Store'}</span><span>${esc(who)}</span></div>
    ${isRetail && r.customerPhone ? row('Phone', r.customerPhone) : ''}
    ${row('Date Received', r.date)}
    <h3>Device</h3>
    ${row('Type', r.deviceType)}${row('Brand / Model', [r.brand, r.model].filter(Boolean).join(' '))}${row('IMEI / Serial', r.imei)}
    <h3>Issue</h3><div class="row"><span>${esc(r.issue) || '—'}</span></div>
    ${cosmetic || r.cosmetic?.notes ? `<h3>Cosmetic Condition</h3>${cosmetic ? `<div class="row"><span>${esc(cosmetic)}</span></div>` : ''}${r.cosmetic?.notes ? `<div class="row"><span class="k">${esc(r.cosmetic.notes)}</span></div>` : ''}` : ''}
    <h3>Charges</h3>${money$}
    ${r.customerNotes ? `<h3>Customer Notes</h3><div class="row"><span>${esc(r.customerNotes)}</span></div>` : ''}
    ${r.internalNotes ? `<h3>Internal Notes</h3><div class="row"><span class="k">${esc(r.internalNotes)}</span></div>` : ''}
    <p class="foot">${esc(num)}</p>`;
  openPrint(`Device Sheet ${r.repairNumber}`, 300, body);
};

export const printBatchSummary = (batch: RepairBatch, devices: Repair[]) => {
  const rows = devices.map((r, i) => `<tr><td>${i + 1}</td><td>${esc([r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || '')}</td><td>${esc(r.imei)}</td><td>${esc(REPAIR_STATUS_LABEL[r.status])}</td><td class="r">${money(r.repairPrice)}</td></tr>`).join('');
  const body = `
    <h2>${SHOP}</h2><div class="sub">Completed Repair Summary<br/>${esc(batch.batchNumber)}</div>
    <h3>Business</h3>${row('Company', batch.companyName)}${row('Contact', batch.contactPerson)}
    <h3>Devices (${devices.length})</h3>
    <table><thead><tr><th>#</th><th>Device</th><th>IMEI/Serial</th><th>Status</th><th class="r">Price</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="foot">${SHOP}</p>`;
  openPrint(`Batch Summary ${batch.batchNumber}`, 640, body);
};
