import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/local',
  // retries: 0 on purpose — a flaky data test is an untrustworthy data test.
  retries: 0,
  timeout: 60_000,
  webServer: {
    // A PRODUCTION build, not the dev server: the service worker only exists in
    // production, and a suite that never loads it tests a path no user runs.
    command: 'npm run build && npm run preview -- --port 4330',
    url: 'http://127.0.0.1:4330/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: { baseURL: 'http://127.0.0.1:4330', trace: 'retain-on-failure' },
  reporter: [['list'], ['./tests/local/trust-gate.ts']],
});
