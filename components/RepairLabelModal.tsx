import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X, QrCode, FileDown, Settings, Zap, Check, AlertCircle } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { Repair } from '../types';
import { REPAIR_STATUS_LABEL } from '../domain/repairs';
import { Dpi, buildZpl } from '../services/zpl';
import { detectZebra, sendZpl, ZebraDetect } from '../services/zebra';
import { LabelContent, labelPreview, labelPrintDoc, mmOf } from '../services/labelLayout';
import { getLabelSizes } from './SettingsModal';

interface Props {
  repair: Repair;
  // For wholesale devices: the parent batch number + 1-based line number.
  context?: { batchNumber?: string; lineNumber?: number };
  onClose: () => void;
  onPrinted?: () => void;
}

type Size = string;

const genBarcode = (value: string): string => {
  try {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format: 'CODE128', displayValue: false, margin: 0, height: 80, width: 2 });
    return c.toDataURL('image/png');
  } catch { return ''; }
};

// Owner-configurable label + Zebra print settings, persisted locally (not in
// Firestore). Remembers the last selected template and optional elements.
interface LabelSettings { deviceUid?: string; dpi: Dpi; density: number | ''; defaultSize: Size; showBarcode: boolean; showStatus: boolean; }
const SETTINGS_KEY = 'ftt_zebra_print_v1';
const loadSettings = (): LabelSettings => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      dpi: s.dpi === 300 ? 300 : 203,
      density: typeof s.density === 'number' ? s.density : '',
      defaultSize: getLabelSizes().some(z => z.id === s.defaultSize) ? s.defaultSize : 'dymo-36x89',
      deviceUid: s.deviceUid,
      showBarcode: s.showBarcode !== false, // default on
      showStatus: s.showStatus !== false,   // default on
    };
  } catch {
    return { dpi: 203, density: '', defaultSize: 'dymo-36x89', showBarcode: true, showStatus: true };
  }
};

export const RepairLabelModal: React.FC<Props> = ({ repair: r, context, onClose, onPrinted }) => {
  const SIZES = useMemo(() => getLabelSizes(), []);
  const [settings, setSettings] = useState<LabelSettings>(loadSettings);
  const [size, setSize] = useState<Size>(settings.defaultSize);
  const [qr, setQr] = useState('');
  const [barcode, setBarcode] = useState('');
  const [zebra, setZebra] = useState<ZebraDetect>({ available: false, devices: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const isWholesale = r.type === 'wholesale';
  // The human-readable Repair ID (retail ticket number, or batch + line no.).
  const repairId = isWholesale
    ? `${context?.batchNumber || 'Batch'}${context?.lineNumber ? ` · #${context.lineNumber}` : ''}`
    : r.repairNumber;
  const barcodeValue = r.repairNumber || r.id;
  const device = [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
  const repairType = r.type ? `${r.type[0].toUpperCase()}${r.type.slice(1)} repair` : '';
  const statusLabel = r.status ? REPAIR_STATUS_LABEL[r.status] : '';
  const media = SIZES.find(s => s.id === size) || SIZES[0];

  useEffect(() => {
    // QR encodes the Repair ID (with a quiet zone); barcode encodes it too.
    QRCode.toDataURL(barcodeValue, { margin: 2, width: 320, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
    setBarcode(genBarcode(barcodeValue));
  }, [barcodeValue]);

  // Detect Zebra Browser Print once when the modal opens.
  useEffect(() => {
    let alive = true;
    detectZebra().then(res => {
      if (!alive) return;
      setZebra(res);
      setSettings(prev => ({ ...prev, deviceUid: prev.deviceUid && res.devices.some(d => d.uid === prev.deviceUid) ? prev.deviceUid : res.defaultUid }));
    });
    return () => { alive = false; };
  }, []);

  const selectedDevice = zebra.devices.find(d => d.uid === settings.deviceUid) || zebra.devices[0];

  const persist = (next: Partial<LabelSettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  const content: LabelContent = {
    org: 'FlipThatTech',
    code: repairId,
    device,
    sub: repairType || undefined,
    serial: r.imei || undefined,
    status: statusLabel || undefined,
  };
  const images = { qr, barcode };
  const opts = { showBarcode: settings.showBarcode, showStatus: settings.showStatus };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=520,height=680');
    if (!win) return;
    win.document.write(labelPrintDoc(`Repair Label ${r.repairNumber}`, media, content, images, opts));
    win.document.close();
    onPrinted?.();
  };

  const handleZebra = async () => {
    setStatus(null);
    const dev = selectedDevice;
    if (!zebra.host || !dev) { setStatus({ kind: 'err', msg: 'No Zebra printer selected.' }); return; }
    const zpl = buildZpl(
      { org: 'FlipThatTech', idLine: repairId, device, imei: r.imei, issue: statusLabel || r.issue, qrData: barcodeValue },
      media, settings.dpi, settings.density === '' ? undefined : settings.density,
    );
    try {
      await sendZpl(zebra.host, dev, zpl);
      setStatus({ kind: 'ok', msg: `Label sent to ${dev.name}` });
      onPrinted?.();
    } catch (e: any) {
      setStatus({ kind: 'err', msg: `Zebra print failed: ${e?.message || 'unreachable'}. Use Browser Print.` });
    }
  };

  const handlePdf = () => {
    const { w, h } = mmOf(media);
    const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation: w > h ? 'landscape' : 'portrait' });
    const pad = media.dymo ? 1.3 : 1.6;
    const qrS = media.dymo ? h - pad * 2 - (settings.showBarcode ? 6.5 : 0) : Math.min(w, h) * (media.h >= 3 ? 0.42 : 0.6);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.text('FlipThatTech', pad, pad + 2.6);
    pdf.setFont('courier', 'bold'); pdf.setFontSize(media.dymo ? 20 : 14); pdf.text(repairId.slice(0, 22), pad, pad + 9);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(media.dymo ? 12 : 10); pdf.text(device.slice(0, 30), pad, pad + 14.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    let y = pad + 19;
    if (repairType) { pdf.text(repairType, pad, y); y += 4.5; }
    if (r.imei) { pdf.setFont('courier', 'bold'); pdf.setFontSize(11); pdf.text(r.imei, pad, y); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); y += 5; }
    if (settings.showStatus && statusLabel) { pdf.setFont('helvetica', 'bold'); pdf.text(statusLabel.toUpperCase(), pad, y); pdf.setFont('helvetica', 'normal'); }
    if (qr) pdf.addImage(qr, 'PNG', w - pad - qrS, pad, qrS, qrS);
    if (settings.showBarcode && barcode) pdf.addImage(barcode, 'PNG', pad, h - pad - 5.5, w - pad * 2, 5.5);
    pdf.save(`${r.repairNumber || 'repair-label'}.pdf`);
    onPrinted?.();
  };

  const dotsW = useMemo(() => Math.round(media.w * settings.dpi), [media.w, settings.dpi]);
  const dotsH = useMemo(() => Math.round(media.h * settings.dpi), [media.h, settings.dpi]);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Repair Label</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(s => !s)} title="Printer settings" className={`p-1.5 rounded-lg ${showSettings ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}><Settings className="w-4 h-4" /></button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Label Template</p>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button key={s.id} onClick={() => { setSize(s.id); persist({ defaultSize: s.id }); setStatus(null); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${size === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={settings.showBarcode} onChange={e => persist({ showBarcode: e.target.checked })} className="rounded" />
              Show barcode (Repair ID)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={settings.showStatus} onChange={e => persist({ showStatus: e.target.checked })} className="rounded" disabled={!statusLabel} />
              Show status badge{!statusLabel && <span className="text-xs text-slate-400">(no status)</span>}
            </label>
          </div>

          {showSettings && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><Settings className="w-4 h-4" /> Printer Settings</div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Zebra Printer</label>
                {zebra.available && zebra.devices.length > 0 ? (
                  <select value={settings.deviceUid || ''} onChange={e => persist({ deviceUid: e.target.value })}
                    className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                    {zebra.devices.map(d => <option key={d.uid} value={d.uid}>{d.name} ({d.connection})</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Zebra Browser Print not detected — browser/Dymo printing will be used.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">DPI</label>
                  <select value={settings.dpi} onChange={e => persist({ dpi: Number(e.target.value) === 300 ? 300 : 203 })}
                    className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                    <option value={203}>203 dpi</option>
                    <option value={300}>300 dpi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Default Template</label>
                  <select value={settings.defaultSize} onChange={e => { persist({ defaultSize: e.target.value as Size }); setSize(e.target.value as Size); }}
                    className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                    {SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Print Density (optional, -30…30)</label>
                <input type="number" min={-30} max={30} value={settings.density}
                  onChange={e => persist({ density: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="Printer default"
                  className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
              </div>
              <p className="text-[11px] text-slate-400">Direct Zebra labels print at {dotsW}×{dotsH} dots ({media.label} @ {settings.dpi} dpi).</p>
            </div>
          )}

          <div className="flex justify-center bg-slate-100 dark:bg-slate-800 rounded-xl p-4 overflow-auto">
            <div dangerouslySetInnerHTML={{ __html: labelPreview(media, content, images, opts) }} />
          </div>

          {status && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${status.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
              {status.kind === 'ok' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {status.msg}
            </div>
          )}

          <div className="space-y-2">
            {zebra.available && zebra.devices.length > 0 && (
              <button onClick={handleZebra} className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                <Zap className="w-4 h-4" /> Print to Zebra ({media.label})
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={handlePrint} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium ${zebra.available && zebra.devices.length > 0 ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                <Printer className="w-4 h-4" /> {zebra.available && zebra.devices.length > 0 ? 'Browser Print' : 'Print'}
              </button>
              <button onClick={handlePdf} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><FileDown className="w-4 h-4" /> PDF</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
