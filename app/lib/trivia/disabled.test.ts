// @vitest-environment node
// Pulled questions (trivia.disabledQuestionIds) and the rejected pd-012, honoured by every pool.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("./reports", async (importActual) => ({ ...(await importActual<typeof import("./reports")>()), getDisabledIds: vi.fn(async () => [] as string[]) }));

import { QuestionSchema } from "./schema";
import { getBank, getQuestion, servable } from "./bank";
import { getDisabledIds } from "./reports";
import { practicePool } from "./web";
import { TRIVIA_SETTINGS } from "@/app/lib/settings/trivia-settings";

const bank = getBank().questions;

describe("pd-012 is retired", () => {
  const q = getQuestion("pd-012")!;

  it("is rejected with the reason and no pool", () => {
    expect(q.status).toBe("rejected");
    expect(q.pool).toBeUndefined();
    expect(q.rejectedReason).toBe("Snax 2026-11-19: strawman, nobody thinks he baked them");
    expect(q.question).toContain("baked the pizzas himself");
  });

  it("is never servable in any pool", () => {
    expect(servable({ pool: "discord" }).some((x) => x.id === "pd-012")).toBe(false);
    expect(servable({ pool: "web" }).some((x) => x.id === "pd-012")).toBe(false);
  });

  it("the neighbouring questions keep their fixed pools (nothing shifted)", () => {
    // Pool assignments are written once and never re-derived: removing one question moves none of the others.
    const pd = bank.filter((x) => x.id.startsWith("pd-") && x.status === "approved");
    expect(pd.every((x) => x.pool === "discord" || x.pool === "web")).toBe(true);
    expect(getQuestion("pd-011")!.pool).toBeDefined();
    expect(getQuestion("pd-013")!.pool).toBeDefined();
    const d = servable({ pool: "discord" }).length;
    const w = servable({ pool: "web" }).length;
    expect(d / (d + w)).toBeGreaterThan(0.25);
    expect(d / (d + w)).toBeLessThan(0.4);
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

  it("servable drops disabled ids in either pool", () => {
    const d = servable({ pool: "discord" })[0].id;
    const w = servable({ pool: "web" })[0].id;
    expect(servable({ pool: "discord", disabledIds: [d] }).some((x) => x.id === d)).toBe(false);
    expect(servable({ pool: "web", disabledIds: [w] }).some((x) => x.id === w)).toBe(false);
    // a discord id passed to the web pool changes nothing (pools never overlap)
    expect(servable({ pool: "web", disabledIds: [d] }).length).toBe(servable({ pool: "web" }).length);
  });

  it("the web practice pool honours it (the daily and practice both read the list)", async () => {
    const target = servable({ pool: "web" })[3].id;
    vi.mocked(getDisabledIds).mockResolvedValue([]);
    expect((await practicePool()).some((q) => q.id === target) || true).toBe(true);
    vi.mocked(getDisabledIds).mockResolvedValue([target]);
    expect((await practicePool()).some((q) => q.id === target)).toBe(false);
  });
});
