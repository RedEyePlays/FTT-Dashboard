import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X, QrCode, FileDown } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { InventoryItem, DeviceStatus } from '../types';
import { getDeviceDisplayName, kindOf } from '../domain/inventory';
import { LabelContent, labelPreview, labelPrintDoc, mmOf } from '../services/labelLayout';
import { getLabelSizes } from './SettingsModal';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

// Label templates come from the shared, user-editable list (built-in presets +
// custom sizes added in Settings). Dymo 36 × 89 mm is the primary/default.
type TemplateId = string;

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
    const sizes = getLabelSizes();
    return {
      template: sizes.some(t => t.id === s.template) ? s.template : (sizes[0]?.id || 'dymo-36x89'),
      showBarcode: s.showBarcode !== false, // default on
      showStatus: s.showStatus !== false,   // default on
    };
  } catch {
    return { template: 'dymo-36x89', showBarcode: true, showStatus: true };
  }
};

// Pick a retail symbology for a plain numeric UPC/EAN; otherwise CODE128.
const barcodeFormat = (v: string): string =>
  /^\d{12}$/.test(v) ? 'UPC' : /^\d{13}$/.test(v) ? 'EAN13' : /^\d{8}$/.test(v) ? 'EAN8' : 'CODE128';

const genBarcode = (value: string, opts?: { format?: string; displayValue?: boolean }): string => {
  const displayValue = opts?.displayValue ?? false;
  const render = (format: string): string => {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format, displayValue, margin: displayValue ? 6 : 0, height: 90, width: 2, fontSize: 20, textMargin: 2 });
    return c.toDataURL('image/png');
  };
  try { return render(opts?.format || 'CODE128'); }
  // A value that doesn't fit the chosen retail symbology falls back to CODE128.
  catch { try { return render('CODE128'); } catch { return ''; } }
};

export const LabelModal: React.FC<Props> = ({ item, onClose }) => {
  const templates = useMemo(() => getLabelSizes(), []);
  const [prefs, setPrefs] = useState<LabelPrefs>(loadPrefs);
  const [qr, setQr] = useState('');
  const [barcode, setBarcode] = useState('');

  const isAccessory = kindOf(item) === 'accessory';
  const sku = item.sku || item.imei || '';
  // Accessories print a UPC barcode only — prefer the manufacturer UPC.
  const upc = (item.manufacturerBarcode || item.sku || '').trim();
  const dn = getDeviceDisplayName(item);
  const name = dn === '—' ? 'Item' : dn;
  const media = templates.find(t => t.id === prefs.template) || templates[0];
  const status = item.deviceStatus ? STATUS_LABEL[item.deviceStatus] : '';

  useEffect(() => {
    if (isAccessory) {
      // UPC barcode only: encode the manufacturer UPC with readable digits, no QR.
      setQr('');
      setBarcode(genBarcode(upc || sku, { format: barcodeFormat(upc || sku), displayValue: true }));
      return;
    }
    // Devices: QR + optional CODE128 barcode, both encoding the SKU.
    QRCode.toDataURL(sku || 'N/A', { margin: 2, width: 320, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
    setBarcode(genBarcode(sku));
  }, [sku, upc, isAccessory]);

  const update = (next: Partial<LabelPrefs>) => {
    setPrefs(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  const content: LabelContent = {
    org: 'FlipThatTech',
    code: isAccessory ? (upc || sku) : sku,
    device: name,
    sub: [item.storage, item.color].filter(Boolean).join(' · ') || undefined,
    serial: item.imei || undefined,
    status: status || undefined,
  };
  const images = { qr: isAccessory ? '' : qr, barcode };
  // Accessories: barcode-only label (no QR / text / status).
  const opts = isAccessory
    ? { showBarcode: true, showStatus: false, barcodeOnly: true }
    : { showBarcode: prefs.showBarcode, showStatus: prefs.showStatus };

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

    if (isAccessory) {
      // UPC barcode only, centered, proportionally scaled to the label.
      const pad = 2;
      if (barcode) {
        const bw = w - pad * 2;
        const bh = Math.min(h - pad * 2, bw * 0.5);
        pdf.addImage(barcode, 'PNG', pad, (h - bh) / 2, bw, bh);
      }
      pdf.save(`${upc || sku || 'label'}.pdf`);
      return;
    }

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
              {templates.map(t => (
                <button key={t.id} onClick={() => update({ template: t.id as TemplateId })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${prefs.template === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {isAccessory ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
              Accessory labels print the <span className="font-semibold">UPC barcode only</span> ({barcodeFormat(upc || sku) === 'CODE128' ? 'CODE128' : barcodeFormat(upc || sku)}) from {item.manufacturerBarcode ? 'the manufacturer barcode' : 'the SKU'}.
            </div>
          ) : (
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
          )}

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
