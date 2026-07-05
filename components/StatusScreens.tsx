import React from 'react';

// Full-screen status views used while the app is booting or when the database
// is unreachable. Extracted from App.tsx to keep the root component focused on
// composition rather than markup.

export const LoadingScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950 text-slate-500">
    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    <p className="text-sm">{message}</p>
  </div>
);

export const DbErrorScreen: React.FC<{
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}> = ({ message, onRetry, onSignOut }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950 text-center px-6">
    <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 text-2xl">!</div>
    <div>
      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">Couldn't reach the database</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">{message}</p>
    </div>
    <div className="flex gap-2">
      <button onClick={onRetry} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Retry</button>
      <button onClick={onSignOut} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium">Sign out</button>
    </div>
  </div>
);
