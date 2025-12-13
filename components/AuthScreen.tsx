import React, { useState } from 'react';
import { Lock, Unlock, ShieldCheck, AlertTriangle, Eye, EyeOff } from 'lucide-react';

interface AuthScreenProps {
  mode: 'setup' | 'unlock' | 'migrate';
  onAuthenticate: (pin: string) => void;
  onReset: () => void;
  error?: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ mode, onAuthenticate, onReset, error }) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAuthenticate(pin);
  };

  const isSetup = mode === 'setup' || mode === 'migrate';

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-xl p-8 border border-slate-200 dark:border-slate-800 animate-fadeIn">
        <div className="flex justify-center mb-6">
          <div className={`p-4 rounded-full ${isSetup ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
            {isSetup ? <ShieldCheck className="w-12 h-12" /> : <Lock className="w-12 h-12" />}
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-center text-slate-900 dark:text-white mb-2">
          {mode === 'setup' && "Secure Your Business"}
          {mode === 'migrate' && "Security Upgrade"}
          {mode === 'unlock' && "Welcome Back"}
        </h1>
        
        <p className="text-center text-slate-500 dark:text-slate-400 mb-8">
          {isSetup ? "Enter default PIN to initialize encryption." : "Enter your PIN to decrypt and access your dashboard."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isSetup ? "Enter Default PIN" : "Enter PIN"}
            </label>
            <div className="relative">
              <input 
                type={showPin ? "text" : "password"}
                autoFocus
                value={pin}
                onChange={e => setPin(e.target.value)}
                className="w-full px-4 py-3 text-center text-2xl tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white pr-12"
                placeholder="••••"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-3 rounded-lg text-sm flex items-start gap-2 justify-center text-center">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button 
            type="submit"
            disabled={!pin}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isSetup ? "Initialize App" : "Unlock Dashboard"}
          </button>
        </form>

        {mode === 'unlock' && (
           <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
             {!showResetConfirm ? (
               <button 
                 onClick={() => setShowResetConfirm(true)}
                 className="text-xs text-slate-400 hover:text-rose-500 transition-colors"
               >
                 Forgot PIN? Reset App
               </button>
             ) : (
               <div className="animate-fadeIn">
                 <p className="text-xs text-rose-600 dark:text-rose-400 font-bold mb-2">
                   WARNING: This will wipe all data permanently!
                 </p>
                 <div className="flex gap-2 justify-center">
                    <button 
                      onClick={() => setShowResetConfirm(false)}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={onReset}
                      className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-medium hover:bg-rose-700"
                    >
                      Confirm Reset
                    </button>
                 </div>
               </div>
             )}
           </div>
        )}
      </div>
    </div>
  );
};