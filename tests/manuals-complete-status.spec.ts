import { test, expect } from '@playwright/test';

interface ManualResult {
  title: string;
  index: number;
  status: string;
  hasSheetContent: boolean;
  contentError: string | null;
  url: string | null;
}

interface DebugInfo {
  linkMap: Record<string, string>;
  sheetsApiWorking: boolean;
  headerRowIdx: number;
  manualColIdx: number;
  rowsProcessed: number;
  cellsInspected: Array<{ row: number; label: string; hyperlink: string | null }>;
  error?: string;
}

test.describe('Complete Manuals Sheet Content Verification', () => {
  test('All Complete manuals should display sheet content', async ({ page }) => {
    // Step 1: Navigate to manuals list page
    console.log('\n--- Step 1: Navigating to manuals list page ---');
    await page.goto('/manuals');
    await page.waitForLoadState('networkidle');

    // Wait for manuals to load (loading state goes away)
    await page.waitForSelector('.manual-card', { timeout: 30000 });

    // Step 2: Fetch API to get all manuals data with debug info
    console.log('\n--- Step 2: Fetching manuals data from API (with debug) ---');
    const apiResponse = await page.evaluate(async () => {
      const res = await fetch('/api/manuals?debug=1');
      return res.json();
    });

    const allManuals = apiResponse.manuals || [];
    const debugInfo: DebugInfo | undefined = apiResponse._debug;

    console.log(`Total manuals found: ${allManuals.length}`);

    // Report debug info about Sheets API
    if (debugInfo) {
      console.log('\n--- Sheets API Debug Info ---');
      console.log(`  sheetsApiWorking: ${debugInfo.sheetsApiWorking}`);
      console.log(`  headerRowIdx: ${debugInfo.headerRowIdx}`);
      console.log(`  manualColIdx: ${debugInfo.manualColIdx}`);
      console.log(`  rowsProcessed: ${debugInfo.rowsProcessed}`);
      console.log(`  linksFound: ${Object.keys(debugInfo.linkMap || {}).length}`);
      if (debugInfo.error) {
        console.log(`  ERROR: ${debugInfo.error}`);
      }
    }

    // Step 3: Filter for Complete status
    const completeManuals = allManuals
      .map((m: any, i: number) => ({ ...m, originalIndex: i }))
      .filter((m: any) => {
        const status = (m.status || '').toLowerCase();
        return status === 'complete' || status === 'completed';
      });

    console.log(`\n--- Step 3: Found ${completeManuals.length} Complete manuals ---`);

    if (completeManuals.length === 0) {
      console.log('No Complete manuals found to test');
      return;
    }

    // Categorize manuals by URL status
    const withUrl = completeManuals.filter((m: any) => m.url);
    const withoutUrl = completeManuals.filter((m: any) => !m.url);

    console.log(`  With URLs: ${withUrl.length}`);
    console.log(`  Without URLs: ${withoutUrl.length}`);

    // Log all complete manuals
    console.log('\n--- Complete Manuals List ---');
    completeManuals.forEach((m: any) => {
      console.log(`  [${m.originalIndex}] "${m.title}" (${m.crew}) - URL: ${m.url ? 'Yes' : 'NO'}`);
    });

    // Check if this is a Sheets API auth issue
    const sheetsApiAuthFailed = debugInfo?.error?.includes('invalid_grant') ||
                                debugInfo?.error?.includes('JWT') ||
                                debugInfo?.sheetsApiWorking === false;

    if (sheetsApiAuthFailed && withoutUrl.length > 0) {
      console.log('\n========================================');
      console.log('      SHEETS API AUTHENTICATION ISSUE');
      console.log('========================================');
      console.log('\nThe Google Sheets API is failing to authenticate.');
      console.log('This prevents extraction of hyperlinks from the manuals spreadsheet.');
      console.log('\nError:', debugInfo?.error || 'Unknown');
      console.log('\nPossible causes:');
      console.log('  1. GOOGLE_SERVICE_ACCOUNT_JSON env var is missing or invalid');
      console.log('  2. The service account credentials JSON is malformed');
      console.log('  3. The service account private key is corrupted');
      console.log('  4. The service account has been deleted or disabled');
      console.log('\nTo fix:');
      console.log('  1. Check Vercel project environment variables');
      console.log('  2. Ensure GOOGLE_SERVICE_ACCOUNT_JSON contains valid JSON');
      console.log('  3. Re-download service account credentials from Google Cloud Console');
      console.log('========================================\n');

      // Fail the test with clear message
      expect(sheetsApiAuthFailed,
        `Sheets API auth failed: ${debugInfo?.error}. Cannot extract hyperlinks from manuals.`
      ).toBe(false);
      return;
    }

    // Step 4: Visit each Complete manual WITH URL and verify sheet content
    console.log('\n--- Step 4: Verifying Complete manuals with URLs show sheet content ---');

    const results: ManualResult[] = [];

    // Only test manuals that have URLs
    for (const manual of withUrl) {
      console.log(`\nChecking: "${manual.title}" (index: ${manual.originalIndex})...`);

      // Navigate to manual detail page
      await page.goto(`/manuals/${manual.originalIndex}`);
      await page.waitForLoadState('networkidle');

      // Wait for content to load
      await page.waitForTimeout(2000);

      // Check if sheet content table exists
      const hasTable = await page.locator('table').count() > 0;

      // Check for error messages
      const hasNoSheetMessage = await page.locator('text="No Sheet Link"').count() > 0;
      const hasPrivateMessage = await page.locator('text="Private Sheet"').count() > 0;
      const hasNotFoundMessage = await page.locator('text="Sheet Not Found"').count() > 0;
      const hasUnableToLoad = await page.locator('text="Unable to Load Content"').count() > 0;

      let contentError: string | null = null;
      if (hasNoSheetMessage) contentError = 'No Sheet Link';
      else if (hasPrivateMessage) contentError = 'Private Sheet';
      else if (hasNotFoundMessage) contentError = 'Sheet Not Found';
      else if (hasUnableToLoad) contentError = 'Unable to Load Content';

      const hasSheetContent = hasTable && !contentError;

      const result: ManualResult = {
        title: manual.title,
        index: manual.originalIndex,
        status: manual.status,
        hasSheetContent,
        contentError,
        url: manual.url,
      };

      results.push(result);

      if (hasSheetContent) {
        console.log(`  PASS: Sheet content displayed`);
      } else {
        console.log(`  FAIL: ${contentError || 'No table found'}`);
        console.log(`    URL: ${manual.url || 'None'}`);
      }
    }

    // Step 5: Summary
    console.log('\n\n========================================');
    console.log('           TEST SUMMARY');
    console.log('========================================');

    const passed = results.filter(r => r.hasSheetContent);
    const failed = results.filter(r => !r.hasSheetContent);

    console.log(`\nTotal Complete manuals: ${completeManuals.length}`);
    console.log(`  With URLs: ${withUrl.length}`);
    console.log(`  Without URLs: ${withoutUrl.length} (need Sheets API or manual data entry)`);
    console.log(`\nManuals with URLs tested: ${results.length}`);
    console.log(`  Passed (showing sheet content): ${passed.length}`);
    console.log(`  Failed (missing sheet content): ${failed.length}`);

    if (passed.length > 0) {
      console.log('\n--- Passing Manuals ---');
      passed.forEach(r => {
        console.log(`  [${r.index}] ${r.title}`);
      });
    }

    if (failed.length > 0) {
      console.log('\n--- Failing Manuals (have URL but no content) ---');
      failed.forEach(r => {
        console.log(`  [${r.index}] ${r.title}`);
        console.log(`      Error: ${r.contentError || 'Unknown'}`);
        console.log(`      URL: ${r.url || 'None'}`);
      });
    }

    if (withoutUrl.length > 0) {
      console.log('\n--- Complete Manuals Missing URLs ---');
      console.log('These manuals are marked Complete but have no URL extracted:');
      withoutUrl.forEach((m: any) => {
        console.log(`  [${m.originalIndex}] ${m.title} (${m.crew})`);
      });
      console.log('\nTo fix: Either fix Sheets API auth or add URLs to spreadsheet.');
    }

    console.log('\n========================================\n');

    // Assert all Complete manuals with URLs show content
    expect(failed.length, `${failed.length} Complete manuals with URLs are missing sheet content`).toBe(0);

    // Also assert that we have URLs extracted (if not, Sheets API is broken)
    expect(withoutUrl.length,
      `${withoutUrl.length} Complete manuals are missing URLs. Sheets API may need to be fixed.`
    ).toBe(0);
  });
});
