import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live next to the pure modules they cover (src/**/*.test.ts).
    // The Playwright data suite owns tests/local/ and runs via `npm test`.
    include: ['src/**/*.test.ts'],
  },
});
