import { test, expect } from '@playwright/test';

test.describe('Dark mode on /crews', () => {
  test('page responds to dark theme data attribute', async ({ page }) => {
    await page.goto('/crews');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Set dark mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await page.waitForTimeout(500);

    // Verify the page background changed to dark mode color
    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('div[style*="min-height"]') || document.body;
      return getComputedStyle(el).backgroundColor;
    });

    // Dark mode background should not be the light mode #fafafa = rgb(250, 250, 250)
    expect(bgColor).not.toBe('rgb(250, 250, 250)');

    // Check that no elements have hardcoded white backgrounds in inline styles
    const hardcodedWhiteBgs = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const problems: string[] = [];
      allElements.forEach(el => {
        const style = (el as HTMLElement).style;
        if (
          style.background === 'white' || style.background === '#ffffff' ||
          style.background === '#fafafa' || style.background === '#e8f5e9' ||
          style.background === '#fff8e1' || style.background === '#f3f4f6' ||
          style.backgroundColor === 'white' || style.backgroundColor === '#ffffff' ||
          style.backgroundColor === '#fafafa'
        ) {
          problems.push(`${el.tagName}.${el.className}: bg=${style.background || style.backgroundColor}`);
        }
      });
      return problems;
    });

    expect(hardcodedWhiteBgs).toEqual([]);

    // Check that no elements have hardcoded black text in inline styles
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

    // Check that no elements have hardcoded rgba(0,0,0,...) borders in inline styles
    const hardcodedBorders = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const problems: string[] = [];
      allElements.forEach(el => {
        const style = (el as HTMLElement).style;
        const borderProps = [style.border, style.borderTop, style.borderBottom, style.borderLeft, style.borderRight];
        borderProps.forEach(bp => {
          if (bp && bp.includes('rgba(0,0,0,') && !bp.includes('var(')) {
            problems.push(`${el.tagName}.${el.className}: border contains rgba(0,0,0,...)`);
          }
        });
      });
      return problems;
    });

    expect(hardcodedBorders).toEqual([]);
  });

  test('page renders without style errors in light mode', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/crews');
    await page.waitForLoadState('networkidle');

    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();

    // Filter for style/CSS-related errors only
    const styleErrors = errors.filter(e => e.includes('style') || e.includes('CSS') || e.includes('theme'));
    expect(styleErrors).toEqual([]);
  });
});
