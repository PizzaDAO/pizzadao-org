// @vitest-environment node
// The bank import (scripts/trivia/import-bank.ts): dry run by default, every entry validated, nothing written when one
// is bad, one transaction, rows edited outside the import (or after it) kept unless --force, --exposed, and output
// that never carries question text, answers, aliases or rejects. Against the in-memory store (vitest.setup.ts).
import { beforeEach, describe, expect, it } from "vitest";
import fixture from "./__fixtures__/questions.fixture.json";
import { fakeBank, applyImportOps, listBankRows } from "./__fixtures__/fake-bank-store";
import { describeError, formatImportReport, IMPORT_ACTOR, importEntries, runImport, type ImportOptions } from "./bank-import";
import type { TriviaQuestion } from "./schema";

const IMPORT_AT = new Date("2026-06-01T00:00:00Z");
const LATER = new Date("2027-01-01T00:00:00Z");
const opts = (over: Partial<ImportOptions> = {}): ImportOptions => ({ apply: false, force: false, exposed: false, asOf: IMPORT_AT, ...over });
const entries = () => structuredClone(fixture.questions) as unknown as TriviaQuestion[];
const edit = (id: string, over: Partial<TriviaQuestion>) => entries().map((q) => (q.id === id ? { ...q, ...over } : q));

beforeEach(() => {
  fakeBank.reset();
  fakeBank.set([]);
  fakeBank.now = () => new Date("2026-07-01T00:00:00Z"); // writes happen after IMPORT_AT, before LATER
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

  it("apply: creates every row (exposed with --exposed) as the import actor, then a re-run changes nothing", async () => {
    const r = await runImport(entries(), opts({ apply: true, exposed: true }));
    expect(r.applied).toBe(true);
    expect(r.create).toHaveLength(fixture.questions.length);
    expect(fakeBank.rows.size).toBe(fixture.questions.length);
    expect([...fakeBank.rows.values()].every((row) => row.exposed && row.updatedBy === IMPORT_ACTOR)).toBe(true);
    expect(fakeBank.rows.get("pd-901")!).toMatchObject({ status: "approved", pool: "web", category: "pizza-day" });

    const again = await runImport(entries(), opts({ apply: true, exposed: true, asOf: LATER }));
    expect(again.unchanged).toHaveLength(fixture.questions.length);
    expect(again.update).toEqual([]);
  });

  it("updates rows the import wrote before, keeping their exposed flag without --exposed", async () => {
    await runImport(entries(), opts({ apply: true }));
    expect([...fakeBank.rows.values()].some((row) => row.exposed)).toBe(false);
    const row = fakeBank.rows.get("pd-901")!;
    fakeBank.rows.set("pd-901", { ...row, exposed: true }); // same writer, flag set (e.g. an earlier --exposed run)
    const r = await runImport(edit("pd-901", { explanation: "Changed." }), opts({ apply: true, asOf: LATER }));
    expect(r.update).toEqual(["pd-901"]);
    expect(fakeBank.rows.get("pd-901")!.exposed).toBe(true);
  });

  it("never overwrites a row changed after the import's time, unless --force", async () => {
    await runImport(entries(), opts({ apply: true })); // rows written 2026-07-01, after IMPORT_AT
    const older = edit("pd-902", { explanation: "Older text from the file." });
    const kept = await runImport(older, opts({ apply: true }));
    expect(kept.newer).toEqual(["pd-902"]);
    expect((fakeBank.rows.get("pd-902")!.data as TriviaQuestion).explanation).not.toBe("Older text from the file.");
    const forced = await runImport(older, opts({ apply: true, force: true }));
    expect(forced.update).toEqual(["pd-902"]);
    expect((fakeBank.rows.get("pd-902")!.data as TriviaQuestion).explanation).toBe("Older text from the file.");
  });

  it("a row edited in the admin (or flagged revealed) is skipped whatever the dates, listed in the dry run, overwritten only with --force", async () => {
    await runImport(entries(), opts({ apply: true }));
    for (const [id, by] of [["pd-903", "900000000000000001"], ["pd-904", "system:revealed"]] as const) {
      fakeBank.rows.set(id, { ...fakeBank.rows.get(id)!, updatedBy: by, updatedAt: new Date("2026-01-01T00:00:00Z") }); // even "older" than the import
    }
    const file = edit("pd-903", { explanation: "File text." }).map((q) => (q.id === "pd-904" ? { ...q, explanation: "File text." } : q));
    const dry = await runImport(file, opts({ asOf: LATER }));
    expect(dry.editedInAdmin).toEqual(["pd-903", "pd-904"]);
    expect(formatImportReport(dry, opts({ asOf: LATER }))).toContain("skipped: edited in admin (use --force to overwrite): pd-903, pd-904");
    const applied = await runImport(file, opts({ apply: true, asOf: LATER }));
    expect(applied.update).toEqual([]);
    expect((fakeBank.rows.get("pd-903")!.data as TriviaQuestion).explanation).not.toBe("File text.");
    const forced = await runImport(file, opts({ apply: true, asOf: LATER, force: true }));
    expect(forced.update).toEqual(["pd-903", "pd-904"]);
    expect(fakeBank.rows.get("pd-903")!.updatedBy).toBe(IMPORT_ACTOR);
  });

  it("all or nothing: a row that changes meanwhile rolls the whole import back", async () => {
    const r = await runImport(entries(), opts({ apply: true }), {
      listBankRows,
      applyImportOps: async (ops, actor) => {
        // another writer creates one of the rows between the read and the write
        const q = entries().find((x) => x.id === "pz-916")!;
        fakeBank.rows.set(q.id, { id: q.id, status: q.status, pool: q.pool ?? null, category: q.category, data: q, exposed: false, createdAt: new Date(), updatedAt: new Date(), updatedBy: "someone" });
        return applyImportOps(ops, actor);
      },
    });
    expect(r).toMatchObject({ applied: false, conflicts: ["pz-916"] });
    expect(fakeBank.rows.size).toBe(1); // only the other writer's row: nothing of the import
    expect(formatImportReport(r, opts({ apply: true }))).toContain("rolled back");
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

  it("an approved entry that fails the matcher lint is invalid, named by field and index only", async () => {
    const q = entries().find((x) => x.id === "pd-901")!;
    const r = await runImport([{ ...q, rejects: ["10,000"] }], opts());
    expect(r.invalid[0].errors).toContain("answer: not accepted by the matcher"); // the reject beats the answer
    for (const e of r.invalid[0].errors) expect(e).toMatch(/^(answer|aliases\[\d+\]|rejects\[\d+\]|choices\[\d+\]): /);
  });

  it("the report never shows question text, answers, aliases, rejects or choices, even for broken entries", async () => {
    await runImport(entries(), opts({ apply: true }));
    fakeBank.rows.set("pd-903", { ...fakeBank.rows.get("pd-903")!, updatedBy: "admin" });
    const secret = "zebra-secret-answer";
    const file = [
      ...edit("pd-903", { explanation: "New." }),
      { ...entries().find((x) => x.id === "pd-901")!, id: "pd-991", aliases: [secret.repeat(9)], rejects: ["10,000"] }, // lint failures
      { ...entries().find((x) => x.id === "pd-905")!, id: "pd-992", answer: secret }, // answer not a choice
      { ...entries().find((x) => x.id === "pd-905")!, id: "pd-993", status: secret }, // bad enum (zod would quote it)
      { id: secret, question: secret, answer: secret }, // garbage id
    ];
    const r = await runImport(file, opts({ asOf: LATER }));
    const text = formatImportReport(r, opts({ asOf: LATER }));
    expect(text).not.toContain(secret);
    for (const q of entries()) {
      expect(text).not.toContain(q.question);
      for (const v of [q.answer, ...q.aliases, ...q.rejects, ...(q.choices ?? [])]) if (v.length > 4) expect(text).not.toContain(v);
    }
  });
});

describe("describeError", () => {
  it("keeps the name, Prisma code and first line only (the rest of a Prisma message is the query, with the data)", () => {
    const e = Object.assign(new Error("Invalid `prisma.triviaQuestion.create()` invocation:\n\n{ data: { answer: \"zebra\" } }"), { name: "PrismaClientValidationError", code: "P2009" });
    const line = describeError(e);
    expect(line).toBe("PrismaClientValidationError: P2009: Invalid `prisma.triviaQuestion.create()` invocation:");
    expect(line).not.toContain("zebra");
  });
});
