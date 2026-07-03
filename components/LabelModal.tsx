import React, { useEffect, useState } from 'react';
import { Printer, X, QrCode, FileDown } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { InventoryItem } from '../types';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

type Size = '2x1' | '2x2' | '2x3' | '4x6';
const SIZES: { id: Size; w: number; h: number; label: string }[] = [
  { id: '2x1', w: 2, h: 1, label: '2 × 1"' },
  { id: '2x2', w: 2, h: 2, label: '2 × 2"' },
  { id: '2x3', w: 2, h: 3, label: '2 × 3"' },
  { id: '4x6', w: 4, h: 6, label: '4 × 6"' },
];

const genBarcode = (value: string): string => {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format: 'CODE128', displayValue: false, margin: 0, height: 60, width: 2 });
    return c.toDataURL('image/png');
  } catch { return ''; }
};

export const LabelModal: React.FC<Props> = ({ item, onClose }) => {
  const [size, setSize] = useState<Size>('2x2');
  const [showPrice, setShowPrice] = useState(false);
  const [qr, setQr] = useState('');
  const [barcode, setBarcode] = useState('');

  const sku = item.sku || item.imei || '';
  const name = item.item || [item.brand, item.model].filter(Boolean).join(' ') || 'Item';
  const dims = SIZES.find(s => s.id === size)!;

  useEffect(() => {
    QRCode.toDataURL(sku || 'N/A', { margin: 0, width: 300, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
    setBarcode(genBarcode(sku));
  }, [sku]);

  // Build the inner label HTML at a given px-per-inch scale (shared by preview/print).
  const labelHtml = (ppi: number) => {
    const w = dims.w * ppi, h = dims.h * ppi;
    const pad = Math.round(ppi * 0.06);
    const skuFont = Math.max(10, Math.round(ppi * (dims.w >= 4 ? 0.22 : 0.14)));
    const nameFont = Math.max(8, Math.round(ppi * (dims.w >= 4 ? 0.13 : 0.09)));
    const smallFont = Math.max(7, Math.round(ppi * (dims.w >= 4 ? 0.1 : 0.075)));
    const qrSize = Math.round(Math.min(w, h) * (dims.h >= 3 ? 0.42 : 0.5));
    const bcH = Math.round(h * 0.16);
    const meta = [item.storage, item.color].filter(Boolean).join(' · ');
    return `
      <div style="box-sizing:border-box;width:${w}px;height:${h}px;padding:${pad}px;
        font-family:'Inter',system-ui,Arial,sans-serif;color:#000;background:#fff;border:1px solid #e5e7eb;
        display:flex;flex-direction:column;gap:${Math.round(pad/2)}px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:800;font-size:${smallFont}px;letter-spacing:.5px;">FlipThatTech</span>
          ${showPrice && item.purchaseCost ? `<span style="font-size:${smallFont}px;font-weight:700;">$${item.purchaseCost.toFixed(2)}</span>` : ''}
        </div>
        <div style="display:flex;gap:${pad}px;flex:1;min-height:0;">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;">
            <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${skuFont}px;">${sku}</div>
            <div style="font-weight:700;font-size:${nameFont}px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
            ${meta ? `<div style="font-size:${smallFont}px;color:#374151;">${meta}</div>` : ''}
            ${item.imei ? `<div style="font-size:${smallFont}px;color:#374151;font-family:'Courier New',monospace;">${item.imei}</div>` : ''}
          </div>
          ${qr ? `<img src="${qr}" style="width:${qrSize}px;height:${qrSize}px;align-self:center;" />` : ''}
        </div>
        ${barcode ? `<img src="${barcode}" style="width:100%;height:${bcH}px;object-fit:contain;" />` : ''}
      </div>`;
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=500,height=650');
    if (!win) return;
    win.document.write(`<html><head><title>Label ${sku}</title>
      <style>@page{size:${dims.w}in ${dims.h}in;margin:0;} body{margin:0;display:flex;align-items:center;justify-content:center;}</style>
      </head><body>${labelHtml(96)}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
  };

  const handlePdf = () => {
    const pdf = new jsPDF({ unit: 'in', format: [dims.w, dims.h], orientation: dims.w > dims.h ? 'landscape' : 'portrait' });
    const pad = 0.06;
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(dims.w >= 4 ? 22 : 14);
    pdf.text(sku, pad, pad + 0.18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(dims.w >= 4 ? 13 : 9);
    pdf.text(name.slice(0, 30), pad, pad + (dims.w >= 4 ? 0.5 : 0.36));
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    const meta = [item.storage, item.color].filter(Boolean).join(' · ');
    let y = pad + (dims.w >= 4 ? 0.72 : 0.52);
    if (meta) { pdf.text(meta, pad, y); y += 0.16; }
    if (item.imei) { pdf.text(item.imei, pad, y); y += 0.16; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('FlipThatTech', pad, dims.h - pad - 0.02);
    if (showPrice && item.purchaseCost) pdf.text(`$${item.purchaseCost.toFixed(2)}`, dims.w - pad - 0.6, dims.h - pad - 0.02);
    const qrS = Math.min(dims.w, dims.h) * (dims.h >= 3 ? 0.4 : 0.46);
    if (qr) pdf.addImage(qr, 'PNG', dims.w - pad - qrS, pad, qrS, qrS);
    if (barcode) pdf.addImage(barcode, 'PNG', pad, dims.h - pad - 0.5, dims.w - pad * 2, 0.35);
    pdf.save(`${sku || 'label'}.pdf`);
  };

  // Preview scaled to fit within ~260px
  const previewPpi = Math.min(120, 260 / Math.max(dims.w, dims.h));

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Print Label</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Size selector */}
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Label Size</p>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button key={s.id} onClick={() => setSize(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${size === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} className="rounded" />
            Show purchase price on label
          </label>

          {/* Preview */}
          <div className="flex justify-center bg-slate-100 dark:bg-slate-800 rounded-xl p-4">
            <div dangerouslySetInnerHTML={{ __html: labelHtml(previewPpi) }} />
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
