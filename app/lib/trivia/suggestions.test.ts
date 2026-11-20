// @vitest-environment node
/** Storing suggestions: the 5-a-day cap per member and the queue/snippets. The database is an in-memory fake. */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; kind: string; discordId: string | null; text: string; status: string; questionId: string; payload: unknown; createdAt: Date };
const db = vi.hoisted(() => ({ rows: [] as Row[], locks: 0 }));

vi.mock("@/app/lib/db", () => {
  const triviaReport = {
    count: async ({ where }: { where: { kind: string; discordId: string; createdAt: { gte: Date } } }) =>
      db.rows.filter((r) => r.kind === where.kind && r.discordId === where.discordId && r.createdAt >= where.createdAt.gte).length,
    create: async ({ data }: { data: Omit<Row, "id"> }) => {
      const row = { id: db.rows.length + 1, ...data };
      db.rows.push(row);
      return row;
    },
    findMany: async ({ where }: { where: { kind: string; status: string } }) => db.rows.filter((r) => r.kind === where.kind && r.status === where.status).sort((a, b) => a.id - b.id),
    updateMany: async ({ where, data }: { where: { id: number; kind: string; status: string }; data: { status: string } }) => {
      const hit = db.rows.filter((r) => r.id === where.id && r.kind === where.kind && r.status === where.status);
      hit.forEach((r) => (r.status = data.status));
      return { count: hit.length };
    },
  };
  const tx = { triviaReport, $executeRaw: async () => void db.locks++ };
  return { prisma: { triviaReport, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { closeSuggestion, openSuggestions, submitSuggestion, suggestionsRemaining } from "./suggestions";
import { SUGGESTIONS_PER_DAY } from "./suggestion-core";

const NOW = new Date("2026-12-10T15:00:00Z");
const input = (n = 0) => ({ question: `Which year did pizza question number ${n} happen?`, answer: "2010", source: "https://example.com/a" });

beforeEach(() => {
  db.rows.length = 0;
  db.locks = 0;
});

describe("submitSuggestion", () => {
  it("stores a valid suggestion as kind=suggestion with the payload, under a per-member lock", async () => {
    const r = await submitSuggestion("111", { ...input(), aliases: "two thousand ten", category: "pizza-day" }, NOW);
    expect(r).toEqual({ status: "recorded", id: 1 });
    expect(db.locks).toBe(1);
    expect(db.rows[0]).toMatchObject({ kind: "suggestion", discordId: "111", status: "open", questionId: "", text: input().question });
    expect(db.rows[0].payload).toEqual({ question: input().question, answer: "2010", aliases: ["two thousand ten"], source: "https://example.com/a", category: "pizza-day" });
  });

  it("does not store (or count) an invalid one", async () => {
    expect(await submitSuggestion("111", { ...input(), source: "ftp://x" }, NOW)).toEqual({ status: "invalid", field: "source" });
    expect(db.rows).toHaveLength(0);
  });

  it("allows 5 a day per member, then refuses; another member is unaffected", async () => {
    for (let n = 0; n < SUGGESTIONS_PER_DAY; n++) expect((await submitSuggestion("111", input(n), NOW)).status).toBe("recorded");
    expect(await submitSuggestion("111", input(9), NOW)).toEqual({ status: "limit" });
    expect(db.rows).toHaveLength(SUGGESTIONS_PER_DAY);
    expect((await submitSuggestion("222", input(), NOW)).status).toBe("recorded");
    expect(await suggestionsRemaining("111", NOW)).toBe(0);
    expect(await suggestionsRemaining("222", NOW)).toBe(SUGGESTIONS_PER_DAY - 1);
  });

  it("the window rolls: after 24 hours the member can suggest again, and dismissing never frees a slot", async () => {
    for (let n = 0; n < SUGGESTIONS_PER_DAY; n++) await submitSuggestion("111", input(n), NOW);
    db.rows.forEach((r) => (r.status = "dismissed"));
    expect(await submitSuggestion("111", input(), new Date(NOW.getTime() + 60_000))).toEqual({ status: "limit" });
    expect((await submitSuggestion("111", input(), new Date(NOW.getTime() + 24 * 3_600_000 + 1000))).status).toBe("recorded");
  });
});

describe("the admin queue", () => {
  it("lists open suggestions oldest first with a snippet, numbering ids past earlier snippets of the same category", async () => {
    await submitSuggestion("111", { ...input(1), category: "pizza-day" }, NOW);
    await submitSuggestion("222", { ...input(2), category: "pizza-day" }, NOW);
    const rows = await openSuggestions();
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    const ids = rows.map((r) => JSON.parse(r.snippet!).id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^pd-\d{3}$/);
    expect(JSON.parse(rows[0].snippet!)).toMatchObject({ status: "flagged", question: input(1).question });
  });

  it("an unreadable payload is listed without a snippet instead of breaking the page", async () => {
    db.rows.push({ id: 9, kind: "suggestion", discordId: "1", text: "x", status: "open", questionId: "", payload: { nope: true }, createdAt: NOW });
    expect(await openSuggestions()).toEqual([{ id: 9, createdAt: NOW, suggestion: null, snippet: null }]);
  });

  it("closing marks it added or dismissed once, and only for open suggestions", async () => {
    await submitSuggestion("111", input(), NOW);
    expect(await closeSuggestion(1, "added")).toBe(true);
    expect(db.rows[0].status).toBe("added");
    expect(await closeSuggestion(1, "dismissed")).toBe(false);
    expect(await openSuggestions()).toEqual([]);
  });
});
