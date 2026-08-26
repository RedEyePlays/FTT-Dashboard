import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, X, Loader2, Sparkles, RotateCcw, ShieldAlert, CheckCircle2, ScanBarcode, ScanText } from 'lucide-react';
import { extractImeiFromImage } from '../services/geminiService';
import { detectBarcodes, isBarcodeDetectionSupported } from '../services/imeiBarcode';
import { runOcrTier } from '../services/imeiOcr';
import {
  ScannedField, ScanTier, classifyScannedValues, validateExtractedFields, mergeScannedFields,
} from '../domain/imeiScan';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface ImeiScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

const TIER_LABEL: Record<ScanTier, string> = { barcode: 'scanned', ocr: 'read on-device', ai: 'read with AI' };
const TIER_ICON: Record<ScanTier, React.ReactNode> = {
  barcode: <ScanBarcode className="w-3.5 h-3.5" />, ocr: <ScanText className="w-3.5 h-3.5" />, ai: <Sparkles className="w-3.5 h-3.5" />,
};

// A center crop of the captured frame, roughly matching the on-screen guide
// box — OCR accuracy improves noticeably when it isn't also trying to read
// whatever's outside the label/screen the user framed.
function cropToRegionOfInterest(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = Math.round(source.width * 0.85);
  const h = Math.round(source.height * 0.4);
  const x = Math.round((source.width - w) / 2);
  const y = Math.round((source.height - h) / 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (ctx) ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  return out;
}

/**
 * Three-tier camera scanner: (1) the browser's native BarcodeDetector, free
 * and instant — tried live off the video stream and, as a backstop, once
 * more on the captured frame; (2) on-device OCR (native TextDetector, else
 * tesseract.js lazy-loaded on first use), still free and offline; (3) Gemini,
 * only when both of the above find nothing. Each tier's candidates are run
 * through domain/imeiScan.ts's classification/validation before ever being
 * shown as a usable field, so a misread never gets silently accepted.
 */
export const ImeiScanner: React.FC<ImeiScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'live' | 'result'>('live');
  const [fields, setFields] = useState<ScannedField[]>([]);
  const [lastTier, setLastTier] = useState<ScanTier | null>(null);
  const liveScanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveScanBusy = useRef(false);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      stopLiveBarcodeLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch (err) {
      setError("Could not access camera. Please allow permissions.");
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  };

  const stopLiveBarcodeLoop = () => {
    if (liveScanTimer.current) {
      clearInterval(liveScanTimer.current);
      liveScanTimer.current = null;
    }
  };

  const handleClose = () => { stopCamera(); stopLiveBarcodeLoop(); onClose(); };

  useEscapeKey(handleClose);

  // Applies a tier's result: merges into whatever earlier shots already
  // found, auto-fills and closes for the simple single-verified-value case
  // (no extra step for the common path), otherwise shows the field list for
  // the user to pick from.
  const applyTierResult = useCallback((tier: ScanTier, newFields: ScannedField[]) => {
    setFields(prev => {
      const merged = mergeScannedFields(prev, newFields);
      if (merged.length === 1 && merged[0].verified) {
        onScan(merged[0].value);
        handleClose();
        return merged;
      }
      setLastTier(tier);
      setPhase('result');
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScan]);

  // Tier 1, live: polls the raw video stream for a barcode every ~600ms
  // while the modal sits in the live view. Feature-detected — silently never
  // starts if BarcodeDetector isn't supported (notably variable on iOS/
  // iPadOS Safari).
  useEffect(() => {
    if (!isStreaming || phase !== 'live' || !isBarcodeDetectionSupported()) return;
    liveScanTimer.current = setInterval(async () => {
      if (liveScanBusy.current || !videoRef.current || isProcessing) return;
      liveScanBusy.current = true;
      try {
        const raws = await detectBarcodes(videoRef.current);
        const classified = classifyScannedValues(raws);
        if (classified.length) {
          stopLiveBarcodeLoop();
          applyTierResult('barcode', classified);
        }
      } finally {
        liveScanBusy.current = false;
      }
    }, 600);
    return stopLiveBarcodeLoop;
  }, [isStreaming, phase, isProcessing, applyTierResult]);

  const captureFrame = (): HTMLCanvasElement | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const runAiTier = async (canvas: HTMLCanvasElement): Promise<boolean> => {
    setProcessingLabel('Reading with AI…');
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);
    const raw = await extractImeiFromImage(base64Image);
    const classified = validateExtractedFields(raw);
    if (classified.length) {
      applyTierResult('ai', classified);
      return true;
    }
    return false;
  };

  const handleCapture = async () => {
    stopLiveBarcodeLoop();
    setIsProcessing(true);
    setProcessingLabel('');
    setError(null);

    try {
      const canvas = captureFrame();
      if (!canvas) { setError('Failed to process image.'); return; }

      // Tier 1 backstop: a barcode that never registered during the live
      // loop (or the loop wasn't supported) might still be caught on the
      // exact captured frame.
      const barcodeRaws = await detectBarcodes(canvas);
      const barcodeFields = classifyScannedValues(barcodeRaws);
      if (barcodeFields.length) { applyTierResult('barcode', barcodeFields); return; } // STOP — no further calls

      // Tier 2: on-device OCR, still free/offline.
      const ocrTokens = await runOcrTier(cropToRegionOfInterest(canvas));
      const ocrFields = classifyScannedValues(ocrTokens);
      if (ocrFields.length) { applyTierResult('ocr', ocrFields); return; }

      // Tier 3: Gemini, last resort.
      const gotAi = await runAiTier(canvas);
      if (!gotAi) setError('No IMEI or serial detected. Try moving closer, reducing glare, or use "Scan with AI".');
    } catch (err) {
      setError('Failed to process image.');
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  // Manual escape hatch (item 1's explicit ask): skip straight to Gemini when
  // the user already knows the on-device tiers will fail (bad glare, an
  // unusual layout).
  const handleUseAi = async () => {
    stopLiveBarcodeLoop();
    setIsProcessing(true);
    setError(null);
    try {
      const canvas = captureFrame();
      if (!canvas) { setError('Failed to process image.'); return; }
      const gotAi = await runAiTier(canvas);
      if (!gotAi) setError('No IMEI or serial detected by AI either. Try a clearer, closer shot.');
    } catch (err) {
      setError('Failed to process image.');
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  // Retake / multi-shot (item 5): back to the live view without losing
  // whatever's already been found — a second capture can fill in a field the
  // first one missed (serial on the box, IMEI on the screen).
  const handleScanAgain = () => {
    setPhase('live');
    setError(null);
  };

  const handlePickField = (field: ScannedField) => {
    onScan(field.value);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden border border-slate-700 relative">

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
          <div className="text-white font-medium flex items-center gap-2">
            <Camera className="w-5 h-5 text-indigo-400" />
            <span>Scan IMEI/Serial</span>
          </div>
          <button onClick={handleClose} className="text-white/80 hover:text-white bg-black/40 p-1.5 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Video/canvas stay mounted across both phases — the camera stream
            must survive into 'result' so "Scan Again" and the result-phase
            "Use AI" button don't have to reacquire it. */}
        <div className="relative aspect-[3/4] bg-black flex items-center justify-center">
          {!isStreaming && !error && <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />}

          {error && phase === 'live' && (
            <div className="text-center p-6">
              <p className="text-rose-400 mb-2 font-bold">{isStreaming ? 'No match' : 'Error'}</p>
              <p className="text-slate-300 text-sm">{error}</p>
              {!isStreaming && <button onClick={startCamera} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Retry</button>}
            </div>
          )}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isStreaming && !(error && phase === 'live') ? 'opacity-100' : 'opacity-0'} ${phase === 'result' ? 'hidden' : ''}`}
          />

          {phase === 'live' && isStreaming && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-32 border-2 border-indigo-400/80 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1"></div>
              </div>
              <p className="absolute bottom-20 text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full">
                {isProcessing ? (processingLabel || 'Scanning…') : 'Point at label or screen'}
              </p>
            </div>
          )}

          {phase === 'result' && (
            <div className="absolute inset-0 overflow-y-auto p-5 pt-16 space-y-3 bg-slate-900">
              {lastTier && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-300">
                  {TIER_ICON[lastTier]} {TIER_LABEL[lastTier]}
                </div>
              )}
              <div className="space-y-2">
                {fields.map(f => (
                  <button
                    key={f.key}
                    onClick={() => handlePickField(f)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg text-left border transition-colors ${
                      f.verified
                        ? 'bg-slate-800 border-slate-700 hover:border-indigo-500 hover:bg-slate-800/80'
                        : 'bg-slate-800/50 border-amber-500/40 hover:border-amber-400'
                    }`}
                  >
                    <span>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-400">{f.label}</span>
                      <span className="font-mono text-sm text-white">{f.value}</span>
                    </span>
                    {f.verified ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 shrink-0">
                        <ShieldAlert className="w-3.5 h-3.5" /> couldn't verify
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {error && <p className="text-xs text-rose-400">{error}</p>}
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controls */}
        <div className="p-6 bg-slate-900 border-t border-slate-800 space-y-3">
          {phase === 'live' ? (
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={handleUseAi}
                disabled={!isStreaming || isProcessing}
                title="Skip straight to AI"
                className="flex flex-col items-center gap-1 text-slate-400 hover:text-indigo-300 disabled:opacity-40 text-[11px] font-medium"
              >
                <Sparkles className="w-5 h-5" />
                Use AI
              </button>
              <button
                onClick={handleCapture}
                disabled={!isStreaming || isProcessing}
                className="w-16 h-16 rounded-full bg-white border-4 border-indigo-500 flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
              >
                {isProcessing ? (
                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-indigo-500" />
                )}
              </button>
              <div className="w-5" />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleScanAgain}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium"
              >
                <RotateCcw className="w-4 h-4" /> Scan Again
              </button>
              <button
                onClick={handleUseAi}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium disabled:opacity-40"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Use AI
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
