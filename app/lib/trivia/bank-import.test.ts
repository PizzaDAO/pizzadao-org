// @vitest-environment node
// The bank import (scripts/trivia/import-bank.ts): dry run by default, every entry validated, nothing written when one
// is bad, rows changed after the import kept unless --force, --exposed. Against the in-memory store (vitest.setup.ts).
import { beforeEach, describe, expect, it } from "vitest";
import fixture from "./__fixtures__/questions.fixture.json";
import { fakeBank } from "./__fixtures__/fake-bank-store";
import { formatImportReport, importEntries, runImport, type ImportOptions } from "./bank-import";
import type { TriviaQuestion } from "./schema";

const IMPORT_AT = new Date("2026-06-01T00:00:00Z");
const opts = (over: Partial<ImportOptions> = {}): ImportOptions => ({ apply: false, force: false, exposed: false, asOf: IMPORT_AT, actor: "script:test", ...over });
const entries = () => structuredClone(fixture.questions) as unknown as TriviaQuestion[];

beforeEach(() => {
  fakeBank.reset();
  fakeBank.set([]);
  fakeBank.now = () => new Date("2026-07-01T00:00:00Z"); // writes happen after IMPORT_AT
});

describe("importEntries", () => {
  it("takes a bank file or a bare array", () => {
    expect(importEntries(fixture)).toHaveLength(fixture.questions.length);
    expect(importEntries([1, 2])).toEqual([1, 2]);
    expect(importEntries({ nope: true })).toBeNull();
    expect(importEntries("x")).toBeNull();
  });
});

describe("runImport", () => {
  it("dry run: reports what it would create and writes nothing", async () => {
    const r = await runImport(entries(), opts());
    expect(r).toMatchObject({ total: fixture.questions.length, applied: false, invalid: [], duplicates: [] });
    expect(r.create).toHaveLength(fixture.questions.length);
    expect(fakeBank.rows.size).toBe(0);
    expect(formatImportReport(r, opts())).toContain("DRY RUN");
  });

  it("apply: creates every row (exposed with --exposed), then a re-run changes nothing", async () => {
    const r = await runImport(entries(), opts({ apply: true, exposed: true }));
    expect(r.applied).toBe(true);
    expect(r.create).toHaveLength(fixture.questions.length);
    expect(fakeBank.rows.size).toBe(fixture.questions.length);
    expect([...fakeBank.rows.values()].every((row) => row.exposed && row.updatedBy === "script:test")).toBe(true);
    const row = fakeBank.rows.get("pd-901")!;
    expect(row).toMatchObject({ status: "approved", pool: "web", category: "pizza-day" });

    const again = await runImport(entries(), opts({ apply: true, exposed: true, asOf: new Date("2027-01-01T00:00:00Z") }));
    expect(again.unchanged).toHaveLength(fixture.questions.length);
    expect(again.update).toEqual([]);
  });

  it("without --exposed, imported rows are not exposed and existing flags are kept", async () => {
    await runImport(entries(), opts({ apply: true }));
    expect([...fakeBank.rows.values()].some((row) => row.exposed)).toBe(false);
    fakeBank.setExposed(["pd-901"]);
    const changed = entries().map((q) => (q.id === "pd-901" ? { ...q, explanation: "Changed." } : q));
    const r = await runImport(changed, opts({ apply: true, asOf: new Date("2027-01-01T00:00:00Z") }));
    expect(r.update).toEqual(["pd-901"]);
    expect(fakeBank.rows.get("pd-901")!.exposed).toBe(true);
  });

  it("never overwrites a row changed after the import, unless --force", async () => {
    await runImport(entries(), opts({ apply: true })); // rows written 2026-07-01, after IMPORT_AT
    const edited = entries().map((q) => (q.id === "pd-902" ? { ...q, explanation: "Older text from the file." } : q));
    const kept = await runImport(edited, opts({ apply: true }));
    expect(kept.newer).toEqual(["pd-902"]);
    expect(kept.update).toEqual([]);
    expect((fakeBank.rows.get("pd-902")!.data as TriviaQuestion).explanation).not.toBe("Older text from the file.");
    expect(formatImportReport(kept, opts({ apply: true }))).toContain("--force");

    const forced = await runImport(edited, opts({ apply: true, force: true }));
    expect(forced.update).toEqual(["pd-902"]);
    expect((fakeBank.rows.get("pd-902")!.data as TriviaQuestion).explanation).toBe("Older text from the file.");
  });

  it("an invalid or duplicate entry: reported, and with --apply nothing at all is written", async () => {
    const bad = [...entries(), { ...entries()[0], id: "pd-990", sources: [{ url: "http://x.example", note: "n" }] }, entries()[1], { hello: 1 }];
    const r = await runImport(bad, opts({ apply: true }));
    expect(r.applied).toBe(false);
    expect(r.invalid.map((i) => i.id)).toEqual(["pd-990", null]);
    expect(r.duplicates).toEqual([entries()[1].id]);
    expect(fakeBank.rows.size).toBe(0);
    expect(formatImportReport(r, opts({ apply: true }))).toContain("Nothing was written");
  });

  it("an approved entry that fails the matcher lint is invalid", async () => {
    const q = entries().find((x) => x.id === "pd-901")!;
    const r = await runImport([{ ...q, rejects: ["10,000"] }], opts());
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].errors.join(" ")).toMatch(/accepted/);
  });

  it("the report shows ids and counts, never question text or answers", async () => {
    const r = await runImport(entries(), opts());
    const text = formatImportReport(r, opts());
    for (const q of entries()) {
      expect(text).not.toContain(q.question);
      if (q.answer.length > 4) expect(text).not.toContain(q.answer);
    }
  });
});
