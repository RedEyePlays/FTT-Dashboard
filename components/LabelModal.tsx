import React, { useEffect, useState } from 'react';
import { Printer, X, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { InventoryItem } from '../types';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

// Prints an internal SKU/QR label. Devices show SKU + IMEI + QR;
// accessories show SKU + name + QR. The QR encodes the SKU (fallback IMEI).
export const LabelModal: React.FC<Props> = ({ item, onClose }) => {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isDevice = (item.kind ?? 'device') === 'device';
  const codeValue = item.sku || item.imei || item.manufacturerBarcode || '';

  useEffect(() => {
    if (!codeValue) { setError('This item has no SKU / code to encode.'); return; }
    QRCode.toDataURL(codeValue, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
      .then(setDataUrl).catch(() => setError('Failed to generate QR code.'));
  }, [codeValue]);

  const handlePrint = () => {
    if (!dataUrl) return;
    const win = window.open('', '_blank', 'width=400,height=520');
    if (!win) return;
    const line2 = isDevice ? (item.imei || '') : (item.item || '');
    win.document.write(`
      <html><head><title>Label — ${item.sku || codeValue}</title>
      <style>
        @page { margin: 6mm; }
        body { font-family: 'Inter', system-ui, sans-serif; text-align:center;
               display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
        .label { border:1px solid #000; border-radius:6px; padding:12px 16px; display:inline-block; }
        .sku { font-size:15px; font-weight:800; letter-spacing:1px; font-family:'Courier New',monospace; }
        img { width:170px; height:170px; display:block; margin:8px auto 4px; }
        .line2 { font-size:12px; font-weight:600; max-width:180px; margin:0 auto;
                 overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      </style></head>
      <body><div class="label">
        <div class="sku">${item.sku || codeValue}</div>
        <img src="${dataUrl}" />
        ${line2 ? `<div class="line2">${line2}</div>` : ''}
      </div>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-indigo-500" /> {isDevice ? 'Device Label' : 'SKU Label'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          {error && <p className="text-rose-500 text-sm text-center py-8">{error}</p>}
          {!error && (
            <>
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white text-center">
                <p className="font-mono font-extrabold tracking-wider text-slate-800 text-sm">{item.sku || codeValue}</p>
                {dataUrl
                  ? <img src={dataUrl} alt="label QR" className="w-40 h-40 mx-auto my-1" />
                  : <div className="w-40 h-40 flex items-center justify-center text-slate-300 text-sm">Generating…</div>}
                <p className="text-slate-700 text-xs font-semibold truncate max-w-[170px]">{isDevice ? item.imei : item.item}</p>
              </div>
              {!isDevice && item.manufacturerBarcode && (
                <p className="text-xs text-slate-400 text-center">Manufacturer barcode on file: <span className="font-mono">{item.manufacturerBarcode}</span></p>
              )}
              <button onClick={handlePrint} disabled={!dataUrl}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors">
                <Printer className="w-4 h-4" /> Print Internal SKU Label
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
