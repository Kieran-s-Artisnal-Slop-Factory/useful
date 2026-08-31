import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/local',
  // retries: 0 on purpose — a flaky data test is an untrustworthy data test.
  retries: 0,
  // Playwright's default is half the cores, which is 16 here — sixteen browsers
  // each installing a service worker and precaching the shell, all against ONE
  // single-threaded static server. That over-subscription was itself a source
  // of failures: sockets ran out (`net::ERR_NO_BUFFER_SPACE`) and the worker
  // sometimes took longer than 30 s to claim its page. Eight keeps the run
  // parallel and the results repeatable, which is the same trade `retries: 0`
  // already makes.
  workers: 8,
  timeout: 60_000,
  webServer: {
    // A PRODUCTION build, not the dev server: the service worker only exists in
    // production, and a suite that never loads it tests a path no user runs.
    // NOT `astro preview`: Astro 7's preview daemonizes itself under a non-TTY
    // stdin, so Playwright sees the process exit and aborts the run.
    command: 'npm run build && node tools/preview-server.mjs --port 4330 --dir dist',
    url: 'http://127.0.0.1:4330/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: { baseURL: 'http://127.0.0.1:4330', trace: 'retain-on-failure' },
  reporter: [['list'], ['./tests/local/trust-gate.ts']],
});
