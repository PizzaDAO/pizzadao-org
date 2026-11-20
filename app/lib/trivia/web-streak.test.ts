// @vitest-environment node
/** The member's streak panel (current + best) reads the same days the leaderboard does and ranks them the same way. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ days: [] as string[], down: false }));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    triviaAttempt: {
      findMany: async () => {
        if (db.down) throw new Error("relation does not exist");
        return db.days.map((d) => ({ round: { dayKey: d } }));
      },
    },
  },
}));

import { streakFor, streakStatsFor } from "./web";
import { computeStreak } from "./daily";

beforeEach(() => {
  db.days = [];
  db.down = false;
});

describe("streakStatsFor", () => {
  it("gives the current and best streak, and whether today is played", async () => {
    db.days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-17", "2026-11-18"];
    expect(await streakStatsFor("1", "2026-11-18")).toEqual({ current: 2, best: 4, playedToday: true });
  });

  it("keeps the streak alive until the end of today (yesterday played, today not yet)", async () => {
    db.days = ["2026-11-16", "2026-11-17"];
    expect(await streakStatsFor("1", "2026-11-18")).toEqual({ current: 2, best: 2, playedToday: false });
  });

  it("current is exactly what the leaderboard computes (computeStreak over the same days), and best is never below it", async () => {
    db.days = ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-14"];
    const s = await streakStatsFor("1", "2026-11-14");
    expect(s.current).toBe(computeStreak(db.days, "2026-11-14"));
    expect(s.best).toBeGreaterThanOrEqual(s.current);
    expect(await streakFor("1", "2026-11-14")).toBe(s.current);
  });

  it("is all zeros with no plays or when the tables are unavailable", async () => {
    expect(await streakStatsFor("1", "2026-11-18")).toEqual({ current: 0, best: 0, playedToday: false });
    db.down = true;
    expect(await streakStatsFor("1", "2026-11-18")).toEqual({ current: 0, best: 0, playedToday: false });
  });
});
