// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = { id: number; discordId: string; round: { dayKey: string } };
const state = vi.hoisted(() => ({ rows: [] as Row[], pages: 0, takes: [] as number[] }));

vi.mock("@/app/lib/db", () => ({
  prisma: {
    triviaAttempt: {
      // Implements the bits the leaderboard uses: orderBy id asc, cursor + skip, take.
      findMany: async ({ take, cursor, skip }: { take: number; cursor?: { id: number }; skip?: number }) => {
        state.pages++;
        state.takes.push(take);
        const sorted = [...state.rows].sort((a, b) => a.id - b.id);
        const start = cursor ? sorted.findIndex((r) => r.id === cursor.id) + (skip ?? 0) : 0;
        return sorted.slice(start, start + take);
      },
    },
    triviaRound: { groupBy: async () => [] },
  },
}));
vi.mock("@/app/lib/member-names", () => ({ memberNamesByDiscordId: async () => new Map() }));

import { getLeaderboard, STREAK_LOOKBACK_DAYS } from "./leaderboard";
import { addDays } from "./daily";

const NOW = new Date("2026-11-18T12:00:00Z");
const TODAY = "2026-11-18";

function seed(rows: [string, string][]) {
  state.rows = rows.map(([discordId, dayKey], i) => ({ id: i + 1, discordId, round: { dayKey } }));
}

beforeEach(() => {
  state.rows = [];
  state.pages = 0;
  state.takes = [];
});

describe("streak leaderboard", () => {
  it("reads every row across pages: a player whose rows come last is not dropped", async () => {
    // 11,000 one-day players first (ids 1..11000), then the long streaker (ids 11001..): beyond two full pages.
    const rows: [string, string][] = [];
    for (let i = 0; i < 11_000; i++) rows.push([`filler-${i}`, TODAY]);
    for (let d = 0; d < 30; d++) rows.push(["late-streaker", addDays(TODAY, -d)]);
    seed(rows);
    const board = await getLeaderboard(NOW);
    expect(state.pages).toBeGreaterThanOrEqual(3);
    expect(board.available).toBe(true);
    expect(board.streaks[0].score).toBe(30); // the late rows count: first place
    expect(board.streaks.length).toBe(25);
  });

  it("is deterministic: ties sort by id, whatever order the rows arrive in", async () => {
    const rows: [string, string][] = ["d", "b", "c", "a"].map((id) => [id, TODAY]);
    seed(rows);
    const first = await getLeaderboard(NOW);
    seed([...rows].reverse());
    const second = await getLeaderboard(NOW);
    expect(first.streaks.map((e) => e.score)).toEqual([1, 1, 1, 1]);
    expect(first.streaks.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(second.streaks.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });

  it('marks a streak that fills the whole window as capped ("120+")', async () => {
    const rows: [string, string][] = [];
    for (let d = 0; d < STREAK_LOOKBACK_DAYS; d++) rows.push(["marathon", addDays(TODAY, -d)]);
    for (let d = 0; d < 5; d++) rows.push(["casual", addDays(TODAY, -d)]);
    seed(rows);
    const board = await getLeaderboard(NOW);
    expect(board.streaks[0]).toMatchObject({ score: STREAK_LOOKBACK_DAYS, capped: true });
    expect(board.streaks[1]).toMatchObject({ score: 5 });
    expect(board.streaks[1].capped).toBeUndefined();
  });

  it("does not return Discord ids", async () => {
    seed([["123456789012345678", TODAY]]);
    const board = await getLeaderboard(NOW);
    expect(JSON.stringify(board)).not.toContain("123456789012345678");
  });
});

describe("answerText is nullable (scrub cron)", () => {
  it("is optional in the Prisma schema and the migration", () => {
    const root = process.cwd();
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/answerText\s+String\?\s+@db\.VarChar\(120\)/);
    const sql = readFileSync(join(root, "prisma/migrations/20261223090000_trivia/migration.sql"), "utf8");
    expect(sql).toContain('"answerText" VARCHAR(120),');
    expect(sql).not.toContain('"answerText" VARCHAR(120) NOT NULL');
  });
});
