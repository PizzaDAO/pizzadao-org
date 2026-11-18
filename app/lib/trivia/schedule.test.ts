// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dueSlot, parseWindow, pickQuestion, slotsForDay } from "./schedule";
import { SLOT_CATCH_UP_MINUTES, WINDOWS_UTC, attemptsPerRound, snowflakeAfter, snowflakeMs } from "./config";
import { dayStartMs } from "./daily";
import { getBank, servable } from "./bank";
import type { TriviaQuestion } from "./schema";

const DAY = "2026-12-01";
const MIN = 60_000;
const minutesIntoDay = (ms: number) => (ms - dayStartMs(DAY)) / MIN;

describe("slotsForDay", () => {
  it("is deterministic for a date (cron reruns agree)", () => {
    expect(slotsForDay(DAY, 3)).toEqual(slotsForDay(DAY, 3));
    expect(slotsForDay(DAY, 3)).not.toEqual(slotsForDay("2026-12-02", 3));
  });

  it("puts 3 rounds in 3 different windows, inside them (the 23:00-01:00 window wraps past midnight)", () => {
    const slots = slotsForDay(DAY, 3);
    expect(slots).toHaveLength(3);
    const mins = slots.map(minutesIntoDay);
    const inWindow = (m: number, from: number, len: number) => m >= from && m < from + len;
    expect(mins.filter((m) => inWindow(m, 14 * 60, 120))).toHaveLength(1);
    expect(mins.filter((m) => inWindow(m, 18 * 60, 120))).toHaveLength(1);
    expect(mins.filter((m) => inWindow(m, 23 * 60, 120))).toHaveLength(1); // may land after midnight (minute >= 1440)
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it("honours roundsPerDay (1 and 6) and an empty schedule", () => {
    expect(slotsForDay(DAY, 1)).toHaveLength(1);
    expect(slotsForDay(DAY, 6)).toHaveLength(6);
    expect(slotsForDay(DAY, 0)).toEqual([]);
    expect(slotsForDay(DAY, 3, [])).toEqual([]);
  });

  it("parses windows and rejects nonsense", () => {
    expect(parseWindow("14:00-16:00")).toEqual({ startMin: 840, lengthMin: 120 });
    expect(parseWindow("23:00-01:00")).toEqual({ startMin: 1380, lengthMin: 120 });
    expect(parseWindow("nope")).toBeNull();
    expect(parseWindow("10:00-10:00")).toBeNull();
    expect(WINDOWS_UTC.every((w) => parseWindow(w))).toBe(true);
  });
});

describe("dueSlot", () => {
  const slots = slotsForDay(DAY, 3);

  it("fires a slot that is due and unfired", () => {
    const now = new Date(slots[0] + 2 * MIN);
    expect(dueSlot(now, 3, [])).toBe(slots[0]);
  });

  it("does not fire before the slot", () => {
    expect(dueSlot(new Date(slots[0] - MIN), 3, [])).toBeNull();
  });

  it("does not fire twice: a round opened at or after the slot counts as fired (manual starts included)", () => {
    const now = new Date(slots[0] + 7 * MIN);
    expect(dueSlot(now, 3, [slots[0] + MIN])).toBeNull();
    expect(dueSlot(now, 3, [slots[0]])).toBeNull();
    expect(dueSlot(now, 3, [slots[0] - 1])).toBe(slots[0]);
  });

  it("a missed tick is caught up by the next one, but a slot older than the catch-up limit is skipped", () => {
    expect(dueSlot(new Date(slots[1] + 20 * MIN), 3, [])).toBe(slots[1]);
    expect(dueSlot(new Date(slots[1] + (SLOT_CATCH_UP_MINUTES + 1) * MIN), 3, [])).toBeNull();
  });

  it("after a long outage posts the latest due slot only (one round, not a burst)", () => {
    const now = new Date(Math.max(...slots) + 5 * MIN);
    expect(dueSlot(now, 3, [])).toBe(Math.max(...slots));
  });

  it("sees the previous day's late slot after midnight", () => {
    const yesterday = "2026-11-30";
    const late = Math.max(...slotsForDay(yesterday, 3));
    if (late >= dayStartMs(DAY)) {
      expect(dueSlot(new Date(late + MIN), 3, [])).toBe(late);
    } else {
      expect(late).toBeLessThan(dayStartMs(DAY));
    }
  });
});

const q = (id: string, difficulty: TriviaQuestion["difficulty"], over: Partial<TriviaQuestion> = {}): TriviaQuestion =>
  ({ id, category: "protocol", type: "short_answer", difficulty, question: "A question here?", answer: "x", aliases: [], rejects: [], match: { kind: "text" }, explanation: "e", sources: [{ url: "https://e.com", note: "n" }], status: "approved", pool: "discord", ...over }) as TriviaQuestion;

describe("pickQuestion", () => {
  const pool = [q("aa-001", "easy"), q("aa-002", "easy"), q("aa-003", "medium"), q("aa-004", "medium"), q("aa-005", "hard")];

  it("avoids the last floor(pool x 0.8) questions", () => {
    // 5 x 0.8 = 4: only aa-005 is allowed after four recent ones.
    for (let i = 0; i < 20; i++) {
      const picked = pickQuestion(pool, { recentIds: ["aa-001", "aa-002", "aa-003", "aa-004"], rng: Math.random });
      expect(picked?.id).toBe("aa-005");
    }
  });

  it("falls back to repeats rather than silence when everything is recent", () => {
    expect(pickQuestion(pool.slice(0, 1), { recentIds: ["aa-001"] })?.id).toBe("aa-001");
  });

  it("returns null for an empty pool", () => {
    expect(pickQuestion([], { recentIds: [] })).toBeNull();
  });

  it("weights difficulty 40 / 45 / 15", () => {
    const big: TriviaQuestion[] = [];
    for (let i = 0; i < 40; i++) big.push(q(`ee-${String(i).padStart(3, "0")}`, "easy"), q(`mm-${String(i).padStart(3, "0")}`, "medium"), q(`hh-${String(i).padStart(3, "0")}`, "hard"));
    let seed = 12345;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const counts = { easy: 0, medium: 0, hard: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) counts[pickQuestion(big, { recentIds: [], rng })!.difficulty]++;
    expect(counts.easy / N).toBeGreaterThan(0.36);
    expect(counts.easy / N).toBeLessThan(0.44);
    expect(counts.medium / N).toBeGreaterThan(0.41);
    expect(counts.medium / N).toBeLessThan(0.49);
    expect(counts.hard / N).toBeGreaterThan(0.12);
    expect(counts.hard / N).toBeLessThan(0.18);
  });

  it("never picks a fun-* or just-for-fun question, even if one is in the pool", () => {
    const fun = [q("fun-001", "easy", { category: "just-for-fun" }), q("zz-001", "easy", { category: "just-for-fun" })];
    expect(pickQuestion(fun, { recentIds: [] })).toBeNull();
    for (let i = 0; i < 30; i++) expect(pickQuestion([...fun, q("aa-001", "easy")], { recentIds: [] })?.id).toBe("aa-001");
  });

  it("from the real discord pool: only discord, approved, never fun", () => {
    const pool = servable({ pool: "discord" });
    expect(pool.length).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) {
      const p = pickQuestion(pool, { recentIds: [] })!;
      expect(p.pool).toBe("discord");
      expect(p.status).toBe("approved");
      expect(p.id.startsWith("fun-")).toBe(false);
      expect(getBank().questions.find((x) => x.id === p.id)?.category).not.toBe("just-for-fun");
    }
  });
});

describe("config helpers", () => {
  it("true/false and multiple choice get one attempt, short answers three", () => {
    expect(attemptsPerRound({ type: "true_false" })).toBe(1);
    expect(attemptsPerRound({ type: "multiple_choice" })).toBe(1);
    expect(attemptsPerRound({ type: "short_answer" })).toBe(3);
  });

  it("reads a snowflake's creation time and compares ids as numbers", () => {
    // 2015-01-01 is the epoch; id 0 is that instant. This id is from 2021-01-01 and later.
    expect(snowflakeMs("4194304")).toBe(1420070400001);
    expect(snowflakeMs("not a number")).toBeNaN();
    const at = snowflakeMs("800000000000000000");
    expect(new Date(at).getUTCFullYear()).toBeGreaterThanOrEqual(2021);
    expect(snowflakeAfter("1000000000000000010", "999999999999999999")).toBe(true);
    expect(snowflakeAfter("999999999999999999", "1000000000000000010")).toBe(false);
  });
});
