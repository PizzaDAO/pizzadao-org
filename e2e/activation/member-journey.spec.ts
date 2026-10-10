import { test, expect, type BrowserContext } from '@playwright/test';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import fr from '../../messages/fr.json';

const catalogs = { en, es, fr };
async function fixtures(context: BrowserContext, state: { draft?: unknown; profile?: Record<string, unknown>; failSave?: boolean; loginStatus?: string } = {}) {
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200; let json: unknown = {};
    if (path === '/api/me') { status = 401; json = { error: 'Not authenticated' }; }
    else if (path === '/api/session') json = { authenticated: false };
    else if (path === '/api/articles') json = { articles: [{ slug: 'community', title: 'Community test story', excerpt: 'A community story.' }] };
    else if (path === '/api/crew-mappings') json = { crews: [] };
    else if (path === '/api/onboarding/draft') json = { draft: state.draft };
    else if (path === '/api/auth/magic-login/request') { state.draft = route.request().postDataJSON().signupDraft; json = { status: state.loginStatus || 'sent' }; status = state.loginStatus ? 422 : 200; }
    else if (path.startsWith('/api/member-lookup/')) json = { found: false };
    else if (path === '/api/profile') { state.profile = route.request().postDataJSON(); status = state.failSave ? 503 : 200; json = state.failSave ? { error: 'Please retry saving' } : { ok: true, sheets: { memberId: '990001' } }; }
    await route.fulfill({ status, json });
  });
}
for (const locale of ['en', 'es', 'fr'] as const) for (const theme of ['light', 'dark']) {
  test(`${locale} ${theme}: explore, sign up, resume in a fresh browser, save`, async ({ page, context, browser, baseURL }, testInfo) => {
    const m = catalogs[locale]; const state: { draft?: unknown; profile?: Record<string, unknown>; failSave?: boolean } = {};
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await fixtures(context, state);
    await page.goto('/');
    await expect(page.getByRole('link', { name: m.onboarding.welcome.explore, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Community test story' })).toBeVisible();
    const mobile = testInfo.project.name === 'mobile';
    const nav = page.getByRole('button', { name: mobile ? m.nav.openMenu : m.nav.community, exact: true });
    await nav.click(); await page.keyboard.press('Escape'); await expect(nav).toBeFocused();
    await page.goto('/join');
    await page.getByRole('textbox', { name: m.onboarding.name.displayNameLabel, exact: true }).fill('Browser Member');
    await page.getByRole('button', { name: m.onboarding.name.useDisplayName, exact: true }).click();
    await page.getByRole('textbox', { name: m.onboarding.city.inputAriaLabel, exact: true }).fill('Testville');
    await page.getByRole('button', { name: m.onboarding.chrome.continueViaDm, exact: true }).click();
    await page.getByRole('textbox', { name: m.onboarding.magicLogin.usernameAriaLabel }).fill('test_member');
    await page.getByRole('button', { name: m.onboarding.magicLogin.sendButton, exact: true }).click();
    await expect(page.getByText(m.onboarding.magicLogin.checkDmsHeadline, { exact: true })).toBeVisible();
    expect(state.draft).toMatchObject({ mafiaName: 'Browser Member', city: 'Testville' });

    // A second context has no localStorage/cookies from the originating browser.
    // Authenticated draft API is mocked; ownership/expiry are covered in route tests.
    const fresh = await browser.newContext({ viewport: testInfo.project.use.viewport, locale, reducedMotion: 'reduce' });
    await fresh.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }]);
    await fresh.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await fixtures(fresh, state);
    const resumed = await fresh.newPage(); resumed.on('pageerror', e => errors.push(e.message));
    await resumed.goto(`${baseURL}/?resumeSignup=1&discordId=test-discord&discordJoined=1`);
    await expect(resumed.getByText(m.onboarding.chrome.draftRestored, { exact: true })).toBeVisible();
    expect(state.profile).toBeUndefined(); // A DM link alone must not silently create a profile.
    await expect(resumed.getByRole('textbox', { name: m.onboarding.name.displayNameLabel, exact: true })).toHaveValue('Browser Member');
    await resumed.getByRole('button', { name: m.onboarding.name.useDisplayName, exact: true }).click();
    await expect(resumed.getByRole('textbox', { name: m.onboarding.city.inputAriaLabel, exact: true })).toHaveValue('Testville');
    state.failSave = true;
    await resumed.getByRole('button', { name: m.onboarding.chrome.finishSignup, exact: true }).click();
    await expect(resumed.getByText('Please retry saving', { exact: true })).toBeVisible();
    state.failSave = false;
    await resumed.getByRole('button', { name: m.onboarding.chrome.finishSignup, exact: true }).click();
    await expect(resumed.getByRole('link', { name: m.onboarding.finale.continueButton, exact: true })).toHaveAttribute('href', '/dashboard/990001');
    expect(state.profile).toMatchObject({ mafiaName: 'Browser Member', city: 'Testville', autoAssignMemberId: true });
    expect(await resumed.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
    await fresh.close();
  });
}

test('closed DMs offer recovery and an expired link returns to login', async ({ page, context }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://127.0.0.1:' + (process.env.ACTIVATION_TEST_PORT || '3106') }]);
  await fixtures(context, { loginStatus: 'dm_failed' });
  await page.goto('/login');
  await page.getByRole('textbox', { name: en.onboarding.magicLogin.usernameAriaLabel }).fill('test_member');
  await page.getByRole('button', { name: en.onboarding.magicLogin.sendButton, exact: true }).click();
  await expect(page.getByText(en.onboarding.magicLogin.openDmsHeadline, { exact: true })).toBeVisible();
  await page.goto('/login?loginError=link_expired');
  await expect(page.getByText(en.onboarding.magicLogin.errorLinkExpired, { exact: true })).toBeVisible();
});

test('crew summary offers a local call, contact, and an unclaimed task', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseURL! }]);
  await fixtures(context);
  await context.route('**/api/crew/tech', route => route.fulfill({ json: {
    crew: { id: 'tech', label: 'Tech', sheet: 'https://docs.google.com/spreadsheets/d/test', callTime: 'Mondays 3pm ET', callTimeUrl: 'https://discord.gg/pizzadao' },
    roster: [{ id: '42', name: 'Test Crew Lead', status: 'Lead', city: 'Testville' }],
    goals: [{ description: 'Make community tools easier to use' }],
    tasks: [{ task: 'Good first task: check a guide', stage: 'todo', lead: '', priority: '' }, { task: 'Finished work', stage: 'done', lead: '' }], agenda: [], callInfo: null,
  } }));
  await page.goto('/crew/tech');
  const summary = page.getByRole('region', { name: en.crewGettingStarted.title });
  await expect(summary.getByRole('link', { name: 'Add to calendar' })).toBeVisible();
  await expect(summary.getByRole('link', { name: 'Test Crew Lead' })).toHaveAttribute('href', '/profile/42');
  await expect(summary.getByText('Good first task: check a guide')).toBeVisible();
  await expect(summary.getByText('Finished work')).toHaveCount(0);
  await expect(summary.getByRole('link', { name: 'Log in to claim a task' })).toHaveAttribute('href', '/login?returnTo=%2Fcrew%2Ftech');
});
