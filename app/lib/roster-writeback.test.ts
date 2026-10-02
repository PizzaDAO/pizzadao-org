import { describe, it, expect, vi, beforeEach } from "vitest";

// No real Google access is possible from these tests.
const googleSheetsFactory = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: vi.fn() },
    sheets: (...args: unknown[]) => googleSheetsFactory(...args),
  },
}));
vi.mock("@/app/lib/sheets/member-repository", () => ({ invalidateMembersCache: vi.fn() }));
vi.mock("@/app/lib/crew-mappings", () => ({
  getCrewMappings: vi.fn(async () => ({
    crews: [
      { id: "ops", label: "Ops" },
      { id: "biz_dev", label: "Biz Dev" },
      { id: "design_art", label: "Design & Art" },
    ],
  })),
}));

import {
  updateMemberCrews,
  planCrewsCellUpdate,
  colIndexToLetter,
  RosterWritebackError,
  ROSTER_SHEET_ID,
  type WritebackDeps,
} from "./roster-writeback";
import { invalidateMembersCache } from "@/app/lib/sheets/member-repository";

// ---------------------------------------------------------------------------
// In-memory fake of spreadsheets.values (get/update) over a 2D grid.
// ---------------------------------------------------------------------------

function colToIdx(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function makeFakeSheet(initial: unknown[][], opts: { formulas?: Record<string, string> } = {}) {
  const grid = initial.map((r) => [...r]);
  const formulas = opts.formulas ?? {};
  const get = vi.fn(async (params: { spreadsheetId: string; range: string; valueRenderOption?: string }) => {
    expect(params.spreadsheetId).toBe(ROSTER_SHEET_ID);
    const a1 = params.range.replace(/^'Crew'!/, "");
    let m;
    if ((m = /^(\d+):(\d+)$/.exec(a1))) {
      return { data: { values: grid.slice(Number(m[1]) - 1, Number(m[2])) } };
    }
    if ((m = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(a1))) {
      const c = colToIdx(m[1]);
      return { data: { values: grid.slice(Number(m[2]) - 1).map((r) => [r[c] ?? ""]) } };
    }
    if ((m = /^([A-Z]+)(\d+)$/.exec(a1))) {
      if (params.valueRenderOption === "FORMULA" && formulas[a1]) {
        return { data: { values: [[formulas[a1]]] } };
      }
      const v = grid[Number(m[2]) - 1]?.[colToIdx(m[1])];
      return { data: { values: v === undefined || v === "" ? undefined : [[v]] } };
    }
    throw new Error(`unexpected range ${params.range}`);
  });
  const update = vi.fn(async (params: { range: string; requestBody: { values: unknown[][] } }) => {
    const m = /^'Crew'!([A-Z]+)(\d+)$/.exec(params.range);
    if (!m) throw new Error(`update must target exactly one cell, got ${params.range}`);
    grid[Number(m[2]) - 1][colToIdx(m[1])] = params.requestBody.values[0][0];
    return { data: {} };
  });
  return { grid, values: { get, update } };
}

// Row 1 is a title row, row 2 is the header, data from row 3.
// Columns: A=ID, B=Name, C=City, D=Crews, E=Status
const BASE_ROWS = [
  ["PizzaDAO Crew"],
  ["ID", "Name", "City", "Crews", "Status"],
  ["1", "Alice", "NYC", "Ops, Biz Dev", "active"],
  ["2", "Bob", "LA", "", "active"],
  ["3", "Carol", "SF", "Ops / Design & Art | Biz Dev", "active"],
];

function setup(rows: unknown[][] = BASE_ROWS, opts?: { formulas?: Record<string, string> }) {
  const fake = makeFakeSheet(rows, opts);
  const clearCache = vi.fn();
  const deps: WritebackDeps = {
    values: fake.values as unknown as WritebackDeps["values"],
    resolveCrewLabel: async (id) => ({ ops: "Ops", biz_dev: "Biz Dev", design_art: "Design & Art" } as Record<string, string>)[id] ?? null,
    clearCache,
  };
  const snapshot = () => JSON.stringify(fake.grid);
  return { ...fake, deps, clearCache, snapshot };
}

async function expectError(p: Promise<unknown>, status: number, msg?: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(RosterWritebackError);
  expect(err.status).toBe(status);
  if (msg) expect(err.message).toMatch(msg);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("planCrewsCellUpdate", () => {
  it("adds by appending, preserving the original text", () => {
    expect(planCrewsCellUpdate("Ops / Pizza", "biz_dev", "add", "Biz Dev")).toEqual({
      changed: true, before: "Ops / Pizza", after: "Ops / Pizza, Biz Dev", crews: ["Ops", "Pizza", "Biz Dev"],
    });
    expect(planCrewsCellUpdate("", "ops", "add", "Ops").after).toBe("Ops");
  });
  it("is a no-op when adding an existing crew (any case/format) or removing an absent one", () => {
    expect(planCrewsCellUpdate("ops, biz-dev", "biz_dev", "add", "Biz Dev").changed).toBe(false);
    expect(planCrewsCellUpdate("Ops", "biz_dev", "remove").changed).toBe(false);
  });
  it("removes only the target token", () => {
    expect(planCrewsCellUpdate("Ops / Design & Art | Biz Dev", "design_art", "remove").after).toBe("Ops, Biz Dev");
  });
  it("rejects labels that don't match the crew id or contain separators", () => {
    expect(() => planCrewsCellUpdate("", "ops", "add", "Operations")).toThrow(RosterWritebackError);
    expect(() => planCrewsCellUpdate("", "ops", "add", "")).toThrow(RosterWritebackError);
    expect(() => planCrewsCellUpdate("", "a_b", "add", "A/B")).toThrow(RosterWritebackError);
  });
});

describe("colIndexToLetter", () => {
  it("converts indices", () => {
    expect([0, 3, 25, 26, 27, 701, 702].map(colIndexToLetter)).toEqual(["A", "D", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(() => colIndexToLetter(-1)).toThrow();
  });
});

describe("updateMemberCrews", () => {
  it("defaults to dry-run and never writes", async () => {
    const s = setup();
    const before = s.snapshot();
    const res = await updateMemberCrews({ memberId: "2", crewId: "ops", action: "add" }, s.deps);
    expect(res).toMatchObject({ mode: "dry-run", applied: false, changed: true, range: "'Crew'!D4", before: "", after: "Ops" });
    expect(s.values.update).not.toHaveBeenCalled();
    expect(s.clearCache).not.toHaveBeenCalled();
    expect(s.snapshot()).toBe(before);
  });

  it("no changes: adding an existing crew is a no-op even in apply mode", async () => {
    const s = setup();
    const res = await updateMemberCrews(
      { memberId: "1", crewId: "biz_dev", action: "add", mode: "apply", expectedBefore: "stale" },
      s.deps
    );
    expect(res).toMatchObject({ applied: false, changed: false, before: "Ops, Biz Dev", after: "Ops, Biz Dev" });
    expect(s.values.update).not.toHaveBeenCalled();
  });

  it("no changes: removing an absent crew is a no-op", async () => {
    const s = setup();
    const res = await updateMemberCrews(
      { memberId: "1", crewId: "design_art", action: "remove", mode: "apply", expectedBefore: "Ops, Biz Dev" },
      s.deps
    );
    expect(res.changed).toBe(false);
    expect(s.values.update).not.toHaveBeenCalled();
  });

  it("addition: applies exactly one RAW cell write with the canonical label, then is idempotent", async () => {
    const s = setup();
    const preview = await updateMemberCrews({ memberId: "1", crewId: "design_art", action: "add" }, s.deps);
    expect(preview.after).toBe("Ops, Biz Dev, Design & Art");

    const res = await updateMemberCrews(
      { memberId: "1", crewId: "design_art", action: "add", mode: "apply", expectedBefore: preview.before },
      s.deps
    );
    expect(res).toMatchObject({ applied: true, changed: true, after: "Ops, Biz Dev, Design & Art" });
    expect(s.values.update).toHaveBeenCalledTimes(1);
    expect(s.values.update).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: ROSTER_SHEET_ID,
        range: "'Crew'!D3",
        valueInputOption: "RAW",
        requestBody: expect.objectContaining({ values: [["Ops, Biz Dev, Design & Art"]] }),
      })
    );
    expect(s.clearCache).toHaveBeenCalledTimes(1);
    // Only the target cell changed.
    expect(s.grid).toEqual([
      BASE_ROWS[0], BASE_ROWS[1],
      ["1", "Alice", "NYC", "Ops, Biz Dev, Design & Art", "active"],
      BASE_ROWS[3], BASE_ROWS[4],
    ]);

    // Re-running the same apply is a no-op.
    const again = await updateMemberCrews(
      { memberId: "1", crewId: "design_art", action: "add", mode: "apply", expectedBefore: preview.before },
      s.deps
    );
    expect(again).toMatchObject({ applied: false, changed: false });
    expect(s.values.update).toHaveBeenCalledTimes(1);
  });

  it("removal: removes only the target crew and preserves the rest", async () => {
    const s = setup();
    const res = await updateMemberCrews(
      { memberId: "3", crewId: "design_art", action: "remove", mode: "apply", expectedBefore: "Ops / Design & Art | Biz Dev" },
      s.deps
    );
    expect(res).toMatchObject({ applied: true, range: "'Crew'!D5", after: "Ops, Biz Dev" });
    expect(s.grid[4]).toEqual(["3", "Carol", "SF", "Ops, Biz Dev", "active"]);
  });

  it("refuses to apply without expectedBefore, or when the cell changed since the preview", async () => {
    const s = setup();
    await expectError(updateMemberCrews({ memberId: "1", crewId: "ops", action: "remove", mode: "apply" }, s.deps), 400);
    await expectError(
      updateMemberCrews({ memberId: "1", crewId: "ops", action: "remove", mode: "apply", expectedBefore: "Ops" }, s.deps),
      409,
      /changed since the preview/
    );
    expect(s.values.update).not.toHaveBeenCalled();
  });

  it("refuses to add a crew that is not in Crew Mappings", async () => {
    const s = setup();
    await expectError(updateMemberCrews({ memberId: "1", crewId: "made_up", action: "add" }, s.deps), 400, /Unknown crew/);
  });

  it("finds the Crews column wherever it is and handles wide sheets", async () => {
    const wide = [
      ["Name", "Status", ...Array(27).fill("x"), "Crews", "ID"],
      ["Dan", "active", ...Array(27).fill(""), "Ops", "7"],
    ];
    const s = setup(wide);
    const res = await updateMemberCrews(
      { memberId: "7", crewId: "biz_dev", action: "add", mode: "apply", expectedBefore: "Ops" },
      s.deps
    );
    expect(res.range).toBe("'Crew'!AD2");
    expect(s.grid[1][29]).toBe("Ops, Biz Dev");
    expect(s.grid[1][30]).toBe("7");
  });

  describe("malformed rows / sheets", () => {
    it("rejects invalid input before touching the sheet", async () => {
      const s = setup();
      await expectError(updateMemberCrews({ memberId: "1; DROP", crewId: "ops", action: "add" }, s.deps), 400);
      await expectError(updateMemberCrews({ memberId: "1", crewId: "!!!", action: "add" }, s.deps), 400);
      await expectError(updateMemberCrews({ memberId: "1", crewId: "ops", action: "nuke" as "add" }, s.deps), 400);
      await expectError(updateMemberCrews({ memberId: "1", crewId: "ops", action: "add", mode: "yolo" as "apply" }, s.deps), 400);
      expect(s.values.get).not.toHaveBeenCalled();
    });

    it("404s when the member row does not exist", async () => {
      const s = setup();
      await expectError(updateMemberCrews({ memberId: "99", crewId: "ops", action: "add" }, s.deps), 404);
    });

    it("refuses when the member ID appears on more than one row", async () => {
      const s = setup([...BASE_ROWS, ["1", "Alice dup", "", "Ops", ""]]);
      await expectError(
        updateMemberCrews({ memberId: "1", crewId: "ops", action: "remove", mode: "apply", expectedBefore: "Ops, Biz Dev" }, s.deps),
        409,
        /appears on 2 rows/
      );
      expect(s.values.update).not.toHaveBeenCalled();
    });

    it("errors when there is no header row or no Crews column", async () => {
      await expectError(updateMemberCrews({ memberId: "1", crewId: "ops", action: "add" }, setup([["foo", "bar"], ["1", "x"]]).deps), 500, /header row/);
      await expectError(
        updateMemberCrews({ memberId: "1", crewId: "ops", action: "add" }, setup([["ID", "Name", "City"], ["1", "A", "B"]]).deps),
        500,
        /Crews column/
      );
    });

    it("tolerates short/ragged rows and treats a missing Crews cell as empty", async () => {
      const s = setup([["ID", "Name", "City", "Crews"], ["5"], [], ["6", "Eve"]]);
      const res = await updateMemberCrews({ memberId: "6", crewId: "ops", action: "add", mode: "apply", expectedBefore: "" }, s.deps);
      expect(res).toMatchObject({ applied: true, range: "'Crew'!D4", after: "Ops" });
    });

    it("never overwrites a formula cell", async () => {
      const s = setup(BASE_ROWS, { formulas: { D3: '=JOIN(", ", X3:Z3)' } });
      await expectError(updateMemberCrews({ memberId: "1", crewId: "ops", action: "remove" }, s.deps), 409, /formula/);
      expect(s.values.update).not.toHaveBeenCalled();
    });

    it("aborts if the row moved between lookup and write", async () => {
      const s = setup();
      const realGet = s.values.get.getMockImplementation()!;
      let singleCellIdReads = 0;
      s.values.get.mockImplementation(async (p) => {
        if (p.range === "'Crew'!A3" && ++singleCellIdReads === 2) {
          return { data: { values: [["2"]] } }; // someone inserted/sorted rows
        }
        return realGet(p);
      });
      await expectError(
        updateMemberCrews({ memberId: "1", crewId: "ops", action: "remove", mode: "apply", expectedBefore: "Ops, Biz Dev" }, s.deps),
        409,
        /changed while writing/
      );
      expect(s.values.update).not.toHaveBeenCalled();
    });
  });

  it("default deps build a read-write googleapis client (mocked) and clear the members cache", async () => {
    const fake = makeFakeSheet(BASE_ROWS);
    googleSheetsFactory.mockReturnValue({ spreadsheets: { values: fake.values } });
    const res = await updateMemberCrews({ memberId: "2", crewId: "biz_dev", action: "add", mode: "apply", expectedBefore: "" });
    expect(res).toMatchObject({ applied: true, after: "Biz Dev" });
    expect(googleSheetsFactory).toHaveBeenCalledWith(expect.objectContaining({ version: "v4" }));
    expect(invalidateMembersCache).toHaveBeenCalled();
  });
});
