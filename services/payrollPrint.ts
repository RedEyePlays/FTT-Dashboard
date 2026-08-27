import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from './printPreview';

// Reuses the app's print pattern (see services/repairPrint.ts): open a
// window, write inline-styled HTML, print. Regular-paper document, not
// thermal — a payroll summary is a management/back-office record, not a
// register receipt.
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
const shopName = (storeName?: string) => esc(storeName || 'FlipThatTech');

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
      .foot{text-align:center;font-size:11px;color:#555;margin-top:12px;}
      ${PRINT_PREVIEW_BAR_STYLE}
    </style></head><body>${PRINT_PREVIEW_BAR_HTML}${body}
    </body></html>`);
  win.document.close();
};

export interface PayrollPrintRow {
  name: string;
  hours: number;
  rate: number;
  gross: number;
}

// Summary sheet — every employee, hours, rate, gross, period dates, totals.
export const printPayrollSummary = (
  rows: PayrollPrintRow[],
  period: { label: string },
  opts: { storeName?: string } = {},
) => {
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const body = `
    <h2>${shopName(opts.storeName)}</h2><div class="sub">Payroll Summary<br/>${esc(period.label)}</div>
    <table><thead><tr><th>Employee</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Gross</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${r.hours.toFixed(2)}</td><td class="r">${money(r.rate)}</td><td class="r">${money(r.gross)}</td></tr>`).join('')}
    </tbody></table>
    <div class="tot"></div>
    <div class="row b"><span>Total Hours</span><span>${totalHours.toFixed(2)}</span></div>
    <div class="row b"><span>Total Gross</span><span>${money(totalGross)}</span></div>
    <p class="foot">${shopName(opts.storeName)} — for internal payroll records only.</p>`;
  openPrint(`Payroll Summary ${period.label}`, 640, body);
};

// Per-employee pay stub for one period.
export const printPayStub = (
  employeeName: string,
  row: PayrollPrintRow,
  period: { label: string },
  shifts: { date: string; in: string; out: string; hours: string }[],
  opts: { storeName?: string } = {},
) => {
  const shiftRows = shifts.map(s => `<tr><td>${esc(s.date)}</td><td>${esc(s.in)}</td><td>${esc(s.out)}</td><td class="r">${esc(s.hours)}</td></tr>`).join('');
  const body = `
    <h2>${shopName(opts.storeName)}</h2><div class="sub">Pay Stub<br/>${esc(period.label)}</div>
    <h3>Employee</h3><div class="row"><span class="k">Name</span><span>${esc(employeeName)}</span></div>
    <h3>Shifts</h3>
    <table><thead><tr><th>Date</th><th>In</th><th>Out</th><th class="r">Hours</th></tr></thead><tbody>${shiftRows}</tbody></table>
    <div class="tot"></div>
    <div class="row"><span class="k">Total Hours</span><span>${row.hours.toFixed(2)}</span></div>
    <div class="row"><span class="k">Rate</span><span>${money(row.rate)}</span></div>
    <div class="row b"><span>Gross Pay</span><span>${money(row.gross)}</span></div>
    <p class="foot">${shopName(opts.storeName)} — for internal payroll records only.</p>`;
  openPrint(`Pay Stub ${esc(employeeName)} ${period.label}`, 380, body);
};
