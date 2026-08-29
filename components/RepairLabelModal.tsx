import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X, QrCode, FileDown, Settings, Zap, Check, AlertCircle } from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { Repair } from '../types';
import { REPAIR_STATUS_LABEL } from '../domain/repairs';
import { Dpi, buildZpl } from '../services/zpl';
import { detectZebra, sendZpl, ZebraDetect } from '../services/zebra';
import {
  LabelContent, LabelVariant, labelPreview, labelPrintDoc, mmOf, maxSafePushDownMm, nonDymoQrSizeMm,
  shortRepairCode, ISSUE_MAX_LINES, labelTextScale, labelQrScale,
} from '../services/labelLayout';
import { getLabelSizes, getStoreProfile, getLabelSpacing } from './SettingsModal';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  repair: Repair;
  // For wholesale devices: the parent batch's identity. `batchNumber` and
  // `lineNumber` are no longer printed on the label itself (both removed at
  // the owner's request) but are kept on the type since callers still
  // resolve them for other purposes (e.g. printSheet's device sheet).
  // `isPrivate` is RepairBatch.private (via domain/autoInventory.ts's
  // isPrivateBatch) — whether this is the shop's own stock rather than a
  // real wholesale client's — and is the ONLY one of the three this modal
  // actually reads.
  context?: { batchNumber?: string; lineNumber?: number; isPrivate?: boolean };
  onClose: () => void;
  onPrinted?: () => void;
}

type Size = string;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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
  const variant: LabelVariant = isWholesale ? 'repairWholesale' : 'repairRetail';
  // The human-readable code line on the printed tag. DISPLAY ONLY — see
  // `barcodeValue` below, which is what actually gets scanned.
  //
  //  • WHOLESALE: no code line at all any more. The owner doesn't care which
  //    batch a device came from ("remove wb-0000 whatever"), so the batch
  //    number that used to print here is gone entirely — the label's
  //    `code` field is left undefined (see LabelContent.code in
  //    services/labelLayout.ts, which skips the whole line when unset).
  //  • RETAIL: unchanged — "R" + the ticket's digits ("RPR-000123" →
  //    "R000123"), see shortRepairCode. Display-only shortening, exactly
  //    like the inventory label's shortLabelSku.
  const repairId = isWholesale ? undefined : shortRepairCode(r.repairNumber);
  // Unchanged: the barcode and QR keep encoding the FULL repair number, so a
  // scan still resolves the real ticket even though the printed line is short.
  const barcodeValue = r.repairNumber || r.id;
  // NOTE: there is deliberately no `device` line on this label any more (it
  // used to be `[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType`).
  // A repair tag is attached to the device the technician is already holding,
  // so the brand/model line was redundant — removed from all three output
  // paths (browser print, PDF, Zebra ZPL) so they stay visually consistent.
  //
  // WHOLESALE sub-line: only the shop's OWN stock (a "private"/personal
  // batch, e.g. an "FTT Personal" batch — see RepairBatch.private /
  // domain/autoInventory.ts's isPrivateBatch) gets any text here at all, and
  // it's just "Store Device" — no batch identifier, no "wholesale" wording,
  // nothing else. Every other (real, third-party) wholesale batch label
  // carries NO sub-line either ("others don't have anything on the label").
  // Deliberately rendered via `sub` (the smaller line), not `code` (the big
  // one) — the owner explicitly asked for it not to print big.
  // RETAIL: unchanged "Retail repair"/"Internal repair" wording.
  const repairType = isWholesale
    ? (context?.isPrivate ? 'Store Device' : undefined)
    : (r.type ? `${r.type[0].toUpperCase()}${r.type.slice(1)} repair` : '');
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

  useEscapeKey(onClose);

  const selectedDevice = zebra.devices.find(d => d.uid === settings.deviceUid) || zebra.devices[0];

  const persist = (next: Partial<LabelSettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  const storeName = getStoreProfile().storeName;
  // `device` is intentionally OMITTED (not passed as an empty string) — see
  // LabelContent.device in services/labelLayout.ts, which is optional purely
  // so the repair labels can leave the model line off. The wholesale label
  // additionally carries the reported issue, which the technician can't get
  // from looking at the device; the retail label doesn't (the ticket does).
  const content: LabelContent = {
    org: storeName,
    code: repairId,
    sub: repairType,
    // WHOLESALE: no full IMEI/serial line at all any more (removed at the
    // owner's request — it isn't recovered elsewhere on this label either,
    // since the "Wholesale - 1234" idea this once used was itself replaced
    // by the "Store Device"/nothing sub-line above). RETAIL keeps printing
    // the full IMEI as before; this only changes wholesale.
    serial: isWholesale ? undefined : (r.imei || undefined),
    status: statusLabel || undefined,
    issue: isWholesale ? (r.issue || undefined) : undefined,
  };
  const images = { qr, barcode };
  // Owner-configured content padding / line spacing / push-down offset
  // (Settings → Labels & Printing), applied to the non-Dymo templates only.
  // Not memoized: this must re-read on every render, not just on mount, so a
  // spacing change saved in Settings during the same session (no page
  // reload) shows up immediately next time this modal opens. It's a cheap
  // localStorage read — not worth caching at the cost of going stale.
  const spacing = getLabelSpacing();
  const opts = { showBarcode: settings.showBarcode, showStatus: settings.showStatus, padMm: spacing.paddingMm, lineGapMm: spacing.lineGapMm, pushDownMm: spacing.pushDownMm, variant };

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
    // Status only goes on the label when the toggle is on — same rule the
    // Browser Print / PDF paths already follow (settings.showStatus gates
    // `opts.showStatus` for those). Previously this always included statusLabel
    // whenever one existed, ignoring the toggle entirely.
    const issueLine = settings.showStatus ? (statusLabel || r.issue) : r.issue;
    // `device` is omitted here for the same reason it's omitted from `content`
    // above — so the Zebra output matches the browser-print and PDF output.
    // `idLine` is omitted for wholesale (no batch number on the label any
    // more); `imei` likewise (full IMEI no longer prints anywhere on this
    // label); `sub` carries the same "Store Device"/nothing text the other
    // two output paths show, so the ZPL label isn't missing it.
    const zpl = buildZpl(
      { org: storeName, idLine: repairId, sub: isWholesale ? repairType : undefined, imei: isWholesale ? undefined : r.imei, issue: issueLine, qrData: barcodeValue },
      media, settings.dpi, settings.density === '' ? undefined : settings.density,
      media.dymo ? undefined : { padMm: spacing.paddingMm, lineGapMm: spacing.lineGapMm, pushDownMm: spacing.pushDownMm },
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
    const pad = media.dymo ? 1.3 : (spacing.paddingMm ?? 2.0);
    // Shift every line's baseline down by the same fixed offset — a push,
    // not a stretch — so the "Push content down" setting spreads the PDF
    // layout the same way it does the HTML/print preview, without changing
    // the spacing between lines. Clamped to the same content-aware ceiling
    // as labelLayout.ts's HTML path (services/labelLayout.ts —
    // maxSafePushDownMm) — this used to be unclamped here, so a stored value
    // beyond what's actually safe would push content past the label's
    // bottom edge in the PDF export with no guard at all.
    const pushDown = media.dymo ? 0 : clamp(spacing.pushDownMm ?? 0, 0,
      maxSafePushDownMm(media, content, { padMm: spacing.paddingMm, lineGapMm: spacing.lineGapMm, showBarcode: settings.showBarcode, hasBarcodeImage: !!barcode, variant }));
    // Same clamp as labelBody's lineGap — the extra distance above the
    // 1.1mm known-good default is added between each line so "Line spacing"
    // spreads the PDF layout the same way it does the HTML preview/print.
    const lineGapExtra = media.dymo ? 0 : (Math.min(1.5, Math.max(0, spacing.lineGapMm ?? 1.1)) - 1.1);
    // Type scale + QR scale come from services/labelLayout.ts (labelTextScale /
    // labelQrScale) rather than being re-tuned here, so this hand-laid-out PDF
    // and the HTML/print path shrink and grow by exactly the same factors —
    // the retail tag's slightly larger type, the wholesale tag's smaller type,
    // and the repair tags' ~35%-smaller QR all reach the PDF automatically.
    const ts = labelTextScale(variant);
    const pt = (n: number) => +(n * ts).toFixed(1);
    const qrS = (media.dymo ? h - pad * 2 - (settings.showBarcode ? 6.5 : 0) : nonDymoQrSizeMm(media)) * labelQrScale(variant);
    // Text column stops before the QR so a wrapped value never runs under it —
    // matches the flex row's real width in the HTML preview/print path.
    const colW = media.dymo ? undefined : Math.max(10, w - pad * 2 - (qr ? qrS + 2 : 0));
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(pt(7)); pdf.text(storeName, pad, pad + 2.6 + pushDown);
    // The id/code line — WHOLESALE no longer has one (see `repairId` above),
    // same "conditional line, reclaim its slot" pattern the device line
    // below already uses: when it's skipped, the next line starts right
    // after `org` (pad + 9) instead of leaving the ~5.5mm the code line
    // would have taken as a blank gap.
    let y: number;
    if (repairId) {
      pdf.setFont('courier', 'bold'); pdf.setFontSize(pt(media.dymo ? 20 : 14));
      const idLineH = media.dymo ? 7 : 5;
      const idLines = colW ? (pdf.splitTextToSize(repairId.slice(0, 22), colW) as string[]).slice(0, 2) : [repairId.slice(0, 22)];
      idLines.forEach((ln, i) => pdf.text(ln, pad, pad + 9 + pushDown + i * idLineH));
      const idExtra = (idLines.length - 1) * idLineH;
      // The device/model line used to be drawn here, at `pad + 14.5 + pushDown`,
      // with the next line starting 4.5mm below it at `pad + 19`. It's gone from
      // this label (see the note by `barcodeValue` above), so everything below it
      // moves UP into its slot — starting the cursor at 14.5 rather than 19 —
      // instead of leaving a 4.5mm hole where the model used to be.
      y = pad + 14.5 + pushDown + idExtra;
    } else {
      y = pad + 9 + pushDown;
    }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(pt(8));
    if (repairType) { pdf.text(repairType, pad, y); y += 4.5 + lineGapExtra; }
    if (!isWholesale && r.imei) {
      // WHOLESALE never reaches this block any more — the full IMEI is not
      // printed anywhere on that label. RETAIL is unchanged.
      // Safety net (Fix 3): a 15-digit IMEI that doesn't fit the column wraps
      // to a 2nd line instead of running under the QR/off the edge — never
      // truncated. Capped at 2 lines, same rule the HTML path follows.
      pdf.setFont('courier', 'bold'); pdf.setFontSize(pt(11));
      const imeiLines = colW ? (pdf.splitTextToSize(r.imei, colW) as string[]).slice(0, 2) : [r.imei];
      imeiLines.forEach((ln, i) => pdf.text(ln, pad, y + i * 5));
      y += imeiLines.length * 5 + lineGapExtra;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(pt(8));
    }
    if (settings.showStatus && statusLabel) { pdf.setFont('helvetica', 'bold'); pdf.text(statusLabel.toUpperCase(), pad, y); pdf.setFont('helvetica', 'normal'); y += 4.5 + lineGapExtra; }
    if (content.issue) {
      // Wholesale only: the reported issue, WRAPPED (splitTextToSize — the
      // same mechanism this function already uses for a long repair id and a
      // long IMEI) rather than truncated to one clipped line, capped at the
      // same ISSUE_MAX_LINES the HTML path caps at. It runs the FULL label
      // width — like the HTML path's full-width issue row — except when it
      // would still be beside the QR, in which case it stays inside the text
      // column so it can never print underneath the QR bitmap.
      const issueW = (colW && y < pad + qrS) ? colW : w - pad * 2;
      pdf.setFontSize(pt(8));
      const issueLines = (pdf.splitTextToSize(content.issue, issueW) as string[]).slice(0, ISSUE_MAX_LINES);
      issueLines.forEach((ln, i) => pdf.text(ln, pad, y + i * 3.6));
    }
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
