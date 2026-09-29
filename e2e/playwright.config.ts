import { defineConfig } from '@playwright/test';

// Manual E2E suite — not run in CI. Usage:
//   npx playwright test -c e2e                      # against local `npm run dev`
//   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app npx playwright test -c e2e
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  use: {
    baseURL: externalBaseURL || 'http://localhost:3000',
    headless: true,
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run dev',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
