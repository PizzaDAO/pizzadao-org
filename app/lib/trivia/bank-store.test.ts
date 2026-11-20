// @vitest-environment node
// The real bank store (every other test uses the in-memory fake): the indexed columns are copied from the question,
// the guards become WHERE conditions, a taken id is null rather than an error.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/app/lib/trivia/bank-store");
const db = vi.hoisted(() => ({
  triviaQuestion: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/app/lib/db", () => ({ prisma: db }));

import { applyImportOps, insertBankRow, listBankRows, markRowsExposed, updateBankRow } from "./bank-store";
import fixture from "./__fixtures__/questions.fixture.json";
import { QuestionSchema } from "./schema";

const q = QuestionSchema.parse(fixture.questions.find((x) => x.id === "pd-901"));
const draft = QuestionSchema.parse(fixture.questions.find((x) => x.id === "pz-908"));

beforeEach(() => {
  for (const f of Object.values(db.triviaQuestion)) f.mockReset();
  db.$transaction.mockReset();
});

describe("bank-store", () => {
  it("lists rows sorted by id", async () => {
    db.triviaQuestion.findMany.mockResolvedValue([]);
    await listBankRows();
    expect(db.triviaQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: "asc" } }));
  });

  it("insert copies status, pool and category from the question and records the actor", async () => {
    db.triviaQuestion.create.mockResolvedValue({ id: q.id });
    await insertBankRow(q, { exposed: true, actor: "a1" });
    expect(db.triviaQuestion.create.mock.calls[0][0].data).toEqual({ id: "pd-901", status: "approved", pool: "web", category: "pizza-day", data: q, exposed: true, updatedBy: "a1" });
    await insertBankRow(draft, { exposed: false, actor: "a1" });
    expect(db.triviaQuestion.create.mock.calls[1][0].data).toMatchObject({ status: "flagged", pool: null });
  });

  it("a taken id is null, other errors throw", async () => {
    db.triviaQuestion.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await insertBankRow(q, { exposed: false, actor: "a" })).toBeNull();
    db.triviaQuestion.create.mockRejectedValueOnce(new Error("down"));
    await expect(insertBankRow(q, { exposed: false, actor: "a" })).rejects.toThrow("down");
  });

  it("every update is guarded by the exact updatedAt; null when no row matched", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    db.triviaQuestion.updateMany.mockResolvedValue({ count: 1 });
    db.triviaQuestion.findUnique.mockResolvedValue({ id: q.id });
    await updateBankRow(q, { exposed: false, actor: "a", expectUpdatedAt: at });
    expect(db.triviaQuestion.updateMany.mock.calls[0][0].where).toEqual({ id: "pd-901", updatedAt: at });
    expect(db.triviaQuestion.updateMany.mock.calls[0][0].data).toMatchObject({ status: "approved", pool: "web", category: "pizza-day", exposed: false, updatedBy: "a" });
    db.triviaQuestion.updateMany.mockResolvedValue({ count: 0 });
    expect(await updateBankRow(q, { exposed: false, actor: "a", expectUpdatedAt: at })).toBeNull();
  });

  it("an import runs in one transaction and a conflict rolls it back", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const tx = { triviaQuestion: { createMany: vi.fn(async (a: unknown) => (void a, { count: 1 })), updateMany: vi.fn(async (a: { where: unknown }) => (void a, { count: 1 })) } };
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    expect(await applyImportOps([{ kind: "create", q, exposed: true }, { kind: "update", q: draft, exposed: false, expectUpdatedAt: at }], "script:import-bank")).toEqual({ ok: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.triviaQuestion.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ id: "pd-901", exposed: true, updatedBy: "script:import-bank" }] });
    expect(tx.triviaQuestion.updateMany.mock.calls[0][0].where).toEqual({ id: "pz-908", updatedAt: at });
    tx.triviaQuestion.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await applyImportOps([{ kind: "update", q: draft, exposed: false, expectUpdatedAt: at }], "x")).toEqual({ ok: false, conflict: "pz-908" });
    db.$transaction.mockRejectedValueOnce(new Error("down"));
    await expect(applyImportOps([{ kind: "create", q, exposed: true }], "x")).rejects.toThrow("down");
  });

  it("markRowsExposed only flips rows that are not exposed yet", async () => {
    db.triviaQuestion.updateMany.mockResolvedValue({ count: 1 });
    expect(await markRowsExposed(["pd-901"], "system:revealed")).toBe(1);
    expect(db.triviaQuestion.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ["pd-901"] }, exposed: false }, data: { exposed: true, updatedBy: "system:revealed" } });
    expect(await markRowsExposed([], "x")).toBe(0);
  });
});
