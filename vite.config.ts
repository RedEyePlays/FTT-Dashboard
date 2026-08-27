import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const pkgVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  // Ties error reports (services/errorReporting.ts) back to the deploy they
  // came from. Falls back to package.json's version when CI doesn't set a
  // more specific build identifier (e.g. a commit SHA) via VITE_APP_VERSION.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || pkgVersion),
  },
});