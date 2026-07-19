import React, { useEffect, useState } from 'react';
import { Printer, X, QrCode, FileDown } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { InventoryItem, DeviceStatus } from '../types';
import { LabelMedia, LabelContent, labelPreview, labelPrintDoc, mmOf } from '../services/labelLayout';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

// Label templates. Dymo 36 × 89 mm (LabelWriter large address, landscape) is the
// primary/default; the inch sizes cover thermal roll stock.
type TemplateId = 'dymo-36x89' | '2x1' | '2x2' | '2x3' | '4x6';
const mm = (v: number) => v / 25.4;
const TEMPLATES: LabelMedia[] = [
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
interface LabelPrefs { template: TemplateId; showBarcode: boolean; showStatus: boolean; }
const PREFS_KEY = 'ftt_label_tpl_v1';
const loadPrefs = (): LabelPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      template: TEMPLATES.some(t => t.id === s.template) ? s.template : 'dymo-36x89',
      showBarcode: s.showBarcode !== false, // default on
      showStatus: s.showStatus !== false,   // default on
    };
  } catch {
    return { template: 'dymo-36x89', showBarcode: true, showStatus: true };
  }
};

const genBarcode = (value: string): string => {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format: 'CODE128', displayValue: false, margin: 0, height: 80, width: 2 });
    return c.toDataURL('image/png');
  } catch { return ''; }
};

export const LabelModal: React.FC<Props> = ({ item, onClose }) => {
  const [prefs, setPrefs] = useState<LabelPrefs>(loadPrefs);
  const [qr, setQr] = useState('');
  const [barcode, setBarcode] = useState('');

  const sku = item.sku || item.imei || '';
  const name = item.item || [item.brand, item.model].filter(Boolean).join(' ') || 'Item';
  const media = TEMPLATES.find(t => t.id === prefs.template)!;
  const status = item.deviceStatus ? STATUS_LABEL[item.deviceStatus] : '';

  useEffect(() => {
    // QR + barcode both encode the SKU; margin:2 gives the QR a scan quiet zone.
    QRCode.toDataURL(sku || 'N/A', { margin: 2, width: 320, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
    setBarcode(genBarcode(sku));
  }, [sku]);

  const update = (next: Partial<LabelPrefs>) => {
    setPrefs(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  const content: LabelContent = {
    org: 'FlipThatTech',
    code: sku,
    device: name,
    sub: [item.storage, item.color].filter(Boolean).join(' · ') || undefined,
    serial: item.imei || undefined,
    status: status || undefined,
  };
  const images = { qr, barcode };
  const opts = { showBarcode: prefs.showBarcode, showStatus: prefs.showStatus };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=520,height=680');
    if (!win) return;
    win.document.write(labelPrintDoc(`Label ${sku}`, media, content, images, opts));
    win.document.close();
  };

  const handlePdf = () => {
    const { w, h } = mmOf(media);
    // PDF in mm; DYMO stays landscape here since a PDF has no feed constraint.
    const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation: w > h ? 'landscape' : 'portrait' });
    const pad = media.dymo ? 1.3 : 1.6;
    const qrS = media.dymo ? h - pad * 2 - (prefs.showBarcode ? 6.5 : 0) : Math.min(w, h) * (media.h >= 3 ? 0.42 : 0.6);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.text('FlipThatTech', pad, pad + 2.6);
    pdf.setFont('courier', 'bold'); pdf.setFontSize(media.dymo ? 20 : 14); pdf.text(sku, pad, pad + 9);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(media.dymo ? 12 : 10); pdf.text(name.slice(0, 30), pad, pad + 14.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    let y = pad + 19;
    if (content.sub) { pdf.text(content.sub, pad, y); y += 4.5; }
    if (item.imei) { pdf.setFont('courier', 'bold'); pdf.setFontSize(11); pdf.text(item.imei, pad, y); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); y += 5; }
    if (prefs.showStatus && status) { pdf.setFont('helvetica', 'bold'); pdf.text(status.toUpperCase(), pad, y); pdf.setFont('helvetica', 'normal'); }
    if (qr) pdf.addImage(qr, 'PNG', w - pad - qrS, pad, qrS, qrS);
    if (prefs.showBarcode && barcode) pdf.addImage(barcode, 'PNG', pad, h - pad - 5.5, w - pad * 2, 5.5);
    pdf.save(`${sku || 'label'}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Print Label</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Label Template</p>
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map(t => (
                <button key={t.id} onClick={() => update({ template: t.id as TemplateId })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${prefs.template === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={prefs.showBarcode} onChange={e => update({ showBarcode: e.target.checked })} className="rounded" />
              Show barcode
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={prefs.showStatus} onChange={e => update({ showStatus: e.target.checked })} className="rounded" disabled={!status} />
              Show status badge{!status && <span className="text-xs text-slate-400">(no status on this item)</span>}
            </label>
          </div>

          <div className="flex justify-center bg-slate-100 dark:bg-slate-800 rounded-xl p-4 overflow-auto">
            <div dangerouslySetInnerHTML={{ __html: labelPreview(media, content, images, opts) }} />
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
