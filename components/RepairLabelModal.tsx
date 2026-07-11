import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X, QrCode, FileDown, Settings, Zap, Check, AlertCircle, Activity } from 'lucide-react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Repair } from '../types';
import { LABEL_SIZES, LabelSizeId, Dpi, buildZpl } from '../services/zpl';
import { detectZebra, sendZpl, probeModel, inferLanguage, zplBytes, ZebraDetect } from '../services/zebra';

// Smallest valid ZPL for a 2x1 @ 203 dpi label — used by the Print Test Label
// diagnostic to isolate the printer/media path from our generated ZPL.
const TEST_ZPL = [
  '^XA',
  '^PW406',
  '^LL203',
  '^FO20,20^A0N,30,30^FDFlipThatTech Test^FS',
  '^FO20,70^BQN,2,4^FDLA,TEST-123^FS',
  '^XZ',
].join('\n');

interface Props {
  repair: Repair;
  // For wholesale devices: the parent batch number + 1-based line number.
  context?: { batchNumber?: string; lineNumber?: number };
  onClose: () => void;
  onPrinted?: () => void;
}

type Size = LabelSizeId;
const SIZES = LABEL_SIZES;

const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

// Owner-configurable Zebra print settings, persisted locally (not in Firestore).
interface ZebraSettings { deviceUid?: string; dpi: Dpi; density: number | ''; defaultSize: Size; }
const SETTINGS_KEY = 'ftt_zebra_print_v1';
const loadSettings = (): ZebraSettings => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { dpi: s.dpi === 300 ? 300 : 203, density: typeof s.density === 'number' ? s.density : '', defaultSize: SIZES.some(z => z.id === s.defaultSize) ? s.defaultSize : '2x1', deviceUid: s.deviceUid };
  } catch {
    return { dpi: 203, density: '', defaultSize: '2x1' };
  }
};

export const RepairLabelModal: React.FC<Props> = ({ repair: r, context, onClose, onPrinted }) => {
  const [settings, setSettings] = useState<ZebraSettings>(loadSettings);
  const [size, setSize] = useState<Size>(settings.defaultSize);
  const [qr, setQr] = useState('');
  const [zebra, setZebra] = useState<ZebraDetect>({ available: false, devices: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Temporary diagnostics to isolate where Zebra printing is failing.
  const [diag, setDiag] = useState<{
    language: 'ZPL' | 'EPL' | 'unknown';
    model?: string;
    path?: 'Direct Zebra ZPL' | 'Browser HTML fallback';
    endpoint?: string;
    lastResult?: string;
    zplLen?: number;
  }>({ language: 'unknown' });

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

  // Probe the selected printer's control language (best-effort ~HI round-trip).
  useEffect(() => {
    if (!zebra.host || !selectedDevice) { setDiag(d => ({ ...d, language: 'unknown', model: undefined })); return; }
    let alive = true;
    probeModel(zebra.host, selectedDevice).then(model => {
      if (!alive) return;
      setDiag(d => ({ ...d, model: model || undefined, language: inferLanguage(model) }));
    });
    return () => { alive = false; };
  }, [zebra.host, selectedDevice?.uid]);

  const persist = (next: Partial<ZebraSettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  // Render the label using a unit suffix ("px" for the on-screen preview, "in"
  // for print). Physical inch units keep the print output DPI-independent so it
  // fills the label exactly on a Zebra thermal printer regardless of driver DPI.
  const labelHtml = (unit: 'px' | 'in', scale: number) => {
    const u = (n: number) => `${+(n * scale).toFixed(4)}${unit}`;
    const w = dims.w, h = dims.h;
    const pad = 0.06;
    const big = dims.w >= 4 ? 0.2 : 0.13;
    const mid = dims.w >= 4 ? 0.12 : 0.085;
    const small = dims.w >= 4 ? 0.095 : 0.07;
    const qrSize = Math.min(w, h) * (dims.h >= 3 ? 0.4 : 0.62);
    // Solid black on white with no decorative border: thermal heads print 1-bit.
    const border = unit === 'px' ? 'border:1px solid #e5e7eb;' : '';
    // For print the label is absolutely anchored at the top-left of the page box.
    const pos = unit === 'in' ? 'position:absolute;top:0;left:0;' : '';
    return `
      <div style="box-sizing:border-box;${pos}width:${u(w)};height:${u(h)};padding:${u(pad)};
        font-family:'Inter',system-ui,Arial,sans-serif;color:#000;background:#fff;${border}
        display:flex;gap:${u(pad)};overflow:hidden;">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(pad / 3)};">
          <div style="font-weight:800;font-size:${u(small)};letter-spacing:.5px;">FlipThatTech</div>
          <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(big)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(idLine)}</div>
          <div style="font-weight:700;font-size:${u(mid)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(device)}</div>
          ${r.imei ? `<div style="font-size:${u(small)};font-family:'Courier New',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.imei)}</div>` : ''}
          ${r.issue ? `<div style="font-size:${u(small)};color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.issue)}</div>` : ''}
        </div>
        ${qr ? `<img src="${qr}" style="width:${u(qrSize)};height:${u(qrSize)};align-self:center;" />` : ''}
      </div>`;
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=500,height=650');
    if (!win) return;
    // The print document IS the label: @page box equals the label size (landscape
    // geometry when wider than tall, e.g. 2x1); html/body match those physical
    // dimensions with zero margin/padding and overflow hidden; no border; and the
    // label is anchored top-left rather than centered on a larger sheet. Browsers
    // still can't override a driver's fixed media, so this is the fallback path —
    // direct ZPL (below) is exact.
    const orient = dims.w > dims.h ? ' /* landscape: width > height */' : '';
    win.document.write(`<!DOCTYPE html><html><head><title>Repair Label ${esc(r.repairNumber)}</title>
      <meta name="viewport" content="width=${dims.w}in">
      <style>
        @page { size: ${dims.w}in ${dims.h}in; margin: 0;${orient} }
        html, body { margin: 0; padding: 0; width: ${dims.w}in; height: ${dims.h}in; overflow: hidden; background: #fff; }
        body { position: relative; -webkit-font-smoothing: none; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      </style>
      </head><body>${labelHtml('in', 1)}
      <script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
    setDiag(d => ({ ...d, path: 'Browser HTML fallback', endpoint: 'window.print()', lastResult: 'Opened browser print dialog', zplLen: undefined }));
    onPrinted?.();
  };

  // Shared ZPL transport used by both the real label and the test label, so the
  // diagnostic panel reflects whichever was sent last.
  const sendToZebra = async (zpl: string, label: string) => {
    setStatus(null);
    const dev = selectedDevice;
    const endpoint = zebra.host ? `${zebra.host}/write` : '(no host)';
    setDiag(d => ({ ...d, path: 'Direct Zebra ZPL', endpoint, zplLen: zplBytes(zpl) }));
    if (!zebra.host || !dev) {
      setDiag(d => ({ ...d, lastResult: 'No Zebra printer selected.' }));
      setStatus({ kind: 'err', msg: 'No Zebra printer selected.' });
      return;
    }
    try {
      const res = await sendZpl(zebra.host, dev, zpl);
      setDiag(d => ({ ...d, lastResult: `OK (${res ? res.slice(0, 120) : 'empty 2xx response'})` }));
      setStatus({ kind: 'ok', msg: `${label} sent to ${dev.name}` });
      onPrinted?.();
    } catch (e: any) {
      setDiag(d => ({ ...d, lastResult: `ERROR: ${e?.message || 'unreachable'}` }));
      setStatus({ kind: 'err', msg: `Zebra print failed: ${e?.message || 'unreachable'}. Use Browser Print.` });
    }
  };

  const handleZebra = () => sendToZebra(
    buildZpl(
      { org: 'FlipThatTech', idLine, device, imei: r.imei, issue: r.issue, qrData: r.id },
      dims, settings.dpi, settings.density === '' ? undefined : settings.density,
    ),
    'Label',
  );

  const handleTest = () => sendToZebra(TEST_ZPL, 'Test label');

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
  const dotsW = useMemo(() => Math.round(dims.w * settings.dpi), [dims.w, settings.dpi]);
  const dotsH = useMemo(() => Math.round(dims.h * settings.dpi), [dims.h, settings.dpi]);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><QrCode className="w-5 h-5 text-indigo-500" /> Repair QR Label</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(s => !s)} title="Printer settings" className={`p-1.5 rounded-lg ${showSettings ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}><Settings className="w-4 h-4" /></button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Label Size</p>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button key={s.id} onClick={() => { setSize(s.id); setStatus(null); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${size === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                  {s.label}
                </button>
              ))}
            </div>
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
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Zebra Browser Print not detected — browser printing will be used.</p>
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
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Default Size</label>
                  <select value={settings.defaultSize} onChange={e => persist({ defaultSize: e.target.value as Size })}
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
              <p className="text-[11px] text-slate-400">Direct labels print at {dotsW}×{dotsH} dots ({dims.label.replace(/"/g, 'in')} @ {settings.dpi} dpi).</p>
            </div>
          )}

          <div className="flex justify-center bg-slate-100 dark:bg-slate-800 rounded-xl p-4">
            <div dangerouslySetInnerHTML={{ __html: labelHtml('px', previewPpi) }} />
          </div>

          {/* Temporary diagnostics panel — isolates detection / language / endpoint / ZPL / media. */}
          <div className="rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400"><Activity className="w-3.5 h-3.5" /> Diagnostics (temporary)</div>
            <dl className="text-[11px] leading-relaxed grid grid-cols-[auto,1fr] gap-x-3 text-slate-600 dark:text-slate-300 font-mono">
              <dt className="text-slate-400">Browser Print detected</dt><dd>{zebra.available ? 'yes' : 'no'}</dd>
              <dt className="text-slate-400">Printer name</dt><dd>{selectedDevice?.name || '—'}</dd>
              <dt className="text-slate-400">Connection type</dt><dd>{selectedDevice?.connection || '—'}</dd>
              <dt className="text-slate-400">Language reported</dt><dd>{diag.language}{diag.model ? ` (${diag.model.slice(0, 40)})` : ''}</dd>
              <dt className="text-slate-400">DPI selected</dt><dd>{settings.dpi}</dd>
              <dt className="text-slate-400">Label size selected</dt><dd>{dims.label} ({dotsW}×{dotsH} dots)</dd>
              <dt className="text-slate-400">Print path used</dt><dd>{diag.path || '—'}</dd>
              <dt className="text-slate-400">Last endpoint</dt><dd className="break-all">{diag.endpoint || '—'}</dd>
              <dt className="text-slate-400">Last response/error</dt><dd className="break-all">{diag.lastResult || '—'}</dd>
              <dt className="text-slate-400">ZPL byte length</dt><dd>{diag.zplLen ?? '—'}</dd>
            </dl>
            <button onClick={handleTest} disabled={!zebra.available || !selectedDevice}
              className="mt-1 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white">
              <Zap className="w-3.5 h-3.5" /> Print Test Label (minimal ZPL, 2×1 @ 203 dpi)
            </button>
          </div>

          {status && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${status.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
              {status.kind === 'ok' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {status.msg}
            </div>
          )}

          <div className="space-y-2">
            {zebra.available && zebra.devices.length > 0 && (
              <button onClick={handleZebra} className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                <Zap className="w-4 h-4" /> Print to Zebra ({dims.label.replace(/"/g, '')})
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={handlePrint} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium ${zebra.available && zebra.devices.length > 0 ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                <Printer className="w-4 h-4" /> Browser Print
              </button>
              <button onClick={handlePdf} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><FileDown className="w-4 h-4" /> PDF</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
