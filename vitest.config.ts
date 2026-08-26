import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

// Unit tests target the pure logic modules (services + domain helpers), which
// run in a Node environment. A handful of suites need a DOM — the note editor's
// markdown⇄HTML round-trip, and the component tests that prove a note's
// visibility actually reaches rendered output — and opt in per file with
// `// @vitest-environment happy-dom`. The React plugin is here so those .tsx
// suites can compile JSX.
export default defineConfig({
  // Cast: @vitejs/plugin-react-swc resolves against the root `vite` package,
  // while vitest's own `defineConfig` re-exports a nested `vite` copy from
  // node_modules/vitest/node_modules/vite with a structurally identical but
  // nominally distinct Plugin type — tsc treats them as incompatible even
  // though this is exactly the intended, supported usage.
  plugins: [react()] as any,
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // functions/ is a fully separate deployable package (own package.json,
    // own node:test-based suite — run via `npm --prefix functions test`, see
    // functions/src/permissions.test.ts) — its tests aren't vitest-compatible
    // and shouldn't be collected here.
    exclude: ['node_modules', 'dist', 'functions'],
  },
});
