import React from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { captureError } from '../services/errorReporting';
import { CrashReport, crashId, formatCrashDetails } from '../domain/crashReport';

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
  // Records the crash in the activity trail, so one nobody screenshots is
  // still recoverable after the fact. Optional because the ROOT boundary wraps
  // the tree above auth and has nobody to attribute it to yet. Whatever is
  // passed here is called inside a try/catch — a logging failure must never
  // re-enter the boundary that is already handling a crash.
  onCrash?: (report: CrashReport) => void;
  /** Shown in the copied details, so a report says who hit it. */
  userEmail?: string;
}

interface State {
  error: Error | null;
  report: CrashReport | null;
  showDetails: boolean;
  copied: boolean;
}

// Route boundaries are remounted (see App.tsx: `<ErrorBoundary key={view} .../>`)
// whenever the active view changes, which is what actually resets a tripped
// boundary back to normal — React error boundaries otherwise stay in their
// caught state forever, so without the key a Reports crash would keep every
// OTHER view blanked too the next time the user navigated to one.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, report: null, showDetails: false, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack || undefined;
    // UNCHANGED: what is caught, and how it recovers. Only what is SHOWN and
    // RECORDED is different.
    captureError(error, { boundary: this.props.variant, route: this.props.label, componentStack });

    const report: CrashReport = {
      screen: this.props.label || (this.props.variant === 'root' ? 'The app' : 'This screen'),
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack,
      at: Date.now(),
      user: this.props.userEmail,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
    };
    this.setState({ report });

    // GUARDED. If writing the activity entry throws (offline, permissions, a
    // bug in the logger itself) it must not throw from inside a boundary that
    // is already rendering a crash — that would take the whole app down with
    // no recovery UI at all.
    try {
      this.props.onCrash?.(report);
    } catch {
      /* the on-screen details below are still there; that is the fallback */
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null, report: null, showDetails: false, copied: false });
  };

  handleCopy = () => {
    const { report } = this.state;
    if (!report) return;
    const text = formatCrashDetails(report);
    const done = () => {
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    };
    try {
      // Clipboard API can reject (insecure context, permission denied), so
      // there is a textarea fallback — this button is THE thing that gets
      // pasted into a bug report, so it has to work.
      navigator.clipboard?.writeText(text).then(done).catch(() => { legacyCopy(text); done(); });
    } catch {
      legacyCopy(text);
      done();
    }
  };

  renderDetails() {
    const { report, showDetails, copied } = this.state;
    if (!report) return null;
    return (
      <div className="w-full max-w-xl text-left mt-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => this.setState({ showDetails: !showDetails })}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            {showDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Details ({crashId(report)})
          </button>
          {/* Big and obvious on purpose: one tap is the whole point. */}
          <button onClick={this.handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy details</>}
          </button>
        </div>
        {showDetails && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 text-slate-200 text-[11px] leading-relaxed p-3">
            {formatCrashDetails(report)}
          </pre>
        )}
      </div>
    );
  }

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
          {this.renderDetails()}
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
        {this.renderDetails()}
      </div>
    );
  }
}


// Clipboard fallback for an insecure context or a denied permission. The copy
// button is the thing that gets pasted into a bug report, so it must not
// silently do nothing.
function legacyCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch { /* nothing more to try — the details are still on screen to read */ }
}
