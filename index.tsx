import './index.css';
import './services/firebase'; // Initialize Firebase services
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RepairStatusLookup } from './components/RepairStatusLookup';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Public repair-status page lives at /status and must render WITHOUT the app's
// auth gate. Branch here at the entry point so the whole authenticated App tree
// (and its workspace-data hooks) never mounts for a public visitor.
const isPublicStatus = window.location.pathname.replace(/\/+$/, '') === '/status';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isPublicStatus ? <RepairStatusLookup /> : <App />}
  </React.StrictMode>
);
