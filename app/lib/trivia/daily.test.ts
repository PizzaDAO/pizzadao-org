import { describe, expect, it } from "vitest";
import { addDays, categoryCounts, computeStreak, dailyQuestionFor, dayKeyUtc, nextDayStartMs, pickPractice } from "./daily";
import { servable } from "./bank";

const NOW = new Date("2026-11-18T12:00:00Z");
const pool = servable({ now: NOW, pool: "web" });

describe("daily question", () => {
  it("is stable for a day and the same for everyone", () => {
    const a = dailyQuestionFor("2026-11-18", pool);
    const b = dailyQuestionFor("2026-11-18", [...pool].reverse());
    expect(a).not.toBeNull();
    expect(a!.id).toBe(b!.id);
  });

  it("walks through the whole web pool before repeating", () => {
    const seen = new Set<string>();
    let day = "2026-12-01";
    for (let i = 0; i < pool.length; i++) {
      seen.add(dailyQuestionFor(day, pool)!.id);
      day = addDays(day, 1);
    }
    expect(seen.size).toBe(pool.length);
  });

  it("only ever picks from the pool it is given (never a Discord question)", () => {
    const discordIds = new Set(servable({ now: NOW, pool: "discord" }).map((q) => q.id));
    let day = "2026-12-01";
    for (let i = 0; i < 200; i++) {
      expect(discordIds.has(dailyQuestionFor(day, pool)!.id)).toBe(false);
      day = addDays(day, 1);
    }
  });

  it("empty pool gives null", () => expect(dailyQuestionFor("2026-11-18", [])).toBeNull());

  it("day keys are UTC and roll over at midnight UTC", () => {
    expect(dayKeyUtc(new Date("2026-11-18T23:59:59Z"))).toBe("2026-11-18");
    expect(dayKeyUtc(new Date("2026-11-19T00:00:00Z"))).toBe("2026-11-19");
    expect(nextDayStartMs("2026-11-18")).toBe(Date.parse("2026-11-19T00:00:00Z"));
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("streak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak(["2026-11-18", "2026-11-17", "2026-11-16"], "2026-11-18")).toBe(3);
  });
  it("is kept alive until the end of today when yesterday was played", () => {
    expect(computeStreak(["2026-11-17", "2026-11-16"], "2026-11-18")).toBe(2);
  });
  it("breaks on a gap, and is 0 when yesterday and today are both missed", () => {
    expect(computeStreak(["2026-11-18", "2026-11-16"], "2026-11-18")).toBe(1);
    expect(computeStreak(["2026-11-10"], "2026-11-18")).toBe(0);
    expect(computeStreak([], "2026-11-18")).toBe(0);
  });
});

describe("practice", () => {
  it("returns up to 10 distinct questions, filtered by category", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ten = pickPractice(pool, { rng });
    expect(ten).toHaveLength(10);
    expect(new Set(ten.map((q) => q.id)).size).toBe(10);
    const early = pickPractice(pool, { category: "early-bitcoin", count: 50, rng });
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThanOrEqual(10);
    expect(early.every((q) => q.category === "early-bitcoin")).toBe(true);
  });
  it("lists the categories of a pool", () => {
    const c = categoryCounts(pool);
    expect(c.reduce((n, x) => n + x.count, 0)).toBe(pool.length);
  });
});
