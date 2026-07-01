import React, { useEffect, useRef, useState } from 'react';
import { Printer, X, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

interface Props {
  imei: string;
  itemName?: string;
  onClose: () => void;
}

export const QRLabel: React.FC<Props> = ({ imei, itemName, onClose }) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const printFrame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!imei) {
      setError('This item has no IMEI / serial to encode.');
      return;
    }
    QRCode.toDataURL(imei, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
      .then(setDataUrl)
      .catch(() => setError('Failed to generate QR code.'));
  }, [imei]);

  const handlePrint = () => {
    if (!dataUrl) return;
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>IMEI Label — ${imei}</title>
          <style>
            @page { margin: 8mm; }
            body { font-family: 'Inter', system-ui, sans-serif; text-align: center;
                   display: flex; flex-direction: column; align-items: center;
                   justify-content: center; height: 100vh; margin: 0; }
            .label { border: 1px solid #000; padding: 12px 16px; border-radius: 6px;
                     display: inline-block; }
            img { width: 180px; height: 180px; display: block; margin: 0 auto; }
            .item { font-size: 12px; font-weight: 600; margin-bottom: 6px; max-width: 180px;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .imei { font-size: 14px; font-weight: 700; letter-spacing: 1px;
                    margin-top: 8px; font-family: 'Courier New', monospace; }
          </style>
        </head>
        <body>
          <div class="label">
            ${itemName ? `<div class="item">${itemName}</div>` : ''}
            <img src="${dataUrl}" alt="QR for ${imei}" />
            <div class="imei">${imei}</div>
          </div>
          <script>
            window.onload = function () { window.print(); setTimeout(function(){ window.close(); }, 300); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-indigo-500" /> IMEI Label
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center gap-4">
          {error && <p className="text-rose-500 text-sm text-center py-8">{error}</p>}

          {!error && (
            <>
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white">
                {dataUrl
                  ? <img src={dataUrl} alt="IMEI QR" className="w-44 h-44" />
                  : <div className="w-44 h-44 flex items-center justify-center text-slate-300 text-sm">Generating…</div>
                }
                <p className="text-center font-mono font-bold tracking-wider text-slate-800 mt-2 text-sm">{imei}</p>
              </div>

              <button
                onClick={handlePrint}
                disabled={!dataUrl}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Printer className="w-4 h-4" /> Print Label
              </button>
            </>
          )}
        </div>
      </div>
      <iframe ref={printFrame} className="hidden" title="print" />
    </div>
  );
};
