import { defineConfig } from 'vitest/config';

// Separate config for the Firestore rules suite: it needs a live emulator
// (see package.json's test:rules), so it's excluded from the main
// vitest.config.ts and run explicitly against this one instead.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.rules.test.ts'],
    testTimeout: 20000,
  },
});
