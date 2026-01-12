import { google } from "googleapis";
import path from "path";
import { cacheGet, cacheSet, CACHE_TTL } from "./cache";

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

// Extract rich text hyperlinks from a specific sheet
export async function getTaskLinks(sheetId: string): Promise<Record<string, string>> {
    // Check persistent cache first
    const cacheKey = `task-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
        console.log(`[getTaskLinks] Cache hit for ${sheetId}`);
        return cached;
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

                // SUCCESS - cache with 30 min TTL
                await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
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

/**
 * Extract hyperlinks from the Step column in the agenda section
 * Returns a map of step text -> hyperlink URL
 */
export async function getAgendaStepLinks(sheetId: string): Promise<Record<string, string>> {
    const cacheKey = `agenda-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
        console.log(`[getAgendaStepLinks] Cache hit for ${sheetId}`);
        return cached;
    }

    const linkMap: Record<string, string> = {};
    try {
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

            // Find the "Agenda" section
            let agendaHeaderRowIdx = -1;
            let stepColIdx = -1;

            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = (cells[c]?.userEnteredValue?.stringValue ||
                        cells[c]?.formattedValue || "").toLowerCase().trim();
                    if (val === "agenda" || val === "meeting agenda") {
                        agendaHeaderRowIdx = r;
                        break;
                    }
                }
                if (agendaHeaderRowIdx !== -1) break;
            }

            if (agendaHeaderRowIdx === -1) continue;

            // Find "Step" column header (1-3 rows after anchor)
            for (let offset = 0; offset <= 3; offset++) {
                const r = agendaHeaderRowIdx + offset;
                if (r >= rows.length) break;
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = (cells[c]?.userEnteredValue?.stringValue ||
                        cells[c]?.formattedValue || "").toLowerCase().trim();
                    if (val === "step") {
                        stepColIdx = c;
                        agendaHeaderRowIdx = r; // Update to actual header row
                        break;
                    }
                }
                if (stepColIdx !== -1) break;
            }

            if (stepColIdx === -1) continue;

            // Extract links from the Step column
            for (let r = agendaHeaderRowIdx + 1; r < rows.length; r++) {
                const cell = rows[r].values?.[stepColIdx];
                if (!cell) continue;

                const hyperlink = cell.hyperlink;
                const label = cell.userEnteredValue?.stringValue || cell.formattedValue;

                if (label && hyperlink) {
                    linkMap[label.trim()] = hyperlink;
                }
            }
        }

        await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
        console.log(`[getAgendaStepLinks] Extracted ${Object.keys(linkMap).length} links for ${sheetId}`);
    } catch (error) {
        console.error("[getAgendaStepLinks] Error:", error);
    }
    return linkMap;
}

/**
 * Extract hyperlinks from the Manual column in the manuals spreadsheet
 * Returns a map of manual title -> hyperlink URL
 */
export async function getManualLinks(sheetId: string): Promise<Record<string, string>> {
    const cacheKey = `manual-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
        console.log(`[getManualLinks] Cache hit for ${sheetId}`);
        return cached;
    }

    const linkMap: Record<string, string> = {};
    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            includeGridData: true,
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) return linkMap;

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows || rows.length === 0) continue;

            // Find the "Manual" column (should be first column, index 0)
            const headerRow = rows[0]?.values || [];
            let manualColIdx = -1;

            for (let c = 0; c < headerRow.length; c++) {
                const val = (headerRow[c]?.userEnteredValue?.stringValue ||
                    headerRow[c]?.formattedValue || "").toLowerCase().trim();
                if (val === "manual" || val === "manuals") {
                    manualColIdx = c;
                    break;
                }
            }

            // Default to first column if no header found
            if (manualColIdx === -1) manualColIdx = 0;

            // Extract links from the Manual column (start from row 1 to skip header)
            for (let r = 1; r < rows.length; r++) {
                const cell = rows[r]?.values?.[manualColIdx];
                if (!cell) continue;

                const label = cell.userEnteredValue?.stringValue || cell.formattedValue;
                if (!label) continue;

                // Try multiple ways to get the hyperlink:
                // 1. Direct hyperlink property (Ctrl+K links)
                let hyperlink = cell.hyperlink;

                // 2. Rich text links (textFormatRuns with link.uri)
                if (!hyperlink && cell.textFormatRuns) {
                    for (const run of cell.textFormatRuns) {
                        if (run?.format?.link?.uri) {
                            hyperlink = run.format.link.uri;
                            break;
                        }
                    }
                }

                // 3. HYPERLINK formula in userEnteredValue
                if (!hyperlink && cell.userEnteredValue?.formulaValue) {
                    const formula = cell.userEnteredValue.formulaValue;
                    const match = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                    if (match) {
                        hyperlink = match[1];
                    }
                }

                if (label && hyperlink) {
                    linkMap[label.trim()] = hyperlink;
                }
            }
        }

        await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
        console.log(`[getManualLinks] Extracted ${Object.keys(linkMap).length} links for ${sheetId}`);
    } catch (error) {
        console.error("[getManualLinks] Error:", error);
    }
    return linkMap;
}

// Member turtles cache TTL
const MEMBER_TURTLES_CACHE_TTL = 60 * 10; // 10 minutes in seconds

// Main members database sheet
const MEMBERS_SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const MEMBERS_TAB_NAME = "Crew";

// Core TMNT turtle roles to display on crew cards
const CORE_TURTLE_ROLES = new Set([
    "leonardo",
    "donatello",
    "michelangelo",
    "raphael",
    "april",
    "splinter",
    "foot clan",
]);

/**
 * Filter a comma-separated turtles string to only include core TMNT roles
 */
function filterCoreTurtles(turtlesStr: string): string {
    if (!turtlesStr) return "";
    const turtles = turtlesStr.split(",").map(t => t.trim()).filter(Boolean);
    const filtered = turtles.filter(t => CORE_TURTLE_ROLES.has(t.toLowerCase()));
    return filtered.join(", ");
}

/**
 * Fetch member name → turtles mapping from the main members database
 * Uses GViz for public read access (doesn't require service account permissions on this sheet)
 */
export async function getMemberTurtlesMap(): Promise<Map<string, string>> {
    // Check persistent cache
    const cacheKey = "member-turtles-map";
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
        console.log("[getMemberTurtlesMap] Cache hit");
        return new Map(Object.entries(cached));
    }

    const turtlesMap = new Map<string, string>();

    try {
        const url = `https://docs.google.com/spreadsheets/d/${MEMBERS_SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(MEMBERS_TAB_NAME)}&tqx=out:json&headers=0`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch members sheet");

        const text = await res.text();
        const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) throw new Error("GViz parse error");

        const gviz = JSON.parse(cleaned.slice(start, end + 1));
        const rows = gviz?.table?.rows || [];

        // Find header row
        let headerRowIdx = -1;
        let headerRowVals: string[] = [];

        for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
            const rowCells = rows[ri]?.c || [];
            const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
            if (rowVals.includes("name") && (rowVals.includes("turtles") || rowVals.includes("turtle"))) {
                headerRowIdx = ri;
                headerRowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
                break;
            }
        }

        if (headerRowIdx === -1) {
            console.warn("[getMemberTurtlesMap] Could not find header row with Name and Turtles columns");
            return turtlesMap;
        }

        // Find column indices
        const nameIdx = headerRowVals.indexOf("name");
        const turtlesIdx = headerRowVals.includes("turtles")
            ? headerRowVals.indexOf("turtles")
            : headerRowVals.indexOf("turtle");

        if (nameIdx === -1 || turtlesIdx === -1) {
            console.warn("[getMemberTurtlesMap] Missing Name or Turtles column");
            return turtlesMap;
        }

        // Extract name → turtles mapping (filtered to core TMNT roles only)
        for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
            const cells = rows[ri]?.c || [];
            const name = String(cells[nameIdx]?.v ?? cells[nameIdx]?.f ?? "").trim();
            const turtlesRaw = String(cells[turtlesIdx]?.v ?? cells[turtlesIdx]?.f ?? "").trim();
            const turtles = filterCoreTurtles(turtlesRaw);

            if (name && turtles) {
                // Normalize name for matching (lowercase, remove extra spaces)
                const normalizedName = name.toLowerCase().replace(/\s+/g, " ");
                turtlesMap.set(normalizedName, turtles);
            }
        }

        console.log(`[getMemberTurtlesMap] Loaded ${turtlesMap.size} member turtle mappings`);
        // Cache as plain object (Maps don't serialize to JSON well)
        await cacheSet(cacheKey, Object.fromEntries(turtlesMap), MEMBER_TURTLES_CACHE_TTL);
    } catch (error) {
        console.error("[getMemberTurtlesMap] Error:", error);
    }

    return turtlesMap;
}

/**
 * Extract hyperlinks from a specific column, keyed by another column's value
 * Handles: Ctrl+K links, rich text links, and HYPERLINK formulas
 * @param sheetId - The spreadsheet ID
 * @param tabName - The tab/sheet name
 * @param keyColumn - Column name to use as the key (e.g., "Crew")
 * @param linkColumn - Column name containing the hyperlinks (e.g., "Call Time")
 * @returns Map of key value -> hyperlink URL
 */
export async function getColumnHyperlinks(
    sheetId: string,
    tabName: string,
    keyColumn: string,
    linkColumn: string
): Promise<Record<string, string>> {
    const cacheKey = `col-links:${sheetId}:${tabName}:${keyColumn}:${linkColumn}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
        console.log(`[getColumnHyperlinks] Cache hit for ${tabName}:${linkColumn}`);
        return cached;
    }

    const linkMap: Record<string, string> = {};
    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            ranges: [`'${tabName}'`],
            includeGridData: true,
            // Include textFormatRuns for rich text links
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) return linkMap;

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows || rows.length === 0) continue;

            // Find header row and column indices
            const headerRow = rows[0]?.values || [];
            let keyColIdx = -1;
            let linkColIdx = -1;

            for (let c = 0; c < headerRow.length; c++) {
                const val = (headerRow[c]?.userEnteredValue?.stringValue ||
                    headerRow[c]?.formattedValue || "").toLowerCase().trim();
                if (val.includes(keyColumn.toLowerCase())) keyColIdx = c;
                if (val.includes(linkColumn.toLowerCase())) linkColIdx = c;
            }

            if (keyColIdx === -1 || linkColIdx === -1) continue;

            // Extract hyperlinks from data rows
            for (let r = 1; r < rows.length; r++) {
                const cells = rows[r]?.values || [];
                const keyCell = cells[keyColIdx];
                const linkCell = cells[linkColIdx];

                const keyValue = keyCell?.userEnteredValue?.stringValue ||
                    keyCell?.formattedValue || "";

                // Try multiple ways to get the hyperlink:
                // 1. Direct hyperlink property (Ctrl+K links)
                let hyperlink = linkCell?.hyperlink;

                // 2. Rich text links (textFormatRuns with link.uri)
                if (!hyperlink && linkCell?.textFormatRuns) {
                    for (const run of linkCell.textFormatRuns) {
                        if (run?.format?.link?.uri) {
                            hyperlink = run.format.link.uri;
                            break;
                        }
                    }
                }

                // 3. HYPERLINK formula in userEnteredValue
                if (!hyperlink && linkCell?.userEnteredValue?.formulaValue) {
                    const formula = linkCell.userEnteredValue.formulaValue;
                    const match = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                    if (match) {
                        hyperlink = match[1];
                    }
                }

                if (keyValue && hyperlink) {
                    linkMap[keyValue.trim()] = hyperlink;
                }
            }
        }

        await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
        console.log(`[getColumnHyperlinks] Extracted ${Object.keys(linkMap).length} links from ${tabName}:${linkColumn}`);
    } catch (error) {
        console.error("[getColumnHyperlinks] Error:", error);
    }
    return linkMap;
}
