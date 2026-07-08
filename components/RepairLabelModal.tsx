import React, { useEffect, useState } from 'react';
import { Printer, X, QrCode, FileDown } from 'lucide-react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Repair } from '../types';

interface Props {
  repair: Repair;
  // For wholesale devices: the parent batch number + 1-based line number.
  context?: { batchNumber?: string; lineNumber?: number };
  onClose: () => void;
  onPrinted?: () => void;
}

type Size = '2x1' | '2x2' | '2x3' | '4x6';
const SIZES: { id: Size; w: number; h: number; label: string }[] = [
  { id: '2x1', w: 2, h: 1, label: '2 × 1"' },
  { id: '2x2', w: 2, h: 2, label: '2 × 2"' },
  { id: '2x3', w: 2, h: 3, label: '2 × 3"' },
  { id: '4x6', w: 4, h: 6, label: '4 × 6"' },
];

const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

export const RepairLabelModal: React.FC<Props> = ({ repair: r, context, onClose, onPrinted }) => {
  const [size, setSize] = useState<Size>('2x1'); // default 2x1
  const [qr, setQr] = useState('');

  const isWholesale = r.type === 'wholesale';
  const idLine = isWholesale
    ? `${context?.batchNumber || 'Batch'}${context?.lineNumber ? ` · #${context.lineNumber}` : ''}`
    : r.repairNumber;
  const device = [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
  const dims = SIZES.find(s => s.id === size)!;

  useEffect(() => {
    // Encode the repair/device document id so a scan can find the record.
    QRCode.toDataURL(r.id, { margin: 0, width: 300, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [r.id]);

  const labelHtml = (ppi: number) => {
    const w = dims.w * ppi, h = dims.h * ppi;
    const pad = Math.round(ppi * 0.06);
    const big = Math.max(10, Math.round(ppi * (dims.w >= 4 ? 0.2 : 0.13)));
    const mid = Math.max(8, Math.round(ppi * (dims.w >= 4 ? 0.12 : 0.085)));
    const small = Math.max(7, Math.round(ppi * (dims.w >= 4 ? 0.095 : 0.07)));
    const qrSize = Math.round(Math.min(w, h) * (dims.h >= 3 ? 0.4 : 0.62));
    return `
      <div style="box-sizing:border-box;width:${w}px;height:${h}px;padding:${pad}px;
        font-family:'Inter',system-ui,Arial,sans-serif;color:#000;background:#fff;border:1px solid #e5e7eb;
        display:flex;gap:${pad}px;overflow:hidden;">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(pad/3)}px;">
          <div style="font-weight:800;font-size:${small}px;letter-spacing:.5px;">FlipThatTech</div>
          <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${big}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(idLine)}</div>
          <div style="font-weight:700;font-size:${mid}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(device)}</div>
          ${r.imei ? `<div style="font-size:${small}px;font-family:'Courier New',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.imei)}</div>` : ''}
          ${r.issue ? `<div style="font-size:${small}px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.issue)}</div>` : ''}
        </div>
        ${qr ? `<img src="${qr}" style="width:${qrSize}px;height:${qrSize}px;align-self:center;" />` : ''}
      </div>`;
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=500,height=650');
    if (!win) return;
    win.document.write(`<html><head><title>Repair Label ${esc(r.repairNumber)}</title>
      <style>@page{size:${dims.w}in ${dims.h}in;margin:0;} body{margin:0;display:flex;align-items:center;justify-content:center;}</style>
      </head><body>${labelHtml(96)}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
    onPrinted?.();
  };

  const handlePdf = () => {
    const pdf = new jsPDF({ unit: 'in', format: [dims.w, dims.h], orientation: dims.w > dims.h ? 'landscape' : 'portrait' });
    const pad = 0.06;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text('FlipThatTech', pad, pad + 0.12);
    pdf.setFont('courier', 'bold'); pdf.setFontSize(dims.w >= 4 ? 20 : 13); pdf.text(idLine.slice(0, 22), pad, pad + (dims.w >= 4 ? 0.5 : 0.34));
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(dims.w >= 4 ? 12 : 9); pdf.text(device.slice(0, 26), pad, pad + (dims.w >= 4 ? 0.72 : 0.5));
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    let y = pad + (dims.w >= 4 ? 0.92 : 0.64);
    if (r.imei) { pdf.text(r.imei.slice(0, 24), pad, y); y += 0.15; }
    if (r.issue) { pdf.text(r.issue.slice(0, 28), pad, y); }
    const qrS = Math.min(dims.w, dims.h) * (dims.h >= 3 ? 0.38 : 0.56);
    if (qr) pdf.addImage(qr, 'PNG', dims.w - pad - qrS, (dims.h - qrS) / 2, qrS, qrS);
    pdf.save(`${r.repairNumber || 'repair-label'}.pdf`);
    onPrinted?.();
  };

  const previewPpi = Math.min(120, 300 / Math.max(dims.w, dims.h));

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Repair QR Label</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
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
