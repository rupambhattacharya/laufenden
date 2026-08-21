import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['content-pipeline/test/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
