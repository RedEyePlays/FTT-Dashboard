import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureError } from '../services/errorReporting';

interface Props {
  children: React.ReactNode;
  // 'root': full-screen recovery UI for a crash the app can't route around —
  // wrapped around the whole tree in index.tsx. 'route': a smaller, inline
  // recovery UI meant to sit inside one view's content area, so a crash in
  // (say) Reports doesn't blank the header/nav or any other view.
  variant: 'root' | 'route';
  // Only meaningful for variant="route" — shown in the fallback so staff (and
  // the resulting error report) know which screen actually broke.
  label?: string;
}

interface State {
  error: Error | null;
}

// Route boundaries are remounted (see App.tsx: `<ErrorBoundary key={view} .../>`)
// whenever the active view changes, which is what actually resets a tripped
// boundary back to normal — React error boundaries otherwise stay in their
// caught state forever, so without the key a Reports crash would keep every
// OTHER view blanked too the next time the user navigated to one.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureError(error, { boundary: this.props.variant, route: this.props.label, componentStack: info.componentStack || undefined });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.variant === 'root') {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">Something went wrong</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
              The app hit an unexpected error and needs to reload. Anything you'd already saved — like your last
              completed sale — is safe; it was written to the database as it happened, not held only on this screen.
            </p>
          </div>
          <button onClick={this.handleReload} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Reload
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center px-6 py-16 border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-900/10 rounded-2xl">
        <AlertTriangle className="w-8 h-8 text-rose-500" />
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">
            {this.props.label ? `${this.props.label} hit an error` : 'This screen hit an error'}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            The rest of the app is unaffected — you can keep working elsewhere, or try this screen again.
          </p>
        </div>
        <button onClick={this.handleReset} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }
}
