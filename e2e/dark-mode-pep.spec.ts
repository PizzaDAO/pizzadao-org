import { test, expect } from '@playwright/test';

test.describe('Dark mode on /pep', () => {
  test('page responds to dark theme data attribute', async ({ page }) => {
    // Go to the pep page
    await page.goto('/pep');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Page should render (even if not authenticated, we can check the login prompt)
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Get initial background of the main container
    const mainDiv = page.locator('div').first();

    // Set dark mode by adding data-theme attribute
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // Wait for styles to apply
    await page.waitForTimeout(500);

    // Verify the page background changed to dark mode color
    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('div[style*="min-height"]') || document.body;
      return getComputedStyle(el).backgroundColor;
    });

    // Dark mode background should be dark (rgb values should be low)
    // var(--color-page-bg) in dark mode = #0f0f0f = rgb(15, 15, 15)
    expect(bgColor).not.toBe('rgb(250, 250, 250)'); // Should NOT be the light mode #fafafa

    // Check that no elements have hardcoded white backgrounds that don't respond to theme
    const hardcodedWhiteBgs = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const problems: string[] = [];
      allElements.forEach(el => {
        const style = (el as HTMLElement).style;
        if (style.background === 'white' || style.background === '#ffffff' || style.background === '#fafafa' ||
            style.backgroundColor === 'white' || style.backgroundColor === '#ffffff' || style.backgroundColor === '#fafafa') {
          problems.push(`${el.tagName}.${el.className}: bg=${style.background || style.backgroundColor}`);
        }
      });
      return problems;
    });

    expect(hardcodedWhiteBgs).toEqual([]);

    // Check that no elements have hardcoded black text that doesn't respond to theme
    const hardcodedBlackText = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const problems: string[] = [];
      allElements.forEach(el => {
        const style = (el as HTMLElement).style;
        if (style.color === '#000' || style.color === '#000000' || style.color === 'black') {
          problems.push(`${el.tagName}.${el.className}: color=${style.color}`);
        }
      });
      return problems;
    });

    expect(hardcodedBlackText).toEqual([]);
  });

  test('page renders without errors in light mode', async ({ page }) => {
    // Set up console error listener before navigation
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/pep');
    await page.waitForLoadState('networkidle');

    // Should see either the login prompt or the economy page
    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();

    // Reload to capture any console errors
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Filter out expected API errors (auth-related since we're not logged in)
    const styleErrors = errors.filter(e => e.includes('style') || e.includes('CSS') || e.includes('theme'));
    expect(styleErrors).toEqual([]);
  });
});
