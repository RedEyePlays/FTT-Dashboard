import { defineConfig } from 'vitest/config';

// Unit tests target the pure logic modules (services + domain helpers). They run
// in a Node environment — no jsdom needed until we test React components.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // functions/ is a fully separate deployable package (own package.json,
    // own node:test-based suite — run via `npm --prefix functions test`, see
    // functions/src/permissions.test.ts) — its tests aren't vitest-compatible
    // and shouldn't be collected here. rules-tests/ needs a live Firestore
    // emulator (JVM, a running process, real network I/O) that the rest of
    // this suite deliberately doesn't require — run it explicitly via
    // `npm run test:rules` (see rules-tests/firestore.rules.test.ts).
    exclude: ['node_modules', 'dist', 'functions', 'rules-tests'],
  },
});
