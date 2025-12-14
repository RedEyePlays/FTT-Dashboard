import React, { useRef, useState } from 'react';
import { Download, Upload, X, ShieldCheck, AlertTriangle, FileJson } from 'lucide-react';
import { AppData } from '../types';

interface SettingsModalProps {
  onClose: () => void;
  currentData: AppData;
  onRestore: (data: AppData) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, currentData, onRestore }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `biztrack_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          if (event.target?.result) {
            const parsed = JSON.parse(event.target.result as string);
            
            // Basic validation
            if (!Array.isArray(parsed.inventory) && !Array.isArray(parsed.notes)) {
               throw new Error("Invalid file structure");
            }

            // Normalize data structure
            const restoredData: AppData = {
              inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
              notes: Array.isArray(parsed.notes) ? parsed.notes : [],
              tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
            };

            if (confirm("WARNING: This will overwrite all current data with the backup file. Are you sure?")) {
               onRestore(restoredData);
               onClose();
            }
          }
        } catch (err) {
          setRestoreError("Invalid JSON file. Please upload a valid BizTrack backup.");
        }
      };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto custom-scrollbar">
        
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-500" />
            Data Management
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="h-px bg-slate-100 dark:bg-slate-800 w-full" />

          {/* Backup Section */}
          <div className="space-y-3">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
                 <Download className="w-5 h-5" />
               </div>
               <div>
                 <h3 className="font-medium text-slate-900 dark:text-white">Backup Data</h3>
                 <p className="text-xs text-slate-500 dark:text-slate-400">Download a full copy of your data (JSON).</p>
               </div>
             </div>
             <button 
               onClick={handleBackup}
               className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors"
             >
               <FileJson className="w-4 h-4" />
               Download Backup
             </button>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800 w-full" />

          {/* Restore Section */}
          <div className="space-y-3">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
                 <Upload className="w-5 h-5" />
               </div>
               <div>
                 <h3 className="font-medium text-slate-900 dark:text-white">Restore Data</h3>
                 <p className="text-xs text-slate-500 dark:text-slate-400">Import a backup file to restore functionality.</p>
               </div>
             </div>
             
             <input 
               type="file" 
               accept=".json" 
               ref={fileInputRef} 
               onChange={handleFileChange} 
               className="hidden" 
             />
             
             <button 
               onClick={() => fileInputRef.current?.click()}
               className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
             >
               <Upload className="w-4 h-4" />
               Select Backup File
             </button>

             {restoreError && (
               <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
                  <AlertTriangle className="w-3 h-3" />
                  {restoreError}
               </div>
             )}
          </div>
          
          <div className="bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-100 dark:border-amber-900/20">
             <p className="text-xs text-amber-800 dark:text-amber-500 flex gap-2">
               <AlertTriangle className="w-4 h-4 flex-shrink-0" />
               <span>Always backup your data before deploying new updates to the live site.</span>
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};