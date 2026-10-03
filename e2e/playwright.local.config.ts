import { defineConfig } from '@playwright/test';

// Logged-in smoke suite against a fully local setup. Do not run directly —
// use `npm run e2e:local` (e2e/local/run.mjs), which provisions the local
// Postgres, seeds test members, mints session cookies and sets the env.
const port = process.env.E2E_PORT || '3100';

if (!process.env.E2E_SESSIONS_FILE) {
  throw new Error('playwright.local.config.ts must be run via `npm run e2e:local`');
}

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.local\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '.local/test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
  },
  // E2E_EXTERNAL_SERVER=1: attach to an already running `npm run e2e:local -- --serve`.
  webServer: process.env.E2E_EXTERNAL_SERVER ? undefined : {
    // Never reuse: an already-running dev server may be wired to real services.
    command: `npx next dev -p ${port}`,
    cwd: '..',
    url: `http://localhost:${port}/api/session`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
