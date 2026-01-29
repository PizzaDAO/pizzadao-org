import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

// Mobile viewport sizes to test
const viewports = {
  'iphone-se': { width: 375, height: 667 },
  'iphone-14': { width: 390, height: 844 },
  'pixel-7': { width: 412, height: 915 },
};

// Pages to audit (using placeholder IDs where needed)
const pages = [
  { name: 'home', path: '/' },
  { name: 'crews', path: '/crews' },
  { name: 'nfts', path: '/nfts' },
  { name: 'pep', path: '/pep' },
  { name: 'poaps', path: '/poaps' },
];

const outputDir = './mobile-audit-screenshots';

async function runAudit() {
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const issues = [];

  console.log('Starting mobile audit...\n');

  for (const viewport of Object.entries(viewports)) {
    const [deviceName, size] = viewport;
    console.log(`\n📱 Testing on ${deviceName} (${size.width}x${size.height})`);

    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    for (const route of pages) {
      const url = `${BASE_URL}${route.path}`;
      console.log(`  → ${route.name}: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1000); // Let animations settle

        // Take screenshot
        const screenshotPath = path.join(outputDir, `${route.name}-${deviceName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        // Check for common mobile issues
        const pageIssues = await page.evaluate(() => {
          const issues = [];
          const viewportWidth = window.innerWidth;

          // Check for horizontal overflow
          if (document.documentElement.scrollWidth > viewportWidth) {
            issues.push({
              type: 'horizontal-overflow',
              message: `Page has horizontal scroll (content: ${document.documentElement.scrollWidth}px, viewport: ${viewportWidth}px)`,
            });
          }

          // Check for elements wider than viewport
          const allElements = document.querySelectorAll('*');
          const overflowingElements = [];
          allElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > viewportWidth + 10) {
              const tagInfo = el.tagName + (el.className ? `.${el.className.toString().split(' ')[0]}` : '');
              if (!overflowingElements.includes(tagInfo)) {
                overflowingElements.push(tagInfo);
              }
            }
          });
          if (overflowingElements.length > 0) {
            issues.push({
              type: 'wide-elements',
              message: `Elements wider than viewport: ${overflowingElements.slice(0, 5).join(', ')}`,
            });
          }

          // Check for tiny touch targets (buttons/links smaller than 44x44)
          const touchTargets = document.querySelectorAll('a, button, input, [role="button"]');
          let smallTargets = 0;
          touchTargets.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
              smallTargets++;
            }
          });
          if (smallTargets > 0) {
            issues.push({
              type: 'small-touch-targets',
              message: `${smallTargets} touch targets smaller than 44x44px`,
            });
          }

          // Check for text that might be too small
          const textElements = document.querySelectorAll('p, span, a, li, td, th, label');
          let smallText = 0;
          textElements.forEach(el => {
            const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
            if (fontSize < 12 && el.textContent.trim().length > 0) {
              smallText++;
            }
          });
          if (smallText > 0) {
            issues.push({
              type: 'small-text',
              message: `${smallText} elements with font-size < 12px`,
            });
          }

          // Check for fixed positioned elements that might cause issues
          const fixedElements = [];
          allElements.forEach(el => {
            const position = window.getComputedStyle(el).position;
            if (position === 'fixed') {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                fixedElements.push(el.tagName + (el.className ? `.${el.className.toString().split(' ')[0]}` : ''));
              }
            }
          });
          if (fixedElements.length > 0) {
            issues.push({
              type: 'fixed-elements',
              message: `Fixed position elements found: ${fixedElements.slice(0, 3).join(', ')}`,
            });
          }

          return issues;
        });

        if (pageIssues.length > 0) {
          issues.push({
            page: route.name,
            device: deviceName,
            viewport: size,
            issues: pageIssues,
          });
          pageIssues.forEach(issue => {
            console.log(`    ⚠️  ${issue.type}: ${issue.message}`);
          });
        } else {
          console.log(`    ✅ No obvious issues detected`);
        }
      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
        issues.push({
          page: route.name,
          device: deviceName,
          viewport: size,
          issues: [{ type: 'error', message: error.message }],
        });
      }
    }

    await context.close();
  }

  await browser.close();

  // Write summary report
  const reportPath = path.join(outputDir, 'audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(issues, null, 2));

  console.log('\n\n📊 AUDIT SUMMARY');
  console.log('================');
  console.log(`Screenshots saved to: ${outputDir}/`);
  console.log(`Full report: ${reportPath}`);
  console.log(`\nTotal issues found: ${issues.reduce((acc, i) => acc + i.issues.length, 0)}`);

  // Group issues by type
  const issuesByType = {};
  issues.forEach(pageIssue => {
    pageIssue.issues.forEach(issue => {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = [];
      }
      issuesByType[issue.type].push(`${pageIssue.page} (${pageIssue.device})`);
    });
  });

  console.log('\nIssues by type:');
  Object.entries(issuesByType).forEach(([type, pages]) => {
    console.log(`  ${type}: ${pages.length} occurrences`);
  });
}

runAudit().catch(console.error);
