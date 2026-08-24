import { defineConfig } from 'vite';

// Separate build for the standalone public repair-status page. Deliberately
// its own Vite config, its own root, and its own output directory — running
// `npm run build:status` never touches, imports from, or bundles anything
// from the main app (App.tsx, components/, domain/, services/, hooks/). The
// two are only related by both calling the same Firebase project's Cloud
// Functions, over plain HTTPS (see status-page/src/api.ts).
export default defineConfig({
  root: 'status-page',
  build: {
    outDir: '../dist-status',
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
  },
});
