import { test, expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Logged-in smoke suite. Run with `npm run e2e:local` (see e2e/local/run.mjs):
// it seeds two synthetic members and mints their session cookies.
//   990001 — new member, profile 0/3 complete
//   990002 — complete member (crew + wallet + X), celebration not yet shown
//   990003 — shop admin (Pepperoni Mafia role via the fake guild lookup in preload.cjs)
// Nothing here writes to Google Sheets or Discord; the network guard in
// e2e/local/preload.cjs would block it anyway.

type SessionInfo = { memberId: string; discordId: string; cookieName: string; token: string };
const SESSIONS: Record<string, SessionInfo> = JSON.parse(readFileSync(process.env.E2E_SESSIONS_FILE!, 'utf8'));
const NEW = SESSIONS['990001'];
const COMPLETE = SESSIONS['990002'];
const SHOTS = process.env.E2E_SHOTS_DIR || resolve(__dirname, '.local/shots');
mkdirSync(SHOTS, { recursive: true });
const DIAG = resolve(SHOTS, 'diagnostics.jsonl');

// Third-party noise that is expected offline / without API keys.
const IGNORED_FAILURES = [/walletconnect/i, /web3modal/i, /reown/i, /coinbase/i, /_next\/webpack-hmr/, /__nextjs_original-stack-frame/];

async function login(context: BrowserContext, s: SessionInfo) {
  await context.addCookies([
    { name: s.cookieName, value: s.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}

type Diag = { consoleErrors: string[]; failedRequests: string[]; pageErrors: string[]; dialogs: string[] };

function watch(page: Page): Diag {
  const d: Diag = { consoleErrors: [], failedRequests: [], pageErrors: [], dialogs: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') d.consoleErrors.push(m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => d.pageErrors.push(String(e?.message || e).slice(0, 400)));
  page.on('requestfailed', (r) => {
    if (IGNORED_FAILURES.some((re) => re.test(r.url()))) return;
    const err = r.failure()?.errorText || '';
    if (/ERR_ABORTED/.test(err)) return; // navigation/prefetch cancellations
    d.failedRequests.push(`${r.method()} ${r.url()} — ${err}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !IGNORED_FAILURES.some((re) => re.test(r.url()))) {
      d.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  // A native alert()/confirm() is a regression (toasts replaced them).
  page.on('dialog', async (dlg) => {
    d.dialogs.push(`${dlg.type()}: ${dlg.message()}`);
    await dlg.dismiss().catch(() => {});
  });
  return d;
}

async function shot(page: Page, info: TestInfo, name: string, diag?: Diag) {
  const file = resolve(SHOTS, `${info.project.name}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (diag) {
    appendFileSync(DIAG, JSON.stringify({ project: info.project.name, name, url: page.url(), ...diag }) + '\n');
  }
}

/** Wait until the app has settled (client fetches done) without hanging on long-polls. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
}

async function expectNoCrash(page: Page) {
  await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Something went wrong/i)).toHaveCount(0);
}

test.describe('logged-in (new member 990001)', () => {
  test.beforeEach(async ({ context }) => login(context, NEW));

  test('dashboard: completion meter, next step, language, logout', async ({ page, context }, info) => {
    const diag = watch(page);
    await page.goto(`/dashboard/${NEW.memberId}`);

    const meter = page.getByTestId('profile-completion-meter');
    await expect(meter).toBeVisible({ timeout: 60_000 });
    const ring = meter.getByRole('progressbar', { name: 'Profile setup' });
    await expect(ring).toHaveAttribute('aria-valuenow', '0');
    await expect(ring).toHaveAttribute('aria-valuemax', '3');
    const next = meter.getByRole('link', { name: /Next: Join a crew/i });
    await expect(next).toHaveAttribute('href', '/crews');
    await settle(page);
    await meter.scrollIntoViewIfNeeded();
    await shot(page, info, 'dashboard', diag);

    // Language: en -> es -> en, NEXT_LOCALE cookie follows.
    const select = page.locator('select:has(option[value="es"])');
    await expect(select).toBeEnabled();
    await select.selectOption('es');
    await page.getByRole('button', { name: /Save language|Guardar idioma/ }).click();
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value, { timeout: 20_000 })
      .toBe('es');
    await expect(page.getByRole('button', { name: 'Guardar idioma' })).toBeVisible({ timeout: 30_000 });
    await shot(page, info, 'dashboard-es');

    await page.locator('select:has(option[value="es"])').selectOption('en');
    await page.getByRole('button', { name: /Save language|Guardar idioma/ }).click();
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value, { timeout: 20_000 })
      .toBe('en');
    await expect(page.getByRole('button', { name: 'Save language' })).toBeVisible({ timeout: 30_000 });

    // Logout clears the session and the header flips to logged-out.
    await page.getByRole('button', { name: /log out/i }).click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === NEW.cookieName && c.value))
      .toBe(false);
    await shot(page, info, 'after-logout', diag);
    expect(diag.pageErrors, 'uncaught page errors').toEqual([]);
    expect(diag.dialogs, 'native dialogs').toEqual([]);
  });

  test('site header: logged-in state', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/missions');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    if (info.project.name === 'desktop') {
      await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', `/dashboard/${NEW.memberId}`, { timeout: 30_000 });
      await expect(nav.getByRole('link', { name: 'Chats' })).toBeVisible();
      await nav.getByRole('button', { name: /More/ }).click();
      const more = page.locator('#site-nav-more');
      await expect(more).toBeVisible();
      await expect(more.getByRole('link', { name: 'Manuals' })).toBeVisible();
      await shot(page, info, 'nav-more-open', diag);
      await page.keyboard.press('Escape');
      await expect(more).toBeHidden();
    } else {
      await page.getByRole('button', { name: 'Open menu' }).click();
      const menu = page.locator('#site-nav-mobile');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', `/dashboard/${NEW.memberId}`, { timeout: 30_000 });
      await expect(menu.getByRole('link', { name: 'Chats' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Manuals' })).toBeVisible();
      await shot(page, info, 'nav-mobile-open', diag);
      await page.getByRole('button', { name: 'Close menu' }).click();
      await expect(menu).toBeHidden();
    }
    await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0);
  });

  const PAGES: Array<[string, string]> = [
    ['profile', `/profile/${NEW.memberId}`],
    ['profile-edit', `/profile/${NEW.memberId}/edit`],
    ['missions', '/missions'],
    ['pep', '/pep'],
    ['chats', '/chats'],
    ['vouches', '/vouches'],
    ['me-wallets', '/me/wallets'],
  ];
  for (const [name, path] of PAGES) {
    test(`page renders: ${path}`, async ({ page }, info) => {
      const diag = watch(page);
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(500);
      await settle(page);
      await expectNoCrash(page);
      // Logged-in pages must not bounce to the login screen.
      expect(new URL(page.url()).pathname).not.toBe('/login');
      await shot(page, info, name, diag);
      expect(diag.pageErrors, 'uncaught page errors').toEqual([]);
      expect(diag.dialogs, 'native dialogs').toEqual([]);
    });
  }

  test('failing action shows a toast, not alert()', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/crews');
    const join = page.getByRole('button', { name: 'Join Crew' }).first();
    await expect(join).toBeVisible({ timeout: 60_000 });
    // /api/join-crew fails locally (no GOOGLE_SHEETS_WEBAPP_URL) before any
    // Discord call — a harmless failure.
    const resp = page.waitForResponse((r) => r.url().includes('/api/join-crew'));
    await join.click();
    expect((await resp).ok()).toBe(false);
    const toast = page.locator('[role="alert"], [role="status"]').filter({ hasText: /\S/ }).last();
    await expect(toast).toBeVisible();
    await shot(page, info, 'toast-join-crew-error', diag);
    expect(diag.dialogs, 'native dialogs').toEqual([]);
    await expectNoCrash(page);
  });

  test('admin roster audit denies non-admins', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/admin/roster-audit');
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible({ timeout: 60_000 });
    await shot(page, info, 'admin-roster-audit', diag);
  });

  test('shop admin denies non-admins and is not in their menu', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/admin/shop');
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('E2E Rare Pizza Box')).toHaveCount(0);
    await shot(page, info, 'admin-shop-denied', diag);
    const res = await page.request.get('/api/admin/shop');
    expect(res.status()).toBe(403);
    if (info.project.name === 'desktop') {
      await page.goto('/missions');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /More/ }).click();
      await expect(page.locator('#site-nav-more').getByRole('link', { name: 'Manuals' })).toBeVisible();
      await expect(page.locator('#site-nav-more').getByRole('link', { name: 'Shop admin' })).toHaveCount(0);
    }
  });
});

test.describe('shop admin (Pepperoni Mafia member 990003)', () => {
  const ADMIN = SESSIONS['990003'];
  test.beforeEach(async ({ context }) => login(context, ADMIN));

  test('/admin/shop: item list, More-menu link, create an item, audit log', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/admin/shop');
    await expect(page.getByRole('heading', { name: 'Shop admin' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'E2E Rare Pizza Box' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E Molto Benny Pin' })).toBeVisible();
    await settle(page);
    await expectNoCrash(page);
    await shot(page, info, 'admin-shop', diag);

    if (info.project.name === 'desktop') {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /More/ }).click();
      await expect(page.locator('#site-nav-more').getByRole('link', { name: 'Shop admin' })).toHaveAttribute('href', '/admin/shop', { timeout: 30_000 });
      await page.keyboard.press('Escape');
    }

    const name = `E2E Hat ${info.project.name} ${Date.now() % 100000}`;
    await page.getByRole('button', { name: /New item/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New item' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Price ($PEP)').fill('42');
    await shot(page, info, 'admin-shop-new-item', diag);
    await dialog.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText(`Created ${name}.`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.locator('ol li').filter({ hasText: name }).filter({ hasText: 'Created' })).toBeVisible();
    await shot(page, info, 'admin-shop-created', diag);
    expect(diag.pageErrors, 'uncaught page errors').toEqual([]);
    expect(diag.dialogs, 'native dialogs').toEqual([]);
  });

  test('/missions review panel: names instead of Discord IDs, role names, Approve for holds', async ({ page }, info) => {
    const diag = watch(page);
    await page.goto('/missions');
    const submitters = page.getByTestId('submitter');
    await expect(submitters.first()).toBeVisible({ timeout: 60_000 });
    // Sheet member: Crew-sheet name, "member #N", linked to the profile.
    const sheet = submitters.filter({ hasText: 'E2E Test Margherita' });
    await expect(sheet).toContainText('member #990001');
    await expect(sheet.getByRole('link')).toHaveAttribute('href', '/profile/990001');
    // Not in the sheet: the Discord nickname and handle, not the raw ID.
    const discordOnly = submitters.filter({ hasText: 'E2E Discord-only Diavola' });
    await expect(discordOnly).toContainText('@e2e-discord-only');
    await expect(page.getByTestId('verifier-saw')).toContainText('Roles: Pepperoni Mafia');
    await expect(page.getByTestId('awaiting-release')).toContainText('Auto-verified · needs approval');
    const panelText = await page.locator('body').innerText();
    expect(panelText).not.toContain('100000000000990009');
    expect(panelText).not.toContain('823266914834841610');
    expect(panelText).not.toMatch(/\bRelease\b/);
    await page.getByTestId('awaiting-release').scrollIntoViewIfNeeded();
    await shot(page, info, 'mission-review-panel', diag);
    expect(diag.pageErrors, 'uncaught page errors').toEqual([]);
  });
});

test.describe('profile-complete celebration (member 990002)', () => {
  // The celebration is claimed once per member in the DB, so only one project runs it.
  test.beforeEach(async ({ context }, info) => {
    test.skip(info.project.name !== 'desktop', 'one-shot server flag — desktop only');
    await login(context, COMPLETE);
  });

  test('shows once, never again', async ({ page, browser }, info) => {
    const diag = watch(page);
    await page.goto(`/dashboard/${COMPLETE.memberId}`);
    const modal = page.getByTestId('profile-complete-celebration');
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('profile-completion-meter')).toHaveCount(0);
    await shot(page, info, 'celebration', diag);
    await modal.getByRole('button').first().click();
    await expect(modal).toBeHidden();

    // Same browser (localStorage memo).
    await page.reload();
    await settle(page);
    await page.waitForTimeout(2000);
    await expect(modal).toHaveCount(0);

    // Fresh browser, no localStorage: the server flag alone must suppress it.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await login(ctx, COMPLETE);
    const p2 = await ctx.newPage();
    const claim = p2.waitForResponse((r) => r.url().includes('/api/missions/celebration') && r.request().method() === 'POST', { timeout: 60_000 });
    await p2.goto(`/dashboard/${COMPLETE.memberId}`);
    const body = await (await claim).json();
    expect(body.profileCompletedClaimed).toBe(false);
    await p2.waitForTimeout(1500);
    await expect(p2.getByTestId('profile-complete-celebration')).toHaveCount(0);
    await shot(p2, info, 'celebration-after-reload');
    await ctx.close();
  });
});

test.describe('level-up approved while away (member 990002)', () => {
  // lastCelebratedLevel is claimed once per member in the DB: desktop only.
  test.beforeEach(async ({ context }, info) => {
    test.skip(info.project.name !== 'desktop', 'one-shot server flag — desktop only');
    await login(context, COMPLETE);
  });

  test('the next /missions visit shows the level-up modal once', async ({ page, browser }, info) => {
    const diag = watch(page);
    await page.goto('/missions');
    const modal = page.getByTestId('level-up-modal');
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect(modal).toContainText('69'); // the Level 1 reward that was paid
    await shot(page, info, 'level-up-while-away', diag);
    await modal.click({ position: { x: 5, y: 5 } }); // backdrop dismisses
    await expect(modal).toBeHidden();

    // Another browser: the server claim alone must suppress it.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await login(ctx, COMPLETE);
    const p2 = await ctx.newPage();
    const claim = p2.waitForResponse(
      (r) => r.url().includes('/api/missions/celebration') && r.request().method() === 'POST',
      { timeout: 60_000 },
    ).catch(() => null);
    await p2.goto('/missions');
    await settle(p2);
    // Either no claim is attempted (state already celebrated) or it loses.
    const res = await Promise.race([claim, p2.waitForTimeout(3000).then(() => null)]);
    if (res) expect((await res.json()).levelUpClaimed).not.toBe(true);
    await expect(p2.getByTestId('level-up-modal')).toHaveCount(0);
    await ctx.close();
    expect(diag.pageErrors, 'uncaught page errors').toEqual([]);
  });
});
