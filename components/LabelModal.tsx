import React, { useEffect, useState } from 'react';
import { Printer, X, QrCode, FileDown } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { InventoryItem, DeviceStatus } from '../types';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

// Label templates. Dymo 36 × 89 mm (LabelWriter large address, printed
// landscape) is the primary/default; the inch sizes cover thermal roll stock.
type TemplateId = 'dymo-36x89' | '2x1' | '2x2' | '2x3' | '4x6';
const mm = (v: number) => v / 25.4; // millimetres → inches
interface Template { id: TemplateId; w: number; h: number; label: string; dymo?: boolean; }
const TEMPLATES: Template[] = [
  { id: 'dymo-36x89', w: mm(89), h: mm(36), label: 'Dymo 36 × 89 mm', dymo: true },
  { id: '2x1', w: 2, h: 1, label: '2 × 1"' },
  { id: '2x2', w: 2, h: 2, label: '2 × 2"' },
  { id: '2x3', w: 2, h: 3, label: '2 × 3"' },
  { id: '4x6', w: 4, h: 6, label: '4 × 6"' },
];

const STATUS_LABEL: Record<DeviceStatus, string> = {
  pending_purchase: 'Pending Purchase',
  pending_repair: 'Pending Repair',
  ready: 'Ready for Sale',
  sold: 'Sold',
  returned: 'Returned',
};

// Owner label preferences, persisted locally (not in Firestore). Remembers the
// last selected template plus the optional-element toggles.
interface LabelPrefs { template: TemplateId; showPrice: boolean; showBarcode: boolean; showStatus: boolean; }
const PREFS_KEY = 'ftt_label_tpl_v1';
const loadPrefs = (): LabelPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      template: TEMPLATES.some(t => t.id === s.template) ? s.template : 'dymo-36x89',
      showPrice: !!s.showPrice,
      showBarcode: s.showBarcode !== false, // default on
      showStatus: !!s.showStatus,
    };
  } catch {
    return { template: 'dymo-36x89', showPrice: false, showBarcode: true, showStatus: false };
  }
};

const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

const genBarcode = (value: string): string => {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format: 'CODE128', displayValue: false, margin: 0, height: 60, width: 2 });
    return c.toDataURL('image/png');
  } catch { return ''; }
};

export const LabelModal: React.FC<Props> = ({ item, onClose }) => {
  const [prefs, setPrefs] = useState<LabelPrefs>(loadPrefs);
  const [qr, setQr] = useState('');
  const [barcode, setBarcode] = useState('');

  const sku = item.sku || item.imei || '';
  const name = item.item || [item.brand, item.model].filter(Boolean).join(' ') || 'Item';
  const tpl = TEMPLATES.find(t => t.id === prefs.template)!;
  const status = item.deviceStatus ? STATUS_LABEL[item.deviceStatus] : '';

  useEffect(() => {
    // QR encodes the SKU so a scan resolves the inventory item.
    QRCode.toDataURL(sku || 'N/A', { margin: 0, width: 300, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
    setBarcode(genBarcode(sku));
  }, [sku]);

  const update = (next: Partial<LabelPrefs>) => {
    setPrefs(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  // Render the label at a given scale/unit ("px" for the on-screen preview, "in"
  // for print). Inch units keep print output correct at any printer DPI.
  const labelHtml = (unit: 'px' | 'in', scale: number) => {
    const u = (n: number) => `${+(n * scale).toFixed(4)}${unit}`;
    const { w, h } = tpl;
    const pad = 0.06;
    const border = unit === 'px' ? 'border:1px solid #e5e7eb;' : '';
    const pos = unit === 'in' ? 'position:absolute;top:0;left:0;' : '';
    const meta = [item.storage, item.color].filter(Boolean).join(' · ');

    const statusPill = prefs.showStatus && status
      ? `<span style="border:${u(0.014)} solid #000;border-radius:${u(0.5)};padding:${u(0.01)} ${u(0.05)};font-size:${u(tpl.dymo ? 0.075 : 0.065)};font-weight:800;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;">${esc(status)}</span>`
      : '';

    if (tpl.dymo) {
      // Landscape Dymo layout: text column on the left, a large SKU QR on the
      // right filling the label height, optional barcode under the text.
      const skuF = 0.2, nameF = 0.12, smallF = 0.085;
      const qrS = h - pad * 2;
      const bcH = 0.26;
      return `
        <div style="box-sizing:border-box;${pos}width:${u(w)};height:${u(h)};padding:${u(pad)};
          font-family:'Inter',system-ui,Arial,sans-serif;color:#000;background:#fff;${border}
          display:flex;gap:${u(pad)};overflow:hidden;">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(0.02)};">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:${u(0.04)};">
              <span style="font-weight:800;font-size:${u(smallF)};letter-spacing:.5px;">FlipThatTech</span>
              ${prefs.showPrice && item.purchaseCost ? `<span style="font-size:${u(smallF)};font-weight:700;">$${item.purchaseCost.toFixed(2)}</span>` : ''}
            </div>
            <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(skuF)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sku)}</div>
            <div style="font-weight:700;font-size:${u(nameF)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
            ${meta ? `<div style="font-size:${u(smallF)};color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(meta)}</div>` : ''}
            ${item.imei ? `<div style="font-size:${u(smallF)};color:#374151;font-family:'Courier New',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.imei)}</div>` : ''}
            ${statusPill ? `<div style="margin-top:${u(0.02)};">${statusPill}</div>` : ''}
            ${prefs.showBarcode && barcode ? `<img src="${barcode}" style="width:100%;height:${u(bcH)};object-fit:contain;object-position:left;margin-top:${u(0.02)};" />` : ''}
          </div>
          ${qr ? `<img src="${qr}" style="width:${u(qrS)};height:${u(qrS)};align-self:center;flex-shrink:0;" />` : ''}
        </div>`;
    }

    // Generic thermal layout: branding row, then text + QR, optional barcode.
    const large = w >= 4;
    const skuF = large ? 0.22 : 0.14;
    const nameF = large ? 0.13 : 0.09;
    const smallF = large ? 0.1 : 0.075;
    const qrS = Math.min(w, h) * (h >= 3 ? 0.42 : 0.5);
    const bcH = h * 0.16;
    return `
      <div style="box-sizing:border-box;${pos}width:${u(w)};height:${u(h)};padding:${u(pad)};
        font-family:'Inter',system-ui,Arial,sans-serif;color:#000;background:#fff;${border}
        display:flex;flex-direction:column;gap:${u(pad / 2)};overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:${u(0.04)};">
          <span style="font-weight:800;font-size:${u(smallF)};letter-spacing:.5px;">FlipThatTech</span>
          <div style="display:flex;align-items:center;gap:${u(0.05)};">
            ${statusPill}
            ${prefs.showPrice && item.purchaseCost ? `<span style="font-size:${u(smallF)};font-weight:700;">$${item.purchaseCost.toFixed(2)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:${u(pad)};flex:1;min-height:0;">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;">
            <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(skuF)};">${esc(sku)}</div>
            <div style="font-weight:700;font-size:${u(nameF)};margin-top:${u(0.02)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
            ${meta ? `<div style="font-size:${u(smallF)};color:#374151;">${esc(meta)}</div>` : ''}
            ${item.imei ? `<div style="font-size:${u(smallF)};color:#374151;font-family:'Courier New',monospace;">${esc(item.imei)}</div>` : ''}
          </div>
          ${qr ? `<img src="${qr}" style="width:${u(qrS)};height:${u(qrS)};align-self:center;" />` : ''}
        </div>
        ${prefs.showBarcode && barcode ? `<img src="${barcode}" style="width:100%;height:${u(bcH)};object-fit:contain;" />` : ''}
      </div>`;
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=520,height=680');
    if (!win) return;
    // The print document IS the label: @page = exact template size (landscape
    // geometry when wider than tall, e.g. Dymo/2x1); html/body match those
    // physical dimensions with margin/padding 0, overflow hidden, no border; the
    // label is anchored top-left rather than centered on a larger sheet.
    win.document.write(`<!DOCTYPE html><html><head><title>Label ${esc(sku)}</title>
      <style>
        @page { size: ${tpl.w}in ${tpl.h}in; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${tpl.w}in; height: ${tpl.h}in; overflow: hidden; background: #fff; }
        body { position: relative; -webkit-font-smoothing: none; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      </style>
      </head><body>${labelHtml('in', 1)}
      <script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
  };

  const handlePdf = () => {
    const { w, h } = tpl;
    const large = w >= 4;
    const pdf = new jsPDF({ unit: 'in', format: [w, h], orientation: w > h ? 'landscape' : 'portrait' });
    const pad = 0.06;
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(large ? 22 : tpl.dymo ? 16 : 14);
    pdf.text(sku, pad, pad + 0.18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(large ? 13 : 9);
    pdf.text(name.slice(0, 30), pad, pad + (large ? 0.5 : 0.36));
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    const meta = [item.storage, item.color].filter(Boolean).join(' · ');
    let y = pad + (large ? 0.72 : 0.52);
    if (meta) { pdf.text(meta, pad, y); y += 0.16; }
    if (item.imei) { pdf.text(item.imei, pad, y); y += 0.16; }
    if (prefs.showStatus && status) { pdf.setFont('helvetica', 'bold'); pdf.text(status.toUpperCase(), pad, y); pdf.setFont('helvetica', 'normal'); y += 0.16; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('FlipThatTech', pad, h - pad - 0.02);
    if (prefs.showPrice && item.purchaseCost) pdf.text(`$${item.purchaseCost.toFixed(2)}`, w - pad - 0.6, h - pad - 0.02);
    const qrS = tpl.dymo ? h - pad * 2 : Math.min(w, h) * (h >= 3 ? 0.4 : 0.46);
    if (qr) pdf.addImage(qr, 'PNG', w - pad - qrS, pad, qrS, qrS);
    if (prefs.showBarcode && barcode) pdf.addImage(barcode, 'PNG', pad, h - pad - 0.5, (tpl.dymo ? w * 0.55 : w) - pad * 2, 0.35);
    pdf.save(`${sku || 'label'}.pdf`);
  };

  // Preview scaled to fit within ~260px on the longest edge.
  const previewPpi = Math.min(120, 260 / Math.max(tpl.w, tpl.h));

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Print Label</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Template selector */}
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Label Template</p>
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map(t => (
                <button key={t.id} onClick={() => update({ template: t.id })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${prefs.template === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional elements */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={prefs.showBarcode} onChange={e => update({ showBarcode: e.target.checked })} className="rounded" />
              Show barcode
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={prefs.showStatus} onChange={e => update({ showStatus: e.target.checked })} className="rounded" disabled={!status} />
              Show status badge{!status && <span className="text-xs text-slate-400">(no status on this item)</span>}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={prefs.showPrice} onChange={e => update({ showPrice: e.target.checked })} className="rounded" />
              Show purchase price
            </label>
          </div>

          {/* Preview */}
          <div className="flex justify-center bg-slate-100 dark:bg-slate-800 rounded-xl p-4">
            <div dangerouslySetInnerHTML={{ __html: labelHtml('px', previewPpi) }} />
          </div>

          <div className="flex gap-2">
            <button onClick={handlePrint} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Printer className="w-4 h-4" /> Print</button>
            <button onClick={handlePdf} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><FileDown className="w-4 h-4" /> Download PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
};
