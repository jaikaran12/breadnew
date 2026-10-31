import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
