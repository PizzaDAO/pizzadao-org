// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findHeaderRowIndex, isHeaderRow } from "./gviz-parser";
import type { GvizTable } from "./types/gviz";

const row = (...vals: (string | null)[]) => ({ c: vals.map((v) => (v === null ? null : { v })) as never });

describe("findHeaderRowIndex", () => {
  const table: GvizTable = {
    rows: [row("Crew roster", null), row(null, "Status", "Name", "City"), row("1", "Daily", "Pepper", "NYC")],
  };

  it("matches with a predicate over normalized values", () => {
    const idx = findHeaderRowIndex(table, (vals) => vals.includes("name") && vals.includes("status"));
    expect(idx).toBe(1);
  });

  it("returns -1 when nothing matches within the search window", () => {
    expect(findHeaderRowIndex(table, (vals) => vals.includes("wallet"))).toBe(-1);
    expect(findHeaderRowIndex(table, () => true, 0)).toBe(-1);
  });

  it("matches expected header names", () => {
    expect(findHeaderRowIndex(table, ["status", "name", "city"])).toBe(1);
  });
});

describe("isHeaderRow", () => {
  it("does not treat blank cells as matching every header", () => {
    expect(isHeaderRow(row("Crew roster", null, null), ["status", "name"])).toBe(false);
  });
});
