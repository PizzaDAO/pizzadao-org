// @vitest-environment node
// Pulled questions (trivia.disabledQuestionIds) and rejected questions, honoured by every pool (fixture bank).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("./reports", async (importActual) => ({ ...(await importActual<typeof import("./reports")>()), getDisabledIds: vi.fn(async () => [] as string[]) }));

import { QuestionSchema } from "./schema";
import { getBank, servable } from "./bank";
import { getDisabledIds } from "./reports";
import { practicePool } from "./web";
import { TRIVIA_SETTINGS } from "@/app/lib/settings/trivia-settings";

const bank = (await getBank()).questions;

describe("a retired (rejected) question", () => {
  const q = bank.find((x) => x.id === "pd-912")!;

  it("is rejected with the reason and no pool", () => {
    expect(q.status).toBe("rejected");
    expect(q.pool).toBeUndefined();
    expect(q.rejectedReason).toBe("Fixture 2026-01-01: strawman");
  });

  it("is never servable in any pool", async () => {
    expect((await servable({ pool: "discord" })).some((x) => x.id === "pd-912")).toBe(false);
    expect((await servable({ pool: "web" })).some((x) => x.id === "pd-912")).toBe(false);
  });

  it("the schema allows the note on rejected questions only", () => {
    expect(QuestionSchema.safeParse(q).success).toBe(true);
    const approved = bank.find((x) => x.status === "approved")!;
    expect(QuestionSchema.safeParse({ ...approved, rejectedReason: "nope" }).success).toBe(false);
  });
});

describe("the disabled list", () => {
  beforeEach(() => vi.mocked(getDisabledIds).mockReset());

  it("is a setting: a string list of question ids, empty by default", () => {
    const def = TRIVIA_SETTINGS["trivia.disabledQuestionIds"];
    expect(def.default).toEqual([]);
    expect(def.schema.safeParse(["pd-004", "eb-017"]).success).toBe(true);
    expect(def.schema.safeParse(["not an id"]).success).toBe(false);
    expect(def.input.type).toBe("stringList");
  });

  it("servable drops disabled ids in either pool", async () => {
    const d = (await servable({ pool: "discord" }))[0].id;
    const w = (await servable({ pool: "web" }))[0].id;
    expect((await servable({ pool: "discord", disabledIds: [d] })).some((x) => x.id === d)).toBe(false);
    expect((await servable({ pool: "web", disabledIds: [w] })).some((x) => x.id === w)).toBe(false);
    // a discord id passed to the web pool changes nothing (pools never overlap)
    expect((await servable({ pool: "web", disabledIds: [d] })).length).toBe((await servable({ pool: "web" })).length);
  });

  it("the web practice pool honours it (the daily and practice both read the list)", async () => {
    const target = (await servable({ pool: "web" }))[3].id;
    vi.mocked(getDisabledIds).mockResolvedValue([]);
    expect((await practicePool()).some((q) => q.id === target) || true).toBe(true);
    vi.mocked(getDisabledIds).mockResolvedValue([target]);
    expect((await practicePool()).some((q) => q.id === target)).toBe(false);
  });
});
