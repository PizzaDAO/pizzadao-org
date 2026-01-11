/**
 * Google Apps Script for PizzaDAO $PEP Jobs & Shop Sync
 * Automatically syncs jobs and shop items from this spreadsheet to the web dashboard
 */

// ============ CONFIGURATION ============
const CONFIG = {
  // Base webhook URL (update when deployed to Vercel)
  BASE_URL: 'https://nonprolifically-flourishing-edgardo.ngrok-free.dev',

  // Must match JOB_SYNC_SECRET in your .env.local
  SYNC_SECRET: 'pep_jobs_sync_7d3f9a2c1b8e',

  // Sheet names
  JOBS_SHEET: 'Jobs',
  SHOP_SHEET: 'Shop',

  // Jobs column mapping (0-indexed)
  JOBS: {
    TYPE_COLUMN: 0,      // Column A: Job Type
    PROMPT_COLUMN: 1,    // Column B: Job Description/Prompt
    HEADER_ROWS: 1
  },

  // Shop column mapping (0-indexed)
  SHOP: {
    NAME_COLUMN: 0,        // Column A: Item Name
    DESCRIPTION_COLUMN: 1, // Column B: Description
    PRICE_COLUMN: 2,       // Column C: Price
    QUANTITY_COLUMN: 3,    // Column D: Quantity (-1 for unlimited)
    IMAGE_COLUMN: 4,       // Column E: Image URL
    HEADER_ROWS: 1
  }
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

  Logger.log('Trigger created! Edit any cell to sync.');
}

/**
 * Triggered automatically when the sheet is edited
 */
function onSheetEdit(e) {
  // Debounce - wait a bit for batch edits
  Utilities.sleep(1000);

  const sheetName = e.source.getActiveSheet().getName();

  // Sync based on which sheet was edited
  if (sheetName === CONFIG.JOBS_SHEET || sheetName.toLowerCase().includes('job')) {
    syncJobs();
  } else if (sheetName === CONFIG.SHOP_SHEET || sheetName.toLowerCase().includes('shop')) {
    syncShopItems();
  }
}

/**
 * Sync jobs from the Jobs sheet
 */
function syncJobs() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.JOBS_SHEET);

  // Fallback to first sheet if Jobs sheet doesn't exist
  if (!sheet) {
    sheet = spreadsheet.getSheets()[0];
  }

  const data = sheet.getDataRange().getValues();

  // Parse jobs from spreadsheet
  const jobs = [];
  for (let i = CONFIG.JOBS.HEADER_ROWS; i < data.length; i++) {
    const row = data[i];
    const type = row[CONFIG.JOBS.TYPE_COLUMN]?.toString().trim();
    const description = row[CONFIG.JOBS.PROMPT_COLUMN]?.toString().trim();

    // Skip empty rows
    if (!description) continue;

    jobs.push({
      sheetRow: i + 1, // 1-indexed for user reference
      type: type || 'General',
      description: description
    });
  }

  // Send to webhook
  const url = CONFIG.BASE_URL + '/api/jobs/sync';
  sendToWebhook(url, { jobs }, 'jobs');
}

/**
 * Sync shop items from the Shop sheet
 */
function syncShopItems() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CONFIG.SHOP_SHEET);

  if (!sheet) {
    Logger.log('Shop sheet not found. Create a sheet named "Shop".');
    return;
  }

  const data = sheet.getDataRange().getValues();

  // Parse items from spreadsheet
  const items = [];
  for (let i = CONFIG.SHOP.HEADER_ROWS; i < data.length; i++) {
    const row = data[i];
    const name = row[CONFIG.SHOP.NAME_COLUMN]?.toString().trim();
    const description = row[CONFIG.SHOP.DESCRIPTION_COLUMN]?.toString().trim();
    const priceRaw = row[CONFIG.SHOP.PRICE_COLUMN];
    const quantityRaw = row[CONFIG.SHOP.QUANTITY_COLUMN];
    const image = row[CONFIG.SHOP.IMAGE_COLUMN]?.toString().trim();

    // Skip empty rows (name and price are required)
    if (!name) continue;

    const price = parseInt(priceRaw, 10);
    if (isNaN(price)) continue;

    // Parse quantity (-1 for unlimited if empty or -1)
    let quantity = parseInt(quantityRaw, 10);
    if (isNaN(quantity) || quantity < 0) {
      quantity = -1; // Unlimited
    }

    items.push({
      name: name,
      description: description || null,
      price: price,
      quantity: quantity,
      image: image || null
    });
  }

  // Send to webhook
  const url = CONFIG.BASE_URL + '/api/shop/sync';
  sendToWebhook(url, { items }, 'shop items');
}

/**
 * Send data to webhook
 */
function sendToWebhook(url, payload, dataType) {
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'x-sync-secret': CONFIG.SYNC_SECRET
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const body = response.getContentText();

    if (status === 200) {
      const result = JSON.parse(body);
      Logger.log(`Synced ${dataType} successfully: ${body}`);
    } else {
      Logger.log(`Sync failed: ${status} - ${body}`);
    }
  } catch (error) {
    Logger.log(`Sync error: ${error.message}`);
  }
}

/**
 * Sync everything - both jobs and shop items
 */
function syncAll() {
  syncJobs();
  syncShopItems();
}

/**
 * Create the Shop tab with initial items
 * Run this once to set up the shop sheet
 */
function createShopTab() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  // Check if Shop sheet already exists
  let sheet = spreadsheet.getSheetByName(CONFIG.SHOP_SHEET);
  if (sheet) {
    Logger.log('Shop sheet already exists');
    return;
  }

  // Create new Shop sheet
  sheet = spreadsheet.insertSheet(CONFIG.SHOP_SHEET);

  // Set up headers
  const headers = ['Name', 'Description', 'Price', 'Quantity', 'Image'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // Add initial shop items
  const items = [
    ['Pizza Sticks', 'Redeem this item with [/item use] for a Pizza Sticks NFT. https://opensea.io/collection/neo-bambino-s-pizza-sticks-and-sauce', 1337, -1, ''],
    ['Proof of Pizza', 'Redeemable for $25 worth of pizza from the pizza faucet. http://pizzafaucet.xyz/', 13370, -1, ''],
    ['Global Pizza Party Shirt', 'Redeem this with [/item use] to get a global pizza party 2025 shirt shipped to you.', 20240, -1, ''],
    ['Rare Pizza Box', 'Redeem this item for a Rare Pizza Box NFT.', 42069, -1, '']
  ];

  sheet.getRange(2, 1, items.length, items[0].length).setValues(items);

  // Auto-resize columns
  sheet.autoResizeColumns(1, headers.length);

  Logger.log('Shop tab created with ' + items.length + ' items');
}

/**
 * Add a custom menu to manually trigger sync
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('$PEP Sync')
    .addItem('Sync Jobs', 'syncJobs')
    .addItem('Sync Shop Items', 'syncShopItems')
    .addItem('Sync All', 'syncAll')
    .addSeparator()
    .addItem('Create Shop Tab', 'createShopTab')
    .addItem('Setup Trigger', 'setup')
    .addToUi();
}
