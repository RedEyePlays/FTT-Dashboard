import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, X, Loader2, Sparkles, RotateCcw, ShieldAlert, CheckCircle2, ScanBarcode, ScanText } from 'lucide-react';
import { extractImeiFromImage } from '../services/geminiService';
import { OfflineError } from '../services/functionsGuard';
import { detectBarcodes, isBarcodeScanningAvailable, liveScanIntervalMs, prewarmBarcodeFallback } from '../services/imeiBarcode';
import { runOcrTier } from '../services/imeiOcr';
import {
  ScannedField, ScanTier, classifyScannedValues, validateExtractedFields, mergeScannedFields, hasVerifiedField,
} from '../domain/imeiScan';
import { describeCameraError, describeScanError, describeScanNotFound, ScanFailure } from '../domain/scannerErrors';
import { captureError } from '../services/errorReporting';
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
 * Tiered camera scanner, cheapest and fastest first:
 *   1  the browser's native BarcodeDetector — free, instant, offline;
 *   1b a lazy-loaded JS barcode/QR decoder (services/imeiBarcodeFallback.ts)
 *      where the native API is missing, which on iOS — and especially in the
 *      installed PWA — it usually is. Also free and offline. Without this,
 *      tier 1 silently found nothing there and every scan, including scans of
 *      the shop's own QR-coded inventory labels, fell through to the paid AI
 *      tier. Both 1 and 1b run live off the video stream AND, as a backstop,
 *      once more on the captured frame;
 *   2  on-device OCR (native TextDetector, else tesseract.js lazy-loaded on
 *      first use) — still free and offline;
 *   3  Gemini, ONLY when everything above finds nothing.
 *
 * Each tier's candidates are run through domain/imeiScan.ts's classification/
 * validation (including the IMEI Luhn check) before ever being shown as a
 * usable field, so no decoder's raw output is trusted on its own and a misread
 * never gets silently accepted.
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
    // Fetch the JS barcode decoder now if this browser has no native one, so
    // the first live frame isn't waiting on the download — and so the chunk
    // lands in the PWA's service-worker cache for later offline scans.
    prewarmBarcodeFallback();
    return () => {
      stopCamera();
      stopLiveBarcodeLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One place every scanner failure goes: the real exception ALWAYS reaches
  // the console with context, unexpected faults additionally reach error
  // monitoring, and the user gets the classified message rather than a
  // catch-all. Previously the exception was discarded outright, which is why
  // "it just says failed" was undiagnosable.
  const reportFailure = (failure: ScanFailure, err: unknown, context: Record<string, unknown>) => {
    console.error(`[ImeiScanner] ${failure.kind}`, err, context);
    if (failure.unexpected) captureError(err, { source: 'ImeiScanner', kind: failure.kind, ...context });
    setError(failure.message);
  };

  const startCamera = async () => {
    const secureContext = typeof window !== 'undefined' ? window.isSecureContext !== false : true;
    const hasMediaDevices = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    // Checked BEFORE the call: on plain http `navigator.mediaDevices` is
    // undefined, so calling it throws a TypeError that says nothing useful.
    if (!secureContext || !hasMediaDevices) {
      const failure = describeCameraError(null, { secureContext, hasMediaDevices });
      reportFailure(failure, new Error(failure.kind), { secureContext, hasMediaDevices });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch (err) {
      reportFailure(describeCameraError(err, { secureContext, hasMediaDevices }), err, { phase: 'startCamera' });
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

  // Tier 1, live: polls the raw video stream for a barcode while the modal
  // sits in the live view, so a code is caught by simply pointing the camera.
  //
  // Gated on isBarcodeScanningAvailable(), NOT on the native
  // isBarcodeDetectionSupported() it used to check. That native-only gate is
  // the bug: on iOS (and especially the installed PWA, a WebKit web view
  // where BarcodeDetector is commonly absent) the live loop never started at
  // all, so pointing the camera at a barcode did nothing and every scan fell
  // through to OCR and then to the paid AI tier — including scans of the
  // shop's own QR-coded ZP 450 inventory labels. detectBarcodes now falls
  // back to a lazy-loaded JS decoder, so this loop runs everywhere.
  useEffect(() => {
    if (!isStreaming || phase !== 'live' || !isBarcodeScanningAvailable()) return;
    liveScanTimer.current = setInterval(async () => {
      if (liveScanBusy.current || !videoRef.current || isProcessing) return;
      liveScanBusy.current = true;
      try {
        const raws = await detectBarcodes(videoRef.current);
        const classified = classifyScannedValues(raws);
        // Only a VERIFIED read stops the live loop — an unverified (Luhn-
        // failing) decode is a misread more often than a real anomaly, and
        // the loop will just try again on the next frame rather than
        // showing a shaky guess.
        if (hasVerifiedField(classified)) {
          stopLiveBarcodeLoop();
          applyTierResult('barcode', classified);
        }
      } catch (err) {
        // A live-loop frame failing is not worth an error banner (the next
        // frame is ~1s away and usually fine), but it must not be silent —
        // a persistent decoder fault would otherwise look exactly like
        // "the camera just never picks anything up".
        console.error('[ImeiScanner] live barcode frame failed', err);
      } finally {
        liveScanBusy.current = false;
      }
    }, liveScanIntervalMs());
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

  // Returns false (not thrown) when offline — the AI tier is simply
  // "unavailable" rather than a scan failure; callers fall through to
  // whatever the on-device tiers already found, same as an AI miss.
  const runAiTier = async (canvas: HTMLCanvasElement): Promise<boolean> => {
    setProcessingLabel('Reading with AI…');
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);
    try {
      const raw = await extractImeiFromImage(base64Image);
      const classified = validateExtractedFields(raw);
      if (classified.length) {
        applyTierResult('ai', classified);
        return true;
      }
      return false;
    } catch (err) {
      if (err instanceof OfflineError) return false;
      throw err;
    }
  };

  const handleCapture = async () => {
    stopLiveBarcodeLoop();
    setIsProcessing(true);
    setProcessingLabel('');
    setError(null);

    try {
      const canvas = captureFrame();
      if (!canvas) {
        const failure = describeScanError(new Error('Camera frame unavailable'), { online: navigator.onLine });
        reportFailure(failure, new Error('captureFrame returned null'), { phase: 'captureFrame', isStreaming });
        return;
      }

      // Tier 1 backstop: a barcode that never registered during the live
      // loop (or the loop wasn't supported) might still be caught on the
      // exact captured frame. Only a VERIFIED field stops progression here —
      // an unverified (Luhn-failing) candidate is kept as a last-resort
      // fallback (shown only if nothing better turns up) rather than being
      // accepted or silently discarded.
      const barcodeRaws = await detectBarcodes(canvas);
      const barcodeFields = classifyScannedValues(barcodeRaws);
      if (hasVerifiedField(barcodeFields)) { applyTierResult('barcode', barcodeFields); return; } // STOP — no further calls
      let weakFields = barcodeFields;
      let weakTier: ScanTier | null = barcodeFields.length ? 'barcode' : null;

      // Tier 2: on-device OCR, still free/offline. Same rule: an unverified
      // OCR read (OCR misreads digits far more than barcodes do) falls
      // through to AI instead of being accepted.
      const ocrTokens = await runOcrTier(cropToRegionOfInterest(canvas));
      const ocrFields = classifyScannedValues(ocrTokens);
      if (hasVerifiedField(ocrFields)) { applyTierResult('ocr', ocrFields); return; }
      if (ocrFields.length) { weakFields = mergeScannedFields(weakFields, ocrFields); weakTier = 'ocr'; }

      // Tier 3: Gemini, last resort. If even AI finds nothing, fall back to
      // whatever unverified candidate an earlier tier found — flagged
      // "couldn't verify" on the result screen — rather than a bare error.
      const gotAi = await runAiTier(canvas);
      if (!gotAi) {
        if (weakFields.length) applyTierResult(weakTier!, weakFields);
        // A clean run that found nothing is NOT a failure — no console.error,
        // no monitoring report, just the "try moving closer" hint (which also
        // stops suggesting AI when we already know we're offline).
        else setError(describeScanNotFound({ online: navigator.onLine }).message);
      }
    } catch (err) {
      // Was: `setError('Failed to process image.')` with the exception thrown
      // away — the reason a missing BarcodeDetector, a tesseract.js load
      // failure and a rejected Cloud Function were indistinguishable and
      // invisible.
      reportFailure(describeScanError(err, { online: navigator.onLine }), err, { phase: 'handleCapture' });
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  // Manual escape hatch (item 1's explicit ask): skip straight to Gemini when
  // the user already knows the on-device tiers will fail (bad glare, an
  // unusual layout).
  const handleUseAi = async () => {
    if (!navigator.onLine) { setError("AI scan needs an internet connection — you're offline."); return; }
    stopLiveBarcodeLoop();
    setIsProcessing(true);
    setError(null);
    try {
      const canvas = captureFrame();
      if (!canvas) {
        reportFailure(describeScanError(new Error('Camera frame unavailable'), { online: navigator.onLine }),
          new Error('captureFrame returned null'), { phase: 'handleUseAi/captureFrame', isStreaming });
        return;
      }
      const gotAi = await runAiTier(canvas);
      if (!gotAi) setError('No IMEI or serial detected by AI either. Try a clearer, closer shot.');
    } catch (err) {
      // Same fix as handleCapture: the AI tier rejecting (a Cloud Function
      // error, a quota refusal) now says so and reaches the console, instead
      // of the generic "Failed to process image." that hid it.
      reportFailure(describeScanError(err, { online: navigator.onLine }), err, { phase: 'handleUseAi' });
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
