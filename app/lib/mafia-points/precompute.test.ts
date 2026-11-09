// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/app/lib/db", () => ({ prisma: { mafiaRankCache: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: vi.fn(async () => undefined) }));
vi.mock("./index", () => ({ findWallet: vi.fn(() => null), refreshMafiaRank: vi.fn() }));

const table = {
  headers: ["ID", "Name", "DiscordID", "Wallet"],
  rows: [
    { c: [{ v: "1" }, { v: "A" }, { v: "d1" }, null] },
    { c: [{ v: "2" }, { v: "B" }, { v: "d2" }, null] },
    { c: [{ v: "3" }, { v: "C" }, { v: "d3" }, null] },
    { c: [{ v: "4" }, { v: "D" }, null, null] }, // nothing to compute from
    { c: [{ v: "10" }, { v: "E" }, { v: "d10" }, null] },
  ],
};
vi.mock("@/app/lib/sheets/member-repository", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/sheets/member-repository")>(
    "@/app/lib/sheets/member-repository",
  );
  return { ...actual, getMembersTable: vi.fn(async () => table) };
});

import { runMafiaRankPrecompute, orderOldestFirst } from "./precompute";

beforeEach(() => {
  findMany.mockReset();
});

describe("orderOldestFirst", () => {
  it("puts never-computed members first, then oldest computedAt", () => {
    const m = new Map([["1", 500], ["2", 100], ["10", 300]]);
    expect(orderOldestFirst(["1", "2", "3", "10"], m)).toEqual(["3", "2", "10", "1"]);
  });
});

describe("runMafiaRankPrecompute", () => {
  it("skips members with no Discord id or wallet and processes oldest first", async () => {
    findMany.mockResolvedValue([
      { memberId: "1", computedAt: new Date(900) },
      { memberId: "2", computedAt: new Date(100) },
    ]);
    const order: string[] = [];
    const res = await runMafiaRankPrecompute({
      budgetMs: 1000,
      concurrency: 1,
      refresh: async (id) => void order.push(id),
    });
    expect(order).toEqual(["3", "10", "2", "1"]);
    expect(res).toEqual({ total: 4, computed: 4, failed: 0, remaining: 0, stoppedEarly: false });
  });

  it("stops at the time budget and leaves the rest for the next run", async () => {
    findMany.mockResolvedValue([]);
    let t = 0;
    const done: string[] = [];
    const res = await runMafiaRankPrecompute({
      budgetMs: 25,
      concurrency: 1,
      now: () => t,
      refresh: async (id) => {
        done.push(id);
        t += 10;
      },
    });
    expect(done).toEqual(["1", "2", "3"]); // t = 0, 10, 20 are under the 25 deadline
    expect(res.remaining).toBe(1);
    expect(res.stoppedEarly).toBe(true);
  });

  it("counts a failing member and carries on", async () => {
    findMany.mockResolvedValue([]);
    const res = await runMafiaRankPrecompute({
      budgetMs: 1000,
      concurrency: 2,
      refresh: async (id) => {
        if (id === "2") throw new Error("boom");
      },
    });
    expect(res.failed).toBe(1);
    expect(res.computed).toBe(3);
  });

  it("never runs more than the concurrency at once", async () => {
    findMany.mockResolvedValue([]);
    let active = 0;
    let peak = 0;
    await runMafiaRankPrecompute({
      budgetMs: 1000,
      concurrency: 2,
      refresh: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
    });
    expect(peak).toBe(2);
  });
});
