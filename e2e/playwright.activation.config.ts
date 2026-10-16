import { defineConfig } from '@playwright/test';
const port = process.env.ACTIVATION_TEST_PORT || '3106';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './activation',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: '../test-results',
  use: { baseURL, contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: {
    command: `node --require ./e2e/activation/preload.cjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    cwd: '..', url: `${baseURL}/login`, reuseExistingServer: false, timeout: 120000,
    env: { SESSION_SECRET: 'browser-test-secret-not-for-production', DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci', DISCORD_BOT_TOKEN: '', GOOGLE_SERVICE_ACCOUNT_JSON: '', GOOGLE_SHEETS_WEBAPP_URL: '', GOOGLE_SHEETS_SHARED_SECRET: '' },
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
