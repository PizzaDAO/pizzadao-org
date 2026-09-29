// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MEMBERS_CACHE_TAG,
  MEMBERS_REVALIDATE_SECONDS,
  __resetMembersParseMemo,
  fetchMemberByDiscordId,
  fetchMemberById,
  fetchMemberIdByDiscordId,
  findMemberRow,
  getMembersSheet,
  getMembersTable,
  getSheetData,
  invalidateMembersCache,
  rowToRecord,
} from "./member-repository";
import { SHEET_IDS } from "./config";

// Mirrors the real Crew tab: a blank-headed ID column, header row first.
const HEADER = [null, "Status", "Name", "City", "Crews", "Turtles", "DiscordID", "Wallet"];
const ROWS: unknown[][] = [
  [1, "Daily", "Pepper Mortensen", "North America", "Ops", "Leonardo", null, null],
  [2, "Weekly", "Cheese Lucas", "Lisbon", null, "Leonardo, April", "271029153237696514", "0xabc"],
  ["7", "Monthly", "Don Heebie", "Detroit", "Tech", null, "794594001835393044", null],
  [null, null, null, null, null, null, null, null],
];

function cell(v: unknown) {
  return v === null ? null : { v };
}

function membersBody(opts: { preamble?: unknown[][] } = {}) {
  const rows = [...(opts.preamble ?? []), HEADER, ...ROWS].map((r) => ({ c: r.map(cell) }));
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
    status: "ok",
    table: { cols: HEADER.map(() => ({ label: "" })), rows },
  })});`;
}

function mockFetch(body = membersBody()) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => body });
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  __resetMembersParseMemo();
});

describe("member repository: fetching", () => {
  it("reads the members sheet through the data cache, tagged 'members'", async () => {
    const fetchMock = mockFetch();
    await getSheetData();

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/spreadsheets/d/${SHEET_IDS.members}/gviz/tq`);
    expect(parsed.searchParams.get("sheet")).toBe("Crew");
    expect(parsed.searchParams.get("headers")).toBe("0");
    expect(init).toEqual({ next: { revalidate: MEMBERS_REVALIDATE_SECONDS, tags: [MEMBERS_CACHE_TAG] } });
  });

  it("bypasses the cache with { fresh: true }", async () => {
    const fetchMock = mockFetch();
    await fetchMemberById("2", { fresh: true });
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store" });
  });

  it("finds the header row below a preamble", async () => {
    mockFetch(membersBody({ preamble: [["PizzaDAO members"], []] }));
    const sheet = await getMembersSheet();
    expect(sheet.headerRowIndex).toBe(2);
    expect(sheet.headers.slice(0, 3)).toEqual(["", "Status", "Name"]);
    expect(sheet.rows).toHaveLength(ROWS.length);
  });

  it("throws when there is no header row", async () => {
    const body = `google.visualization.Query.setResponse(${JSON.stringify({
      table: { rows: [{ c: [{ v: "nothing" }] }] },
    })})`;
    mockFetch(body);
    await expect(getMembersSheet()).rejects.toThrow("Header row not found");
    // getMembersTable reports it instead of throwing
    expect((await getMembersTable()).headerRowIndex).toBe(-1);
  });

  it("reuses the parsed table when the response body is unchanged", async () => {
    mockFetch();
    const a = await getMembersTable();
    const b = await getMembersTable();
    expect(b).toBe(a);

    mockFetch(membersBody({ preamble: [["changed"]] }));
    const c = await getMembersTable();
    expect(c).not.toBe(a);
  });

  it("invalidateMembersCache is safe outside a Next request", () => {
    expect(() => invalidateMembersCache()).not.toThrow();
  });
});

describe("member repository: lookup by discordId", () => {
  it("resolves a Discord ID to its member ID", async () => {
    mockFetch();
    await expect(fetchMemberIdByDiscordId("271029153237696514")).resolves.toBe("2");
    await expect(fetchMemberIdByDiscordId("794594001835393044")).resolves.toBe("7");
  });

  it("returns memberId + name", async () => {
    mockFetch();
    await expect(fetchMemberByDiscordId("271029153237696514")).resolves.toEqual({
      memberId: "2",
      name: "Cheese Lucas",
    });
  });

  it("returns null for unknown or empty Discord IDs without fetching for empty", async () => {
    const fetchMock = mockFetch();
    await expect(fetchMemberIdByDiscordId("000")).resolves.toBeNull();
    await expect(fetchMemberByDiscordId("000")).resolves.toBeNull();
    fetchMock.mockClear();
    await expect(fetchMemberIdByDiscordId("")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("member repository: lookup by memberId", () => {
  it("returns the header-keyed row with a discordId field", async () => {
    mockFetch();
    const row = await fetchMemberById("2");
    expect(row).toMatchObject({
      discordId: "271029153237696514",
      Name: "Cheese Lucas",
      City: "Lisbon",
      Turtles: "Leonardo, April",
      Wallet: "0xabc",
    });
  });

  it("gives unclaimed members an empty discordId", async () => {
    mockFetch();
    const row = await fetchMemberById("1");
    expect(row?.discordId).toBe("");
    expect(row?.Name).toBe("Pepper Mortensen");
  });

  it("returns null for an unknown member", async () => {
    mockFetch();
    await expect(fetchMemberById("999")).resolves.toBeNull();
  });

  it("findMemberRow matches numerically by default and exactly on request", async () => {
    mockFetch();
    const sheet = await getMembersSheet();
    expect(rowToRecord(sheet, findMemberRow(sheet, "007")!).Name).toBe("Don Heebie");
    expect(rowToRecord(sheet, findMemberRow(sheet, 2)!).Name).toBe("Cheese Lucas");
    expect(findMemberRow(sheet, "007", "exact")).toBeNull();
    expect(rowToRecord(sheet, findMemberRow(sheet, "7", "exact")!).Name).toBe("Don Heebie");
    expect(findMemberRow(sheet, "abc")).toBeNull();
  });
});
