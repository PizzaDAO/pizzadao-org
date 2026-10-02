import { describe, it, expect, vi } from "vitest";

// No real Google access from these tests.
vi.mock("googleapis", () => ({
  google: { auth: { GoogleAuth: vi.fn() }, sheets: vi.fn(() => { throw new Error("real sheets client used"); }) },
}));

import type { sheets_v4 } from "googleapis";
import { createAnnounceSheetIO, parseAnnounceGrid, toGridCell, type GridCell } from "./sheet";

const t = (text: string, link: string | null = null): GridCell => ({ text, link });

/** Mirrors the real Crews tab: crew list, blank row, status block (row 23), table header (row 24). */
function realisticGrid(): GridCell[][] {
  const grid: GridCell[][] = [];
  grid[0] = [t("Crew"), t("Status")];
  for (let r = 1; r < 21; r++) grid[r] = [t(`PizzaDAO Crew ${r}`), t("Hot")];
  grid[21] = [];
  grid[22] = [
    t(""),
    t("Announce?"),
    t("Sent"),
    t("Last Sent:"),
    t("2026-08-08 15:49:51"),
    t("Last Error: "),
    t("Cloudflare is blocking Apps Script right now. [2026-05-23 14:02:21]"),
  ];
  grid[23] = [t("Announcement"), t("Status"), t("Crew"), t("Goals"), t("Notes")];
  grid[24] = [t("Ops Crew Long Term + 2026 Goals"), t("To Do"), t("Ops")];
  grid[25] = [t("PizzaDAO projects", "https://pizzadao.org/tech/projects"), t("To Do")];
  grid[26] = [t("Pizza Expo Activation"), t("Lapsed")];
  grid[27] = [t(""), t("To Do")];
  return grid;
}

describe("parseAnnounceGrid", () => {
  it("finds the status cells by label and reads the specials table", () => {
    const block = parseAnnounceGrid(realisticGrid());
    expect(block.sendCell).toBe("'Crews'!C23");
    expect(block.lastSentCell).toBe("'Crews'!E23");
    expect(block.lastErrorCell).toBe("'Crews'!G23");
    expect(block.sendValue).toBe("Sent");
    expect(block.lastSentValue).toBe("2026-08-08 15:49:51");
    expect(block.specials).toEqual([
      { text: "Ops Crew Long Term + 2026 Goals", url: null, crew: "Ops", status: "To Do" },
      { text: "PizzaDAO projects", url: "https://pizzadao.org/tech/projects", crew: "", status: "To Do" },
      { text: "Pizza Expo Activation", url: null, crew: "", status: "Lapsed" },
    ]);
  });

  it("returns null cells when labels are missing", () => {
    const grid = realisticGrid();
    grid[22] = [];
    const block = parseAnnounceGrid(grid);
    expect(block.sendCell).toBeNull();
    expect(block.lastSentCell).toBeNull();
    expect(block.lastErrorCell).toBeNull();
  });

  it("throws when the table has no Status header", () => {
    const grid = realisticGrid();
    grid[23] = [t("Announcement"), t("Nope")];
    expect(() => parseAnnounceGrid(grid)).toThrow(/Status/);
  });
});

describe("toGridCell", () => {
  it("prefers the cell hyperlink, then text-run links, then HYPERLINK formulas", () => {
    expect(toGridCell({ formattedValue: "a", hyperlink: "https://h.test" }).link).toBe("https://h.test");
    expect(
      toGridCell({ formattedValue: "a", textFormatRuns: [{ format: {} }, { format: { link: { uri: "https://r.test" } } }] })
        .link,
    ).toBe("https://r.test");
    expect(
      toGridCell({ formattedValue: "a", userEnteredValue: { formulaValue: '=HYPERLINK("https://f.test","a")' } }).link,
    ).toBe("https://f.test");
    expect(toGridCell(undefined)).toEqual({ text: "", link: null });
  });
});

describe("createAnnounceSheetIO", () => {
  function fakeClient(rowData: sheets_v4.Schema$RowData[], startRow = 0) {
    const get = vi.fn(async () => ({ data: { sheets: [{ data: [{ startRow, startColumn: 0, rowData }] }] } }));
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    const client = { spreadsheets: { get, values: { batchUpdate } } } as unknown as sheets_v4.Sheets;
    return { client, get, batchUpdate };
  }

  it("reads the tab with grid data and parses it", async () => {
    const rows: sheets_v4.Schema$RowData[] = [
      { values: [{}, { formattedValue: "Announce?" }, { formattedValue: "" }, { formattedValue: "Last Sent:" }] },
      { values: [{ formattedValue: "Announcement" }, { formattedValue: "Status" }, { formattedValue: "Crew" }] },
      { values: [{ formattedValue: "Do it", hyperlink: "https://l.test" }, { formattedValue: "redo" }, { formattedValue: "tech" }] },
    ];
    const { client, get } = fakeClient(rows, 4);
    const io = createAnnounceSheetIO("sheet-1", "Crews", () => client);
    const block = await io.readBlock();
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: "sheet-1", ranges: ["'Crews'"], includeGridData: true }),
    );
    expect(block.sendCell).toBe("'Crews'!C5");
    expect(block.lastSentCell).toBe("'Crews'!E5");
    expect(block.specials).toEqual([{ text: "Do it", url: "https://l.test", crew: "tech", status: "redo" }]);
  });

  it("writes cells RAW in one batch and skips empty batches", async () => {
    const { client, batchUpdate } = fakeClient([]);
    const io = createAnnounceSheetIO("sheet-1", "Crews", () => client);
    await io.writeCells([]);
    expect(batchUpdate).not.toHaveBeenCalled();
    await io.writeCells([{ range: "'Crews'!C23", value: "Sent" }]);
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-1",
      requestBody: { valueInputOption: "RAW", data: [{ range: "'Crews'!C23", values: [["Sent"]] }] },
    });
  });
});
