import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    setupFiles: ['./setup-env.ts'],
    deps: {
      external: ['node:sqlite'],
    },
  },
  optimizeDeps: {
    exclude: ['node:sqlite'],
  },
});
