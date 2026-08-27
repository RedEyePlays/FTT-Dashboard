import React, { useRef, useState, useEffect, useCallback } from 'react';
import { QrCode, X, Loader2 } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  onScan: (value: string) => void;
  onClose: () => void;
}

export const QRScanner: React.FC<Props> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  // Callers pass onScan/onClose as inline arrow functions (a fresh identity
  // every render). Keeping those directly in the mount effect's dependency
  // array would tear the camera down and re-request getUserMedia on every
  // parent re-render — on a slow permission prompt or a parent that
  // re-renders while the modal is open, that can restart the request loop
  // fast enough that the camera never visibly opens. Refs give the effect a
  // stable identity to close over while always calling the latest callback.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  const scan = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scan);
      return;
    }

    // Try BarcodeDetector API first (Chrome 83+)
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore
        const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a'] });
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          const value = codes[0].rawValue;
          setDetected(value);
          stopCamera();
          setTimeout(() => {
            onScanRef.current(value);
            onCloseRef.current();
          }, 600);
          return;
        }
      } catch (_) {}
    } else {
      // Fallback: draw to canvas and use jsQR if available (graceful degradation)
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
    }

    rafRef.current = requestAnimationFrame(scan);
  }, [stopCamera]);

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsStreaming(true);
            rafRef.current = requestAnimationFrame(scan);
          };
        }
      } catch {
        setError('Could not access camera. Please allow camera permissions.');
      }
    };
    start();
    return () => stopCamera();
    // Runs once on mount / cleans up once on unmount — see the onScanRef/
    // onCloseRef comment above for why props aren't in this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(() => { stopCamera(); onCloseRef.current(); }, [stopCamera]);

  useEscapeKey(handleClose);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="p-4 flex justify-between items-center border-b border-slate-800">
          <div className="text-white font-medium flex items-center gap-2">
            <QrCode className="w-5 h-5 text-indigo-400" />
            <span>Scan QR / Barcode</span>
          </div>
          <button onClick={handleClose} className="text-white/80 hover:text-white bg-black/40 p-1.5 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewport */}
        <div className="relative aspect-square bg-black flex items-center justify-center">
          {!isStreaming && !error && <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />}

          {error && (
            <div className="text-center p-6">
              <p className="text-rose-400 mb-2 font-bold">Camera Error</p>
              <p className="text-slate-300 text-sm">{error}</p>
            </div>
          )}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isStreaming ? 'opacity-100' : 'opacity-0'}`}
          />

          {isStreaming && !detected && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-56 border-2 border-indigo-400/80 rounded-xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-indigo-500 -mt-0.5 -ml-0.5 rounded-tl"></div>
                <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-indigo-500 -mt-0.5 -mr-0.5 rounded-tr"></div>
                <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-indigo-500 -mb-0.5 -ml-0.5 rounded-bl"></div>
                <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-indigo-500 -mb-0.5 -mr-0.5 rounded-br"></div>
              </div>
              <p className="absolute bottom-8 text-white/70 text-xs bg-black/50 px-3 py-1 rounded-full">
                Scanning automatically…
              </p>
            </div>
          )}

          {detected && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-semibold text-center">
                ✓ Detected!<br />
                <span className="text-sm font-normal opacity-90">{detected}</span>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="p-4 text-center text-slate-400 text-xs border-t border-slate-800">
          Point the camera at a QR code or barcode — it will scan automatically
        </div>
      </div>
    </div>
  );
};
