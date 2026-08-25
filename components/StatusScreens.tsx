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

const pulse = 'animate-pulse bg-slate-200 dark:bg-slate-800 rounded';

// Shown instead of the plain spinner while the workspace's Firestore data is
// first loading — gives a sense of the dashboard shape rather than a blank
// screen for the second or two that takes.
export const LoadingSkeleton: React.FC<{ message: string }> = ({ message }) => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
    <div className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 gap-3">
      <div className={`w-8 h-8 ${pulse}`} />
      <div className={`w-32 h-4 ${pulse}`} />
    </div>
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        {message}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`h-24 ${pulse}`} />)}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`h-10 ${pulse}`} />)}
      </div>
    </div>
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
