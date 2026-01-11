/**
 * Google Apps Script for PizzaDAO $PEP Jobs Sync
 *
 * SETUP INSTRUCTIONS:
 * 1. Open your Jobs spreadsheet: https://docs.google.com/spreadsheets/d/1uT91BJ8bhNPtd-Nfa40EOESHDuafOEpZusbygtIzqGU/edit
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Update the CONFIG values below with your actual values
 * 5. Save the project (Ctrl+S)
 * 6. Run the "setup" function once to create the trigger
 * 7. When prompted, authorize the script to access your spreadsheet
 */

// ============ CONFIGURATION ============
const CONFIG = {
  // Your deployed webhook URL (update when deployed to Vercel)
  WEBHOOK_URL: 'https://your-app.vercel.app/api/jobs/sync',

  // Must match JOB_SYNC_SECRET in your .env.local
  SYNC_SECRET: 'pep_jobs_sync_7d3f9a2c1b8e',

  // Column mapping (0-indexed)
  TYPE_COLUMN: 0,      // Column A: Job Type
  PROMPT_COLUMN: 1,    // Column B: Job Description/Prompt

  // Skip header row
  HEADER_ROWS: 1
};

/**
 * Run this function ONCE to set up the edit trigger
 */
function setup() {
  // Remove any existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Create new onEdit trigger
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  Logger.log('Trigger created! Edit any cell to sync jobs.');
}

/**
 * Triggered automatically when the sheet is edited
 */
function onSheetEdit(e) {
  // Debounce - wait a bit for batch edits
  Utilities.sleep(1000);

  // Sync all jobs
  syncJobs();
}

/**
 * Manual sync - can be run from Apps Script or added to a menu
 */
function syncJobs() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();

  // Parse jobs from spreadsheet
  const jobs = [];
  for (let i = CONFIG.HEADER_ROWS; i < data.length; i++) {
    const row = data[i];
    const type = row[CONFIG.TYPE_COLUMN]?.toString().trim();
    const description = row[CONFIG.PROMPT_COLUMN]?.toString().trim();

    // Skip empty rows
    if (!description) continue;

    jobs.push({
      sheetRow: i + 1, // 1-indexed for user reference
      type: type || 'General',
      description: description
    });
  }

  // Send to webhook
  try {
    const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'x-sync-secret': CONFIG.SYNC_SECRET
      },
      payload: JSON.stringify({ jobs }),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const body = response.getContentText();

    if (status === 200) {
      Logger.log(`Synced ${jobs.length} jobs successfully`);
    } else {
      Logger.log(`Sync failed: ${status} - ${body}`);
    }
  } catch (error) {
    Logger.log(`Sync error: ${error.message}`);
  }
}

/**
 * Add a custom menu to manually trigger sync
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('$PEP Jobs')
    .addItem('Sync Jobs Now', 'syncJobs')
    .addItem('Setup Trigger', 'setup')
    .addToUi();
}
