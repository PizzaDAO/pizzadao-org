import { google } from "googleapis";
import path from "path";
import { cacheGet, cacheSet, CACHE_TTL } from "./cache";
import { GvizCell } from "@/app/lib/types/gviz";

// Initialize Google Sheets API client
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Check for env var credentials first (preferred for production)
let credentials;
try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        : undefined;
} catch (error) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Please ensure it is the full object starting with '{' and ending with '}'.");
}

const auth = new google.auth.GoogleAuth({
    credentials,
    keyFile: !credentials ? path.join(process.cwd(), "service-account.json") : undefined,
    scopes: SCOPES,
});

const sheets = google.sheets({ version: "v4", auth });

// Normalize string same way as crew route's cellVal/norm
function normalizeKey(s: string): string {
    return String(s ?? '').trim().replace(/\s+/g, ' ');
}

// Debug result type
export interface TaskLinksDebugResult {
    linkMap: Record<string, string>;
    error?: string;
    sheetsApiWorking: boolean;
    tasksAnchorFound: boolean;
    taskColFound: boolean;
    rowsProcessed: number;
}

// Debug result type for agenda links
export interface AgendaLinksDebugResult {
    linkMap: Record<string, string>;
    error?: string;
    sheetsApiWorking: boolean;
    agendaAnchorFound: boolean;
    agendaAnchorRow: number;
    agendaAnchorValue: string;
    stepColFound: boolean;
    stepColRow: number;
    detectionStrategy: 'anchor' | 'column-headers' | 'none';
    rowsProcessed: number;
    cellsInspected: Array<{ row: number; label: string; hyperlink: string | null }>;
}

// Extract rich text hyperlinks from a specific sheet
export async function getTaskLinks(sheetId: string): Promise<Record<string, string>> {
    // Check persistent cache first
    const cacheKey = `task-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
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
                    fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
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

                        if (hyperlink) {
                            linkMap[normalizeKey(label)] = hyperlink;
                        }
                    }
                }

                // SUCCESS - cache with 30 min TTL
                await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
                break;

            } catch (err: unknown) {
                const code = (err as any).code || (err as any).response?.status;
                // Google Sheets API sometimes returns 400 for quota issues if the quota is "user rate limit exceeded"? No, usually 429.
                // But let's be safe and check message too.
                const isRetryable =
                    code === 429 ||
                    code === 500 ||
                    code === 503 ||
                    ((err as any).message && (err as any).message.includes('Quota exceeded'));

                if (isRetryable) {
                    // Add jitter
                    const jitter = Math.random() * 500;
                    await new Promise(res => setTimeout(res, delay + jitter));
                    retries--;
                    delay *= 2;
                } else {
                    throw err;
                }
            }
        }
    } catch (error: unknown) {
        // Fallback or log
    }
    return linkMap;
}

/**
 * Debug version of getTaskLinks that returns diagnostic info
 */
export async function getTaskLinksDebug(sheetId: string): Promise<TaskLinksDebugResult> {
    const result: TaskLinksDebugResult = {
        linkMap: {},
        sheetsApiWorking: false,
        tasksAnchorFound: false,
        taskColFound: false,
        rowsProcessed: 0,
    };

    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            includeGridData: true,
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        result.sheetsApiWorking = true;

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) {
            result.error = 'No sheet data returned';
            return result;
        }

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows) continue;

            let tasksHeaderRowIdx = -1;
            let taskColIdx = -1;

            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                        cells[c]?.formattedValue?.toLowerCase() || "";
                    if (val === "tasks" || val === "task") {
                        tasksHeaderRowIdx = r;
                        result.tasksAnchorFound = true;
                        break;
                    }
                }
                if (tasksHeaderRowIdx !== -1) break;
            }

            if (tasksHeaderRowIdx === -1) continue;

            for (let offset = 1; offset <= 3; offset++) {
                const r = tasksHeaderRowIdx + offset;
                if (r >= rows.length) break;
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                        cells[c]?.formattedValue?.toLowerCase() || "";
                    if (val === "task") {
                        taskColIdx = c;
                        result.taskColFound = true;
                        break;
                    }
                }
                if (taskColIdx !== -1) break;
            }

            if (taskColIdx === -1) continue;

            for (let r = tasksHeaderRowIdx + 1; r < rows.length; r++) {
                result.rowsProcessed++;
                const cell = rows[r].values?.[taskColIdx];
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
                if (!hyperlink && cell.userEnteredValue?.formulaValue) {
                    const formula = cell.userEnteredValue.formulaValue;
                    const match = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                    if (match) hyperlink = match[1];
                }

                if (hyperlink) {
                    result.linkMap[normalizeKey(label)] = hyperlink;
                }
            }
        }
    } catch (error: unknown) {
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
}

/**
 * Extract hyperlinks from the Step column in the agenda section
 * Returns a map of step text -> hyperlink URL
 */
export async function getAgendaStepLinks(sheetId: string): Promise<Record<string, string>> {
    const cacheKey = `agenda-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
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
            if (!rows) continue;

            let agendaHeaderRowIdx = -1;
            let stepColIdx = -1;

            // Strategy 1: Try to find an "Agenda" anchor first
            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = (cells[c]?.userEnteredValue?.stringValue ||
                        cells[c]?.formattedValue || "").toLowerCase().trim();
                    if (val === "agenda" || val === "meeting agenda" ||
                        val.startsWith("agenda:") || val.startsWith("meeting agenda:")) {
                        agendaHeaderRowIdx = r;
                        break;
                    }
                }
                if (agendaHeaderRowIdx !== -1) break;
            }

            // If anchor found, look for "Step" column in nearby rows
            if (agendaHeaderRowIdx !== -1) {
                for (let offset = 0; offset <= 3; offset++) {
                    const r = agendaHeaderRowIdx + offset;
                    if (r >= rows.length) break;
                    const cells = rows[r].values || [];
                    for (let c = 0; c < cells.length; c++) {
                        const val = (cells[c]?.userEnteredValue?.stringValue ||
                            cells[c]?.formattedValue || "").toLowerCase().trim();
                        if (val === "step") {
                            stepColIdx = c;
                            agendaHeaderRowIdx = r;
                            break;
                        }
                    }
                    if (stepColIdx !== -1) break;
                }
            }

            // Strategy 2: Fallback - find agenda by column headers (step + action/lead)
            // This matches how the GViz parser detects agenda sections
            if (stepColIdx === -1) {
                for (let r = 0; r < rows.length; r++) {
                    const cells = rows[r].values || [];
                    const rowVals = cells.map((c: any) =>
                        (c?.userEnteredValue?.stringValue || c?.formattedValue || "").toLowerCase().trim()
                    );
                    // Agenda section: has "step" and either "action" or "lead"
                    if (rowVals.includes("step") && (rowVals.includes("action") || rowVals.includes("lead"))) {
                        agendaHeaderRowIdx = r;
                        stepColIdx = rowVals.indexOf("step");
                        break;
                    }
                }
            }

            if (stepColIdx === -1) continue;

            // Extract links from the Step column (stop at next section)
            for (let r = agendaHeaderRowIdx + 1; r < rows.length; r++) {
                const cells = rows[r].values || [];

                // Check if we hit another section header (Roster, Tasks, Goals)
                const rowVals = cells.map((c: any) =>
                    (c?.userEnteredValue?.stringValue || c?.formattedValue || "").toLowerCase().trim()
                );
                // Stop if this row looks like a section header
                if ((rowVals.includes("name") && (rowVals.includes("status") || rowVals.includes("city"))) ||
                    (rowVals.includes("task") && !rowVals.includes("step")) ||
                    (rowVals.includes("goal") && !rowVals.includes("step"))) {
                    break;
                }

                const cell = cells[stepColIdx];
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

                if (hyperlink) {
                    linkMap[normalizeKey(label)] = hyperlink;
                }
            }
        }

        await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
    } catch (error: unknown) {
    }
    return linkMap;
}

/**
 * Debug version of getAgendaStepLinks that returns diagnostic info
 */
export async function getAgendaStepLinksDebug(sheetId: string): Promise<AgendaLinksDebugResult> {
    const result: AgendaLinksDebugResult = {
        linkMap: {},
        sheetsApiWorking: false,
        agendaAnchorFound: false,
        agendaAnchorRow: -1,
        agendaAnchorValue: '',
        stepColFound: false,
        stepColRow: -1,
        detectionStrategy: 'none',
        rowsProcessed: 0,
        cellsInspected: [],
    };

    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            includeGridData: true,
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        result.sheetsApiWorking = true;

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) {
            result.error = 'No sheet data returned';
            return result;
        }

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows) continue;

            let agendaHeaderRowIdx = -1;
            let stepColIdx = -1;

            // Strategy 1: Try to find an "Agenda" anchor first
            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const rawVal = cells[c]?.userEnteredValue?.stringValue ||
                        cells[c]?.formattedValue || "";
                    const val = rawVal.toLowerCase().trim();
                    if (val === "agenda" || val === "meeting agenda" ||
                        val.startsWith("agenda:") || val.startsWith("meeting agenda:")) {
                        agendaHeaderRowIdx = r;
                        result.agendaAnchorFound = true;
                        result.agendaAnchorRow = r;
                        result.agendaAnchorValue = rawVal;
                        break;
                    }
                }
                if (agendaHeaderRowIdx !== -1) break;
            }

            // If anchor found, look for "Step" column in nearby rows
            if (agendaHeaderRowIdx !== -1) {
                for (let offset = 0; offset <= 3; offset++) {
                    const r = agendaHeaderRowIdx + offset;
                    if (r >= rows.length) break;
                    const cells = rows[r].values || [];
                    for (let c = 0; c < cells.length; c++) {
                        const val = (cells[c]?.userEnteredValue?.stringValue ||
                            cells[c]?.formattedValue || "").toLowerCase().trim();
                        if (val === "step") {
                            stepColIdx = c;
                            result.stepColFound = true;
                            result.stepColRow = r;
                            result.detectionStrategy = 'anchor';
                            agendaHeaderRowIdx = r;
                            break;
                        }
                    }
                    if (stepColIdx !== -1) break;
                }
            }

            // Strategy 2: Fallback - find agenda by column headers (step + action/lead)
            if (stepColIdx === -1) {
                for (let r = 0; r < rows.length; r++) {
                    const cells = rows[r].values || [];
                    const rowVals = cells.map((c: any) =>
                        (c?.userEnteredValue?.stringValue || c?.formattedValue || "").toLowerCase().trim()
                    );
                    // Agenda section: has "step" and either "action" or "lead"
                    if (rowVals.includes("step") && (rowVals.includes("action") || rowVals.includes("lead"))) {
                        agendaHeaderRowIdx = r;
                        stepColIdx = rowVals.indexOf("step");
                        result.stepColFound = true;
                        result.stepColRow = r;
                        result.detectionStrategy = 'column-headers';
                        break;
                    }
                }
            }

            if (stepColIdx === -1) {
                result.error = 'Could not find agenda section by anchor or column headers';
                continue;
            }

            // Extract links from the Step column (stop at next section)
            for (let r = agendaHeaderRowIdx + 1; r < rows.length; r++) {
                const cells = rows[r].values || [];

                // Check if we hit another section header (Roster, Tasks, Goals)
                const rowVals = cells.map((c: any) =>
                    (c?.userEnteredValue?.stringValue || c?.formattedValue || "").toLowerCase().trim()
                );
                // Stop if this row looks like a section header
                if ((rowVals.includes("name") && (rowVals.includes("status") || rowVals.includes("city"))) ||
                    (rowVals.includes("task") && !rowVals.includes("step")) ||
                    (rowVals.includes("goal") && !rowVals.includes("step"))) {
                    break;
                }

                result.rowsProcessed++;
                const cell = cells[stepColIdx];
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

                // Track inspected cells for debugging
                result.cellsInspected.push({
                    row: r,
                    label: normalizeKey(label),
                    hyperlink: hyperlink || null,
                });

                if (hyperlink) {
                    result.linkMap[normalizeKey(label)] = hyperlink;
                }
            }
        }
    } catch (error: unknown) {
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
}

// Debug result type for manual links
export interface ManualLinksDebugResult {
    linkMap: Record<string, string>;
    error?: string;
    sheetsApiWorking: boolean;
    headerRowIdx: number;
    manualColIdx: number;
    rowsProcessed: number;
    cellsInspected: Array<{ row: number; label: string; hyperlink: string | null }>;
}

/**
 * Configuration for manual table parsing
 * Uses anchor-based detection to handle Google Sheets Tables mode
 */
const MANUAL_HEADER_MAPPINGS: [string, string[]][] = [
    ['manual', ['manual', 'manuals', 'title', 'name']],
    ['crew', ['crew', 'team', 'group']],
    ['status', ['status', 'state', 'stage']],
    ['authorId', ['author id', 'authorid', 'member id']],
    ['author', ['author', 'creator', 'owner', 'by']],
    ['lastUpdated', ['last updated', 'updated', 'date', 'modified']],
    ['notes', ['notes', 'note', 'comments', 'description']],
];

/**
 * Find manual table headers using robust anchor-based detection
 * Handles Google Sheets Tables mode (filter dropdowns causing malformed GViz data)
 */
function findManualTableHeaders(
    rows: any[],
    getCellText: (cell: any) => string
): { headerRowIndex: number; columns: Record<string, number> } | null {
    const columns: Record<string, number> = {};

    // Initialize all columns as not found
    for (const [key] of MANUAL_HEADER_MAPPINGS) {
        columns[key] = -1;
    }

    // Search first 10 rows for header row
    for (let ri = 0; ri < Math.min(10, rows.length); ri++) {
        const cells = rows[ri]?.values || [];
        const rowVals = cells.map((c: any) => getCellText(c).toLowerCase().trim());

        // Look for "manual" or "manuals" column header
        let manualIdx = -1;
        for (let ci = 0; ci < rowVals.length; ci++) {
            const val = rowVals[ci];
            if (val === 'manual' || val === 'manuals' || val === 'title') {
                manualIdx = ci;
                break;
            }
        }

        // If we found the manual column, this is likely the header row
        if (manualIdx !== -1) {
            columns.manual = manualIdx;

            // Map all other columns
            const assignedCols = new Set<number>([manualIdx]);

            for (const [key, possibleHeaders] of MANUAL_HEADER_MAPPINGS) {
                if (columns[key] !== -1) continue;

                for (let ci = 0; ci < rowVals.length; ci++) {
                    if (assignedCols.has(ci)) continue;

                    const val = rowVals[ci];
                    for (const header of possibleHeaders) {
                        // Use exact match for single-word headers
                        if (val === header || val.includes(header)) {
                            columns[key] = ci;
                            assignedCols.add(ci);
                            break;
                        }
                    }
                    if (columns[key] !== -1) break;
                }
            }

            return { headerRowIndex: ri, columns };
        }
    }

    return null;
}

/**
 * Extract hyperlinks from the Manual column in the manuals spreadsheet
 * Returns a map of manual title -> hyperlink URL
 *
 * Uses robust anchor-based detection to handle:
 * - Google Sheets Tables mode (filter dropdowns)
 * - Dynamic header row position
 * - Various header naming conventions
 */
export async function getManualLinks(sheetId: string): Promise<Record<string, string>> {
    const cacheKey = `manual-links:${sheetId}`;
    const cached = await cacheGet<Record<string, string>>(cacheKey);
    if (cached) {
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

        // Helper to get cell text value
        const getCellText = (cell: any): string => {
            return cell?.userEnteredValue?.stringValue ||
                cell?.formattedValue || "";
        };

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows || rows.length === 0) continue;

            // Find header row and column indices using robust detection
            const headerResult = findManualTableHeaders(rows, getCellText);

            // Fallback: assume header at row 0, manual column at index 0
            let headerRowIndex = 0;
            let manualColIdx = 0;

            if (headerResult) {
                headerRowIndex = headerResult.headerRowIndex;
                manualColIdx = headerResult.columns.manual !== -1
                    ? headerResult.columns.manual
                    : 0;
            } else {
                // Legacy fallback: search first row for manual header
                const firstRowCells = rows[0]?.values || [];
                for (let c = 0; c < firstRowCells.length; c++) {
                    const val = getCellText(firstRowCells[c]).toLowerCase().trim();
                    if (val === "manual" || val === "manuals") {
                        manualColIdx = c;
                        break;
                    }
                }
            }

            // Extract links from the Manual column (start after header row)
            for (let r = headerRowIndex + 1; r < rows.length; r++) {
                const cell = rows[r]?.values?.[manualColIdx];
                if (!cell) continue;

                const label = cell.userEnteredValue?.stringValue || cell.formattedValue;
                if (!label) continue;

                // Skip if this looks like a header row (shouldn't happen but safety check)
                const labelLower = label.toLowerCase().trim();
                if (labelLower === 'manual' || labelLower === 'manuals' || labelLower === 'title') {
                    continue;
                }

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
                    // Use normalizeKey for consistent matching with API routes
                    linkMap[normalizeKey(label)] = hyperlink;
                }
            }
        }

        await cacheSet(cacheKey, linkMap, CACHE_TTL.TASK_LINKS);
    } catch (error: unknown) {
        console.error('getManualLinks error:', error);
    }
    return linkMap;
}

/**
 * Debug version of getManualLinks that returns diagnostic info
 */
export async function getManualLinksDebug(sheetId: string): Promise<ManualLinksDebugResult> {
    const result: ManualLinksDebugResult = {
        linkMap: {},
        sheetsApiWorking: false,
        headerRowIdx: -1,
        manualColIdx: -1,
        rowsProcessed: 0,
        cellsInspected: [],
    };

    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            includeGridData: true,
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        result.sheetsApiWorking = true;

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) {
            result.error = 'No sheet data returned';
            return result;
        }

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows || rows.length === 0) continue;

            // Find the header row by scanning first several rows
            for (let r = 0; r < Math.min(rows.length, 10); r++) {
                const rowCells = rows[r]?.values || [];
                for (let c = 0; c < rowCells.length; c++) {
                    const val = (rowCells[c]?.userEnteredValue?.stringValue ||
                        rowCells[c]?.formattedValue || "").toLowerCase().trim();
                    if (val === "manual" || val === "manuals" || val === "title") {
                        result.headerRowIdx = r;
                        result.manualColIdx = c;
                        break;
                    }
                }
                if (result.headerRowIdx !== -1) break;
            }

            // If still not found, default to row 0, column 0
            if (result.headerRowIdx === -1) {
                result.headerRowIdx = 0;
                result.manualColIdx = 0;
            }

            // Extract links from the Manual column
            for (let r = result.headerRowIdx + 1; r < rows.length; r++) {
                result.rowsProcessed++;
                const cell = rows[r]?.values?.[result.manualColIdx];
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

                if (!hyperlink && cell.userEnteredValue?.formulaValue) {
                    const formula = cell.userEnteredValue.formulaValue;
                    const match = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                    if (match) hyperlink = match[1];
                }

                result.cellsInspected.push({
                    row: r,
                    label: normalizeKey(label),
                    hyperlink: hyperlink || null,
                });

                if (label && hyperlink) {
                    result.linkMap[normalizeKey(label)] = hyperlink;
                }
            }
        }
    } catch (error: unknown) {
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
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
            const rowVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim().toLowerCase());
            if (rowVals.includes("name") && (rowVals.includes("turtles") || rowVals.includes("turtle"))) {
                headerRowIdx = ri;
                headerRowVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim().toLowerCase());
                break;
            }
        }

        if (headerRowIdx === -1) {
            return turtlesMap;
        }

        // Find column indices
        const nameIdx = headerRowVals.indexOf("name");
        const turtlesIdx = headerRowVals.includes("turtles")
            ? headerRowVals.indexOf("turtles")
            : headerRowVals.indexOf("turtle");

        if (nameIdx === -1 || turtlesIdx === -1) {
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

        // Cache as plain object (Maps don't serialize to JSON well)
        await cacheSet(cacheKey, Object.fromEntries(turtlesMap), MEMBER_TURTLES_CACHE_TTL);
    } catch (error: unknown) {
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
    } catch (error: unknown) {
    }
    return linkMap;
}
