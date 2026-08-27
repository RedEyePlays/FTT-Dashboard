import './index.css';
import './services/firebase'; // Initialize Firebase services
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConnectionBanner } from './components/ConnectionBanner';
import { initErrorReporting } from './services/errorReporting';

initErrorReporting();

// Simple app-shell + static-asset service worker for offline load/install —
// deliberately does not touch Firestore data (that's persistentLocalCache's
// job, configured in services/firebase.ts). Registered after load so it
// never competes with the initial paint, and skipped entirely outside a
// real browser (SSR/test environments have no `navigator.serviceWorker`).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed (app still works, just not offline-installable):', err);
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary variant="root">
      <ConnectionBanner />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
