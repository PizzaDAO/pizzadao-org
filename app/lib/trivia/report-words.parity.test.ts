// @vitest-environment node
// The recorder keeps its own copy of the report words (it cannot import app code). This fails if the two lists drift.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));

import { REPORT_WORDS, hasReportWord } from "./reports";
import { TRIVIA_SETTINGS } from "@/app/lib/settings/trivia-settings";
import { getBank } from "./bank";

describe("report words: app and recorder agree", () => {
  const src = readFileSync(resolve(process.cwd(), "recorder/src/trivia-forward.ts"), "utf8");
  const m = /export const REPORT_WORDS = \[([^\]]+)\] as const/.exec(src);

  it("the recorder's list is the app's list, in the same order", () => {
    expect(m, "REPORT_WORDS not found in recorder/src/trivia-forward.ts").toBeTruthy();
    const recorderWords = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(recorderWords).toEqual([...REPORT_WORDS]);
  });

  it("the recorder builds the same whole-word, case-insensitive regex", () => {
    expect(src).toContain("new RegExp(`\\\\b(?:${REPORT_WORDS.join('|')})\\\\b`, 'i')");
    for (const w of REPORT_WORDS) expect(hasReportWord(`This is ${w.toUpperCase()}!`)).toBe(true);
    expect(hasReportWord("badger")).toBe(false);
  });
});

describe("the pulled list schema covers the whole bank", () => {
  const schema = TRIVIA_SETTINGS["trivia.disabledQuestionIds"].schema;
  it("takes every question id in the bank at once", () => {
    const ids = getBank().questions.map((q) => q.id);
    expect(ids.length).toBeLessThan(1000);
    expect(schema.safeParse(ids).success).toBe(true);
  });
  it("allows up to 1000 entries and no more, and only question ids", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `zz-${String(i).padStart(3, "0")}`);
    expect(schema.safeParse(many).success).toBe(true);
    expect(schema.safeParse([...many, "zz-999"]).success).toBe(false);
    expect(schema.safeParse(["not an id"]).success).toBe(false);
  });
});
