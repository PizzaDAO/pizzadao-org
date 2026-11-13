import { test, expect } from '@playwright/test';

// Never opens a real payee link: every API call is mocked and the real API is blocked.
// Run: PLAYWRIGHT_BASE_URL=<preview> npx playwright test -c e2e e2e/tax-form.spec.ts
const TOKEN = 'e2e-fake-token-000000000000000';
const API = `**/api/tax-form-requests/${TOKEN}`;

const info = {
  payeeLabel: 'TEST E2E',
  requester: 'Rare Pizzas',
  suggestedFormType: null,
  taxYearNote: null,
  status: 'opened',
  locked: false,
  submittedFormType: null,
  rejectedReason: null,
  currentDraft: null,
  storedSecretFields: [],
};

test.describe('/tax-form', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://api.rsv.pizza/**', (r) => r.abort());
    await page.route('https://rsv.pizza/**', (r) => r.abort());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    await page.route(`${API}**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: cors, json: info });
      return route.fulfill({ status: 200, headers: cors, json: { ok: true } });
    });
  });

  test('serves the page (no redirect) with privacy headers', async ({ page }) => {
    const res = await page.request.get(`/tax-form?payee=${TOKEN}`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers()['cache-control']).toContain('no-store');
  });

  test('renders, picks W-9, saves a draft', async ({ page }) => {
    const hosts: string[] = [];
    page.on('request', (r) => hosts.push(new URL(r.url()).host));
    await page.goto(`/tax-form?payee=${TOKEN}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.getByText('US individual or business (W-9)').click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    expect(hosts).not.toContain('rsv.pizza');
  });
});
