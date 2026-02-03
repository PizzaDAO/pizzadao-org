#!/usr/bin/env node
/**
 * Diagnostic script to verify Google Sheets API authentication is working.
 *
 * Usage:
 *   node scripts/verify-sheets-api.mjs
 *
 * This will:
 * 1. Load credentials from GOOGLE_SERVICE_ACCOUNT_JSON env var
 * 2. Try to authenticate with Google Sheets API
 * 3. Fetch the manuals sheet and extract hyperlinks
 * 4. Report the results
 */

import { google } from 'googleapis';

const MANUALS_SHEET_ID = '1KDAzz8qQubCaFiplWaUFBgCZlHR_mIA0IJHKNqgK5hg';

async function main() {
  console.log('\n=== Google Sheets API Verification ===\n');

  // Step 1: Check env var
  console.log('Step 1: Checking GOOGLE_SERVICE_ACCOUNT_JSON env var...');
  const envVar = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!envVar) {
    console.error('  ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    process.exit(1);
  }
  console.log('  Found: GOOGLE_SERVICE_ACCOUNT_JSON is set');

  // Step 2: Parse credentials
  console.log('\nStep 2: Parsing credentials JSON...');
  let credentials;
  try {
    credentials = JSON.parse(envVar);
    console.log('  Parsed successfully');
    console.log('  - type:', credentials.type);
    console.log('  - project_id:', credentials.project_id);
    console.log('  - client_email:', credentials.client_email);
    console.log('  - private_key_id:', credentials.private_key_id);
    console.log('  - has private_key:', !!credentials.private_key);
  } catch (e) {
    console.error('  ERROR: Failed to parse JSON:', e.message);
    process.exit(1);
  }

  // Step 3: Authenticate
  console.log('\nStep 3: Authenticating with Google...');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Step 4: Fetch sheet data
  console.log('\nStep 4: Fetching manuals sheet data...');
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: MANUALS_SHEET_ID,
      includeGridData: true,
      fields: 'sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))',
    });

    console.log('  SUCCESS: Sheet data fetched');

    const sheetData = res.data.sheets?.[0];
    if (!sheetData?.data) {
      console.log('  WARNING: No data in sheet');
      return;
    }

    // Step 5: Extract hyperlinks
    console.log('\nStep 5: Extracting hyperlinks from Manual column...');
    let headerRowIdx = -1;
    let manualColIdx = -1;
    const linkMap = {};

    for (const grid of sheetData.data) {
      const rows = grid.rowData || [];

      // Find header row
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const cells = rows[r]?.values || [];
        for (let c = 0; c < cells.length; c++) {
          const val = (cells[c]?.userEnteredValue?.stringValue ||
            cells[c]?.formattedValue || '').toLowerCase().trim();
          if (val === 'manual' || val === 'manuals' || val === 'title') {
            headerRowIdx = r;
            manualColIdx = c;
            break;
          }
        }
        if (headerRowIdx !== -1) break;
      }

      if (headerRowIdx === -1) {
        headerRowIdx = 0;
        manualColIdx = 0;
      }

      console.log(`  Header found at row ${headerRowIdx}, column ${manualColIdx}`);

      // Extract links
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const cell = rows[r]?.values?.[manualColIdx];
        if (!cell) continue;

        const label = cell.userEnteredValue?.stringValue || cell.formattedValue;
        if (!label) continue;

        let hyperlink = cell.hyperlink;
        if (!hyperlink && cell.textFormatRuns) {
          for (const run of cell.textFormatRuns) {
            if (run?.format?.link?.uri) {
              hyperlink = run.format.link.uri;
              break;
            }
          }
        }

        if (hyperlink) {
          linkMap[label.trim()] = hyperlink;
        }
      }
    }

    const linkCount = Object.keys(linkMap).length;
    console.log(`  Found ${linkCount} hyperlinks`);

    if (linkCount > 0) {
      console.log('\n  Sample hyperlinks:');
      const entries = Object.entries(linkMap).slice(0, 5);
      for (const [title, url] of entries) {
        console.log(`    - "${title}": ${url.substring(0, 60)}...`);
      }
    }

    console.log('\n=== Verification Complete ===');
    console.log(linkCount > 0 ? 'SUCCESS: Sheets API is working correctly!' : 'WARNING: No hyperlinks found (check if manuals have links)');

  } catch (e) {
    console.error('  ERROR:', e.message);
    if (e.message.includes('invalid_grant')) {
      console.error('\n  This error means the service account credentials are invalid.');
      console.error('  You need to generate new credentials in Google Cloud Console.');
    }
    process.exit(1);
  }
}

main();
