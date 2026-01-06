import { google } from "googleapis";
import path from "path";

// Initialize Google Sheets API client
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Check for env var credentials first (preferred for production)
let credentials;
try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        : undefined;
} catch (error) {
    console.error("Error parsing GOOGLE_SERVICE_ACCOUNT_JSON environment variable");
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Please ensure it is the full object starting with '{' and ending with '}'.");
}

const auth = new google.auth.GoogleAuth({
    credentials,
    keyFile: !credentials ? path.join(process.cwd(), "service-account.json") : undefined,
    scopes: SCOPES,
});

const sheets = google.sheets({ version: "v4", auth });

// Basic in-memory cache to prevent redundant API calls
const CACHE = new Map<string, { time: number, data: Record<string, string> }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Extract rich text hyperlinks from a specific sheet
export async function getTaskLinks(sheetId: string): Promise<Record<string, string>> {
    // Check cache first
    const cached = CACHE.get(sheetId);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        return cached.data;
    }

    const linkMap: Record<string, string> = {};
    try {
        // IMPLEMENTATION: Retry with exponential backoff and Jitter
        let retries = 5;
        let delay = 2000;

        while (retries > 0) {
            try {
                // Fetch the entire sheet data
                const res = await sheets.spreadsheets.get({
                    spreadsheetId: sheetId,
                    includeGridData: true,
                    fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink))))",
                });

                const sheetData = res.data.sheets?.[0];
                if (!sheetData?.data) return linkMap;

                for (const grid of sheetData.data) {
                    const rows = grid.rowData;
                    if (!rows) continue;

                    // Find the "Tasks" table anchor
                    let tasksHeaderRowIdx = -1;
                    let taskColIdx = -1;

                    // 1. Locate "Tasks" anchor
                    for (let r = 0; r < rows.length; r++) {
                        const cells = rows[r].values || [];
                        for (let c = 0; c < cells.length; c++) {
                            const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                                cells[c]?.formattedValue?.toLowerCase() || "";
                            if (val === "tasks" || val === "task") {
                                tasksHeaderRowIdx = r;
                                break;
                            }
                        }
                        if (tasksHeaderRowIdx !== -1) break;
                    }

                    if (tasksHeaderRowIdx === -1) continue;

                    // 2. Find "Task" column header (1-3 rows after anchor)
                    for (let offset = 1; offset <= 3; offset++) {
                        const r = tasksHeaderRowIdx + offset;
                        if (r >= rows.length) break;
                        const cells = rows[r].values || [];
                        for (let c = 0; c < cells.length; c++) {
                            const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                                cells[c]?.formattedValue?.toLowerCase() || "";
                            if (val === "task") {
                                taskColIdx = c;
                                break;
                            }
                        }
                        if (taskColIdx !== -1) break;
                    }

                    if (taskColIdx === -1) continue;

                    // 3. Extract links from the Task column
                    for (let r = tasksHeaderRowIdx + 1; r < rows.length; r++) {
                        const cell = rows[r].values?.[taskColIdx];
                        if (!cell) continue;

                        // Check for direct hyperlink field (Ctrl+K links)
                        const hyperlink = cell.hyperlink;
                        const label = cell.userEnteredValue?.stringValue || cell.formattedValue;

                        if (label && hyperlink) {
                            linkMap[label.trim()] = hyperlink;
                        }
                    }
                }

                // SUCCESS
                CACHE.set(sheetId, { time: Date.now(), data: linkMap });
                console.log(`[getTaskLinks] Extracted ${Object.keys(linkMap).length} links via Sheets API for ${sheetId}`);
                break;

            } catch (err: any) {
                const code = err.code || err.response?.status;
                // Google Sheets API sometimes returns 400 for quota issues if the quota is "user rate limit exceeded"? No, usually 429.
                // But let's be safe and check message too.
                const isRetryable =
                    code === 429 ||
                    code === 500 ||
                    code === 503 ||
                    (err.message && err.message.includes('Quota exceeded'));

                if (isRetryable) {
                    // Add jitter
                    const jitter = Math.random() * 500;
                    console.warn(`[getTaskLinks] API Error (${code} - ${err.message}). Retrying in ${delay + jitter}ms...`);
                    await new Promise(res => setTimeout(res, delay + jitter));
                    retries--;
                    delay *= 2;
                } else {
                    throw err;
                }
            }
        }
    } catch (error) {
        // Fallback or log
        console.error("[getTaskLinks] Exhausted retries:", error);
    }
    return linkMap;
}
