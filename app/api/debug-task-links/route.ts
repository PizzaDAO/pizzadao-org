// Temporary debug endpoint - DELETE AFTER DEBUGGING
import { NextResponse } from 'next/server';
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let credentials;
try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        : undefined;
} catch (error) {
    // ignore
}

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
});

const sheets = google.sheets({ version: "v4", auth });

export async function GET(req: Request) {
    const url = new URL(req.url);
    const sheetId = url.searchParams.get('sheetId') || '1PGb50v1wu3QVEyft5IR6wF_qnO8KRboeLghp48cbuEg';

    const debug: any[] = [];
    const linkMap: Record<string, string> = {};

    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            includeGridData: true,
            fields: "sheets(data(rowData(values(userEnteredValue,formattedValue,hyperlink,textFormatRuns))))",
        });

        const sheetData = res.data.sheets?.[0];
        if (!sheetData?.data) {
            return NextResponse.json({ error: 'No sheet data', sheetId });
        }

        for (const grid of sheetData.data) {
            const rows = grid.rowData;
            if (!rows) continue;

            // Find "Tasks" anchor
            let tasksHeaderRowIdx = -1;
            let taskColIdx = -1;

            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                        cells[c]?.formattedValue?.toLowerCase() || "";
                    if (val === "tasks" || val === "task") {
                        tasksHeaderRowIdx = r;
                        debug.push({ event: 'foundTasksAnchor', row: r, col: c, val });
                        break;
                    }
                }
                if (tasksHeaderRowIdx !== -1) break;
            }

            if (tasksHeaderRowIdx === -1) {
                debug.push({ event: 'noTasksAnchorFound' });
                continue;
            }

            // Find "Task" column header
            for (let offset = 1; offset <= 3; offset++) {
                const r = tasksHeaderRowIdx + offset;
                if (r >= rows.length) break;
                const cells = rows[r].values || [];
                for (let c = 0; c < cells.length; c++) {
                    const val = cells[c]?.userEnteredValue?.stringValue?.toLowerCase() ||
                        cells[c]?.formattedValue?.toLowerCase() || "";
                    if (val === "task") {
                        taskColIdx = c;
                        debug.push({ event: 'foundTaskColumn', row: r, col: c });
                        break;
                    }
                }
                if (taskColIdx !== -1) break;
            }

            if (taskColIdx === -1) {
                debug.push({ event: 'noTaskColumnFound' });
                continue;
            }

            // Extract links
            for (let r = tasksHeaderRowIdx + 1; r < rows.length && r < tasksHeaderRowIdx + 50; r++) {
                const cell = rows[r].values?.[taskColIdx];
                if (!cell) continue;

                const label = cell.userEnteredValue?.stringValue || cell.formattedValue;
                if (!label) continue;

                // Check for hyperlink
                let hyperlink = cell.hyperlink;
                let linkSource = hyperlink ? 'hyperlink' : null;

                // Rich text links
                if (!hyperlink && cell.textFormatRuns) {
                    for (const run of cell.textFormatRuns) {
                        if (run?.format?.link?.uri) {
                            hyperlink = run.format.link.uri;
                            linkSource = 'textFormatRuns';
                            break;
                        }
                    }
                }

                // HYPERLINK formula
                if (!hyperlink && cell.userEnteredValue?.formulaValue) {
                    const formula = cell.userEnteredValue.formulaValue;
                    const match = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                    if (match) {
                        hyperlink = match[1];
                        linkSource = 'formula';
                    }
                }

                const entry: any = {
                    row: r,
                    label: label.trim(),
                    hasHyperlink: !!hyperlink,
                    linkSource,
                    hyperlink: hyperlink || null,
                    hasTextFormatRuns: !!cell.textFormatRuns,
                    textFormatRunsCount: cell.textFormatRuns?.length || 0,
                };

                // Check for "Pizza Chef" specifically
                if (label.toLowerCase().includes('pizza chef')) {
                    entry.cellData = JSON.stringify(cell, null, 2);
                }

                debug.push(entry);

                if (hyperlink) {
                    linkMap[label.trim()] = hyperlink;
                }
            }
        }

        return NextResponse.json({
            sheetId,
            linkMapSize: Object.keys(linkMap).length,
            linkMap,
            debug
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message, sheetId });
    }
}
