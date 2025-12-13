import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, Loader2, Zap } from 'lucide-react';
import { extractImeiFromImage } from '../services/geminiService';

interface ImeiScannerProps {
  onScan: (imei: string) => void;
  onClose: () => void;
}

export const ImeiScanner: React.FC<ImeiScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
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

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Draw video frame to canvas
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64Image = canvas.toDataURL('image/jpeg', 0.8);
        
        // Send to AI
        const imei = await extractImeiFromImage(base64Image);
        
        if (imei && imei.length > 5) {
          onScan(imei);
          onClose();
        } else {
          setError("No valid IMEI detected. Try moving closer or focusing.");
        }
      }
    } catch (err) {
      setError("Failed to process image.");
    } finally {
      setIsProcessing(false);
    }
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
          <button onClick={onClose} className="text-white/80 hover:text-white bg-black/40 p-1.5 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Video Viewport */}
        <div className="relative aspect-[3/4] bg-black flex items-center justify-center">
            {!isStreaming && !error && <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />}
            
            {error && (
                <div className="text-center p-6">
                    <p className="text-rose-400 mb-2 font-bold">Error</p>
                    <p className="text-slate-300 text-sm">{error}</p>
                    <button onClick={startCamera} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Retry</button>
                </div>
            )}

            <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className={`w-full h-full object-cover ${isStreaming ? 'opacity-100' : 'opacity-0'}`}
            />
            
            {/* Guide Box */}
            {isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-64 h-32 border-2 border-indigo-400/80 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                        <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1"></div>
                        <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1"></div>
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1"></div>
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1"></div>
                    </div>
                    <p className="absolute bottom-20 text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full">
                        Point at label or screen
                    </p>
                </div>
            )}

            {/* Hidden Canvas for processing */}
            <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controls */}
        <div className="p-6 bg-slate-900 flex justify-center border-t border-slate-800">
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
        </div>
      </div>
    </div>
  );
};
