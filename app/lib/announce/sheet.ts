/**
 * Read / write the announcement block on the Crew sheet's "Crews" tab via the
 * Google service account (no Apps Script involved).
 *
 * Layout (found by label, like the Apps Script did, so moving the block is fine):
 *
 *   | Announce? | Sent | Last Sent: | 2026-08-08 15:49:51 | Last Error: | ... |
 *   | Announcement | Status | Crew | ...      <- header row of the specials table
 *   | <text, maybe hyperlinked> | To Do | Ops |
 *
 * Server-side only.
 */

import { google, type sheets_v4 } from "googleapis";
import { getGoogleAuth, GOOGLE_SCOPES } from "@/app/lib/google-auth";
import { parseHyperlinkFormula, type AnnouncementSpecial } from "./message";

export const ANNOUNCE_TAB = "Crews";
export const SEND_LABEL = "Announce?";
export const SENT_VALUE = "Sent";
export const LAST_SENT_LABEL = "Last Sent:";
export const LAST_ERROR_LABEL = "Last Error:";
/** Apps Script hard-coded the specials header on row 24; used if detection fails. */
const FALLBACK_HEADER_ROW_INDEX = 23;

export interface GridCell {
  text: string;
  link: string | null;
}

export interface AnnounceBlock {
  /** A1 ranges (with tab) of the value cell to the right of each label. */
  sendCell: string | null;
  lastSentCell: string | null;
  lastErrorCell: string | null;
  sendValue: string;
  lastSentValue: string;
  specials: AnnouncementSpecial[];
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

function colIndexToLetter(idx: number): string {
  let letter = "";
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
  }
  return letter;
}

function a1(tab: string, rowIdx: number, colIdx: number): string {
  return `'${tab}'!${colIndexToLetter(colIdx)}${rowIdx + 1}`;
}

function findLabel(grid: GridCell[][], label: string): { r: number; c: number } | null {
  const target = norm(label);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (norm(row[c]?.text) === target) return { r, c };
    }
  }
  return null;
}

/** Pure: locate the status cells and extract the specials rows from a grid. */
export function parseAnnounceGrid(grid: GridCell[][], tab = ANNOUNCE_TAB): AnnounceBlock {
  const cellText = (r: number, c: number) => grid[r]?.[c]?.text ?? "";

  const send = findLabel(grid, SEND_LABEL);
  const lastSent = findLabel(grid, LAST_SENT_LABEL);
  const lastError = findLabel(grid, LAST_ERROR_LABEL);

  // Header row of the specials table: column A says "Announcement" and the row
  // has a "Status" column.
  let headerRow = grid.findIndex(
    (row) => norm(row?.[0]?.text) === "announcement" && (row || []).some((c) => norm(c?.text) === "status"),
  );
  if (headerRow === -1) headerRow = FALLBACK_HEADER_ROW_INDEX;

  const header = (grid[headerRow] || []).map((c) => norm(c?.text));
  const statusCol = header.indexOf("status");
  if (statusCol === -1) {
    throw new Error(`Couldn't find a "Status" header in the Announcement table on the ${tab} tab.`);
  }
  const crewColFound = header.indexOf("crew");
  const crewCol = crewColFound === -1 ? 2 : crewColFound; // Apps Script used column C

  const specials: AnnouncementSpecial[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const text = cellText(r, 0).trim();
    if (!text) continue;
    specials.push({
      text,
      url: grid[r]?.[0]?.link ?? null,
      crew: cellText(r, crewCol),
      status: cellText(r, statusCol),
    });
  }

  return {
    sendCell: send ? a1(tab, send.r, send.c + 1) : null,
    lastSentCell: lastSent ? a1(tab, lastSent.r, lastSent.c + 1) : null,
    lastErrorCell: lastError ? a1(tab, lastError.r, lastError.c + 1) : null,
    sendValue: send ? cellText(send.r, send.c + 1).trim() : "",
    lastSentValue: lastSent ? cellText(lastSent.r, lastSent.c + 1).trim() : "",
    specials,
  };
}

/** Convert a Sheets API CellData into our GridCell (text + first link). */
export function toGridCell(cell: sheets_v4.Schema$CellData | undefined): GridCell {
  if (!cell) return { text: "", link: null };
  let link: string | null = cell.hyperlink ?? null;
  if (!link) {
    for (const run of cell.textFormatRuns ?? []) {
      const uri = run.format?.link?.uri;
      if (uri) {
        link = uri;
        break;
      }
    }
  }
  if (!link) link = parseHyperlinkFormula(cell.userEnteredValue?.formulaValue ?? null);
  return { text: cell.formattedValue ?? "", link };
}

export interface AnnounceSheetIO {
  readBlock(): Promise<AnnounceBlock>;
  /** Write several single cells (RAW). Ranges include the tab. */
  writeCells(updates: Array<{ range: string; value: string }>): Promise<void>;
}

let cachedClient: sheets_v4.Sheets | null = null;
function sheetsClient(): sheets_v4.Sheets {
  if (!cachedClient) {
    cachedClient = google.sheets({ version: "v4", auth: getGoogleAuth([GOOGLE_SCOPES.sheets]) });
  }
  return cachedClient;
}

export function createAnnounceSheetIO(
  spreadsheetId: string,
  tab = ANNOUNCE_TAB,
  client: () => sheets_v4.Sheets = sheetsClient,
): AnnounceSheetIO {
  return {
    async readBlock() {
      const res = await client().spreadsheets.get({
        spreadsheetId,
        ranges: [`'${tab}'`],
        includeGridData: true,
        fields:
          "sheets(data(startRow,startColumn,rowData(values(formattedValue,hyperlink,userEnteredValue(formulaValue),textFormatRuns(format(link(uri)))))))",
      });
      const data = res.data.sheets?.[0]?.data?.[0];
      if (!data) throw new Error(`Tab "${tab}" not found in the announcement spreadsheet.`);
      const startRow = data.startRow ?? 0;
      const startCol = data.startColumn ?? 0;
      const grid: GridCell[][] = [];
      (data.rowData ?? []).forEach((row, i) => {
        const cells: GridCell[] = [];
        (row.values ?? []).forEach((cell, j) => {
          cells[startCol + j] = toGridCell(cell);
        });
        grid[startRow + i] = cells;
      });
      for (let i = 0; i < grid.length; i++) grid[i] = grid[i] ?? [];
      return parseAnnounceGrid(grid, tab);
    },

    async writeCells(updates) {
      if (!updates.length) return;
      await client().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
        },
      });
    },
  };
}
