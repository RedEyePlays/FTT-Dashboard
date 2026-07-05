import { defineConfig } from 'vitest/config';

// Unit tests target the pure logic modules (services + domain helpers). They run
// in a Node environment — no jsdom needed until we test React components.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
